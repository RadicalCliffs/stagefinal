-- Promo Competitions System
-- Creates tables for promotional competitions that are only accessible via promo codes

-- 1. Promo Competitions Table
-- These are separate from regular competitions - only visible/accessible via valid codes
CREATE TABLE IF NOT EXISTS promo_competitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Basic info
  title TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  
  -- Prize details
  prize_name TEXT NOT NULL,
  prize_description TEXT,
  prize_value NUMERIC,
  
  -- Competition settings
  total_tickets INTEGER NOT NULL DEFAULT 1000,
  tickets_allocated INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'ended', 'cancelled')),
  
  -- Dates
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  draw_date TIMESTAMPTZ,
  
  -- VRF/Draw fields (same pattern as regular competitions)
  vrf_status TEXT,
  vrf_request_id TEXT,
  vrf_random_word TEXT,
  winning_ticket_numbers TEXT,
  drawn_at TIMESTAMPTZ,
  
  -- Metadata
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Promo Competition Codes Table
-- Each code grants X free entries to a specific promo competition
CREATE TABLE IF NOT EXISTS promo_competition_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Link to promo competition
  promo_competition_id UUID NOT NULL REFERENCES promo_competitions(id) ON DELETE CASCADE,
  
  -- The code itself
  code TEXT NOT NULL,
  
  -- What this code grants
  entries_granted INTEGER NOT NULL DEFAULT 1,
  
  -- Usage limits
  max_redemptions INTEGER, -- NULL = unlimited
  current_redemptions INTEGER NOT NULL DEFAULT 0,
  
  -- Validity
  is_active BOOLEAN NOT NULL DEFAULT true,
  valid_from TIMESTAMPTZ DEFAULT NOW(),
  valid_until TIMESTAMPTZ,
  
  -- Optional: restrict to specific user
  restricted_to_user_id TEXT, -- If set, only this user can redeem
  
  -- Metadata
  description TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Unique code per competition
  CONSTRAINT unique_code_per_competition UNIQUE (promo_competition_id, code)
);

-- 3. Promo Competition Redemptions Table
-- Tracks which users have redeemed which codes
CREATE TABLE IF NOT EXISTS promo_competition_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Links
  promo_competition_id UUID NOT NULL REFERENCES promo_competitions(id),
  code_id UUID NOT NULL REFERENCES promo_competition_codes(id),
  canonical_user_id TEXT NOT NULL,
  
  -- What was granted
  entries_granted INTEGER NOT NULL,
  ticket_numbers TEXT, -- JSON array of assigned ticket numbers
  
  -- Status
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'pending', 'failed')),
  
  -- Timestamps
  redeemed_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Prevent double redemption of same code by same user
  CONSTRAINT unique_user_code_redemption UNIQUE (code_id, canonical_user_id)
);

-- 4. Promo Competition Tickets Table
-- Tracks individual tickets allocated to users in promo competitions
CREATE TABLE IF NOT EXISTS promo_competition_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_competition_id UUID NOT NULL REFERENCES promo_competitions(id),
  redemption_id UUID REFERENCES promo_competition_redemptions(id),
  canonical_user_id TEXT NOT NULL,
  
  -- Ticket info
  ticket_number INTEGER NOT NULL,
  
  -- Status
  is_winner BOOLEAN DEFAULT false,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Unique ticket number per competition
  CONSTRAINT unique_ticket_per_promo_comp UNIQUE (promo_competition_id, ticket_number)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_promo_competitions_status ON promo_competitions(status);
CREATE INDEX IF NOT EXISTS idx_promo_competition_codes_code ON promo_competition_codes(code);
CREATE INDEX IF NOT EXISTS idx_promo_competition_codes_competition ON promo_competition_codes(promo_competition_id);
CREATE INDEX IF NOT EXISTS idx_promo_competition_redemptions_user ON promo_competition_redemptions(canonical_user_id);
CREATE INDEX IF NOT EXISTS idx_promo_competition_redemptions_competition ON promo_competition_redemptions(promo_competition_id);
CREATE INDEX IF NOT EXISTS idx_promo_competition_tickets_user ON promo_competition_tickets(canonical_user_id);
CREATE INDEX IF NOT EXISTS idx_promo_competition_tickets_competition ON promo_competition_tickets(promo_competition_id);

-- Enable RLS
ALTER TABLE promo_competitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE promo_competition_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE promo_competition_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE promo_competition_tickets ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- Promo competitions: Public read for active, service role full access
CREATE POLICY "promo_competitions_select" ON promo_competitions
  FOR SELECT USING (status = 'active' OR current_setting('role', true) = 'service_role');

CREATE POLICY "promo_competitions_all_service" ON promo_competitions
  FOR ALL USING (current_setting('role', true) = 'service_role');

-- Promo codes: Service role only (codes should not be publicly readable)
CREATE POLICY "promo_codes_service_only" ON promo_competition_codes
  FOR ALL USING (current_setting('role', true) = 'service_role');

-- Redemptions: Users can see their own, service role full access
CREATE POLICY "promo_redemptions_select_own" ON promo_competition_redemptions
  FOR SELECT USING (
    canonical_user_id = current_setting('request.jwt.claims', true)::json->>'sub'
    OR current_setting('role', true) = 'service_role'
  );

CREATE POLICY "promo_redemptions_service" ON promo_competition_redemptions
  FOR ALL USING (current_setting('role', true) = 'service_role');

-- Tickets: Users can see their own, service role full access
CREATE POLICY "promo_tickets_select_own" ON promo_competition_tickets
  FOR SELECT USING (
    canonical_user_id = current_setting('request.jwt.claims', true)::json->>'sub'
    OR current_setting('role', true) = 'service_role'
  );

CREATE POLICY "promo_tickets_service" ON promo_competition_tickets
  FOR ALL USING (current_setting('role', true) = 'service_role');

-- Enable realtime for user-facing tables
ALTER PUBLICATION supabase_realtime ADD TABLE promo_competition_redemptions;
ALTER PUBLICATION supabase_realtime ADD TABLE promo_competition_tickets;

-- Function: Redeem a promo code
-- This atomically validates the code, grants entries, and assigns tickets
CREATE OR REPLACE FUNCTION redeem_promo_code(
  p_code TEXT,
  p_canonical_user_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_code_record RECORD;
  v_competition RECORD;
  v_redemption_id UUID;
  v_ticket_numbers INTEGER[];
  v_next_ticket INTEGER;
  v_i INTEGER;
BEGIN
  -- 1. Find the code
  SELECT pc.*, pcc.id as competition_id, pcc.title as competition_title, 
         pcc.total_tickets, pcc.tickets_allocated, pcc.status as comp_status
  INTO v_code_record
  FROM promo_competition_codes pc
  JOIN promo_competitions pcc ON pc.promo_competition_id = pcc.id
  WHERE UPPER(pc.code) = UPPER(p_code)
    AND pc.is_active = true
    AND (pc.valid_from IS NULL OR pc.valid_from <= NOW())
    AND (pc.valid_until IS NULL OR pc.valid_until > NOW())
    AND pcc.status = 'active'
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid or expired promo code'
    );
  END IF;
  
  -- 2. Check if code has remaining redemptions
  IF v_code_record.max_redemptions IS NOT NULL 
     AND v_code_record.current_redemptions >= v_code_record.max_redemptions THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'This code has reached its maximum redemptions'
    );
  END IF;
  
  -- 3. Check if restricted to specific user
  IF v_code_record.restricted_to_user_id IS NOT NULL 
     AND v_code_record.restricted_to_user_id != p_canonical_user_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'This code is not valid for your account'
    );
  END IF;
  
  -- 4. Check if user already redeemed this code
  IF EXISTS (
    SELECT 1 FROM promo_competition_redemptions
    WHERE code_id = v_code_record.id AND canonical_user_id = p_canonical_user_id
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'You have already redeemed this code'
    );
  END IF;
  
  -- 5. Check if competition has enough tickets
  IF v_code_record.tickets_allocated + v_code_record.entries_granted > v_code_record.total_tickets THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Not enough tickets available in this competition'
    );
  END IF;
  
  -- 6. Allocate ticket numbers
  v_ticket_numbers := ARRAY[]::INTEGER[];
  v_next_ticket := v_code_record.tickets_allocated + 1;
  
  FOR v_i IN 1..v_code_record.entries_granted LOOP
    v_ticket_numbers := array_append(v_ticket_numbers, v_next_ticket);
    v_next_ticket := v_next_ticket + 1;
  END LOOP;
  
  -- 7. Create redemption record
  INSERT INTO promo_competition_redemptions (
    promo_competition_id,
    code_id,
    canonical_user_id,
    entries_granted,
    ticket_numbers,
    status
  ) VALUES (
    v_code_record.promo_competition_id,
    v_code_record.id,
    p_canonical_user_id,
    v_code_record.entries_granted,
    to_jsonb(v_ticket_numbers)::TEXT,
    'completed'
  ) RETURNING id INTO v_redemption_id;
  
  -- 8. Create ticket records
  FOR v_i IN 1..array_length(v_ticket_numbers, 1) LOOP
    INSERT INTO promo_competition_tickets (
      promo_competition_id,
      redemption_id,
      canonical_user_id,
      ticket_number
    ) VALUES (
      v_code_record.promo_competition_id,
      v_redemption_id,
      p_canonical_user_id,
      v_ticket_numbers[v_i]
    );
  END LOOP;
  
  -- 9. Update code redemption count
  UPDATE promo_competition_codes
  SET current_redemptions = current_redemptions + 1,
      updated_at = NOW()
  WHERE id = v_code_record.id;
  
  -- 10. Update competition tickets allocated
  UPDATE promo_competitions
  SET tickets_allocated = tickets_allocated + v_code_record.entries_granted,
      updated_at = NOW()
  WHERE id = v_code_record.promo_competition_id;
  
  -- 11. Return success
  RETURN jsonb_build_object(
    'success', true,
    'redemption_id', v_redemption_id,
    'entries_granted', v_code_record.entries_granted,
    'ticket_numbers', v_ticket_numbers,
    'competition', jsonb_build_object(
      'id', v_code_record.promo_competition_id,
      'title', v_code_record.competition_title
    )
  );
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION redeem_promo_code(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION redeem_promo_code(TEXT, TEXT) TO service_role;

COMMENT ON TABLE promo_competitions IS 'Promotional competitions accessible only via promo codes';
COMMENT ON TABLE promo_competition_codes IS 'Codes that grant free entries to promo competitions';
COMMENT ON TABLE promo_competition_redemptions IS 'Records of users redeeming promo codes';
COMMENT ON TABLE promo_competition_tickets IS 'Tickets allocated to users in promo competitions';
COMMENT ON FUNCTION redeem_promo_code IS 'Atomically redeem a promo code and allocate tickets';
