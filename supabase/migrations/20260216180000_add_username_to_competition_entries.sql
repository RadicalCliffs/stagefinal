-- =====================================================
-- ADD USERNAME TO COMPETITION ENTRIES RPC
-- =====================================================
-- ISSUE: Competition entries display shows wallet address and transaction hash
-- but NOT username, making it difficult to identify users
--
-- ROOT CAUSE: get_user_competition_entries RPC function doesn't return
-- username field even though it's available in canonical_users table
--
-- SOLUTION: Add username field to the RPC function return type and
-- join with canonical_users to fetch the username
-- =====================================================

BEGIN;

-- Update get_user_competition_entries to include username
CREATE OR REPLACE FUNCTION get_user_competition_entries(p_user_identifier TEXT)
RETURNS TABLE (
  -- Entry identifiers
  id TEXT,
  competition_id TEXT,
  
  -- Competition information
  competition_title TEXT,
  competition_description TEXT,
  competition_image_url TEXT,
  competition_status TEXT,
  competition_end_date TIMESTAMPTZ,
  competition_prize_value NUMERIC,
  competition_is_instant_win BOOLEAN,
  
  -- Draw information
  draw_date TIMESTAMPTZ,
  vrf_tx_hash TEXT,
  vrf_status TEXT,
  vrf_draw_completed_at TIMESTAMPTZ,
  
  -- User entry data (aggregated)
  tickets_count INTEGER,
  ticket_numbers TEXT,
  amount_spent NUMERIC,
  amount_paid NUMERIC,
  is_winner BOOLEAN,
  wallet_address TEXT,
  username TEXT,  -- NEW: Added username field
  
  -- Purchase timestamps
  latest_purchase_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  
  -- Entry status
  entry_status TEXT,
  
  -- Individual purchases (JSONB array)
  individual_purchases JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_canonical_user_id TEXT;
  search_wallet TEXT;
BEGIN
  -- Extract wallet from prize:pid: format
  IF p_user_identifier LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(p_user_identifier FROM 11));
  ELSIF p_user_identifier LIKE '0x%' THEN
    search_wallet := LOWER(p_user_identifier);
  END IF;

  -- Resolve canonical user ID
  SELECT canonical_user_id INTO v_canonical_user_id
  FROM canonical_users
  WHERE canonical_user_id = p_user_identifier
     OR uid = p_user_identifier
     OR (search_wallet IS NOT NULL AND LOWER(wallet_address) = search_wallet)
     OR (search_wallet IS NOT NULL AND LOWER(base_wallet_address) = search_wallet)
  LIMIT 1;

  IF v_canonical_user_id IS NULL THEN
    RETURN;
  END IF;

  -- Return enhanced entry data with individual purchases and username
  RETURN QUERY
  SELECT 
    -- Entry identifiers
    ce.id::TEXT AS id,
    COALESCE(c.id::TEXT, c.uid::TEXT, ce.competition_id::TEXT) AS competition_id,
    
    -- Competition information
    COALESCE(ce.competition_title, c.title) AS competition_title,
    COALESCE(ce.competition_description, c.description) AS competition_description,
    c.image_url AS competition_image_url,
    c.status AS competition_status,
    COALESCE(c.end_date, c.end_time) AS competition_end_date,
    c.prize_value AS competition_prize_value,
    COALESCE(c.is_instant_win, false) AS competition_is_instant_win,
    
    -- Draw information
    c.draw_date AS draw_date,
    c.vrf_tx_hash AS vrf_tx_hash,
    c.vrf_status AS vrf_status,
    c.vrf_draw_completed_at AS vrf_draw_completed_at,
    
    -- User entry data (aggregated)
    ce.tickets_count AS tickets_count,
    ce.ticket_numbers_csv AS ticket_numbers,
    ce.amount_spent AS amount_spent,
    ce.amount_paid AS amount_paid,
    COALESCE(ce.is_winner, false) AS is_winner,
    ce.wallet_address AS wallet_address,
    cu.username AS username,  -- NEW: Include username from canonical_users
    
    -- Purchase timestamps
    ce.latest_purchase_at AS latest_purchase_at,
    ce.created_at AS created_at,
    
    -- Entry status
    'completed'::TEXT AS entry_status,
    
    -- Individual purchases as JSONB array
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', cep.id::TEXT,
            'purchase_key', cep.purchase_key,
            'tickets_count', cep.tickets_count,
            'amount_spent', cep.amount_spent,
            'ticket_numbers', cep.ticket_numbers_csv,
            'purchased_at', cep.purchased_at,
            'created_at', cep.created_at
          )
          ORDER BY cep.purchased_at DESC
        )
        FROM competition_entries_purchases cep
        WHERE cep.canonical_user_id = ce.canonical_user_id
          AND cep.competition_id = ce.competition_id
      ),
      '[]'::JSONB
    ) AS individual_purchases
    
  FROM competition_entries ce
  LEFT JOIN competitions c ON ce.competition_id = c.id OR ce.competition_id = c.uid
  LEFT JOIN canonical_users cu ON ce.canonical_user_id = cu.canonical_user_id  -- NEW: Join to get username
  WHERE ce.canonical_user_id = v_canonical_user_id
  ORDER BY ce.latest_purchase_at DESC NULLS LAST, ce.created_at DESC;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_user_competition_entries(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_user_competition_entries(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_competition_entries(TEXT) TO service_role;

COMMIT;

-- Log completion
DO $$
BEGIN
  RAISE NOTICE '=== Username Added to Competition Entries ===';
  RAISE NOTICE 'Updated get_user_competition_entries RPC function to include username';
  RAISE NOTICE 'Username is now fetched from canonical_users table';
  RAISE NOTICE 'Frontend can now display user identity properly in entries';
END $$;
