-- FIX: Add competition_ticket_price to get_user_competition_entries RPC
-- This fixes the "Total Spent: $0.00" bug by providing ticket_price from competitions table
-- and calculating amount_spent = tickets_count * ticket_price

-- Drop and recreate with new column
DROP FUNCTION IF EXISTS get_user_competition_entries(text) CASCADE;

CREATE OR REPLACE FUNCTION get_user_competition_entries(p_user_identifier TEXT)
RETURNS TABLE (
  id TEXT,
  competition_id TEXT,
  competition_title TEXT,
  competition_description TEXT,
  competition_image_url TEXT,
  competition_status TEXT,
  competition_end_date TIMESTAMPTZ,
  competition_prize_value NUMERIC,
  competition_is_instant_win BOOLEAN,
  competition_ticket_price NUMERIC,  -- NEW: Add ticket price from competition
  draw_date TIMESTAMPTZ,
  vrf_tx_hash TEXT,
  vrf_status TEXT,
  vrf_draw_completed_at TIMESTAMPTZ,
  tickets_count INTEGER,
  ticket_numbers TEXT,
  amount_spent NUMERIC,
  amount_paid NUMERIC,
  is_winner BOOLEAN,
  wallet_address TEXT,
  latest_purchase_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  entry_status TEXT,
  individual_purchases JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_wallet TEXT;
  v_canonical TEXT;
BEGIN
  -- Normalize the identifier
  IF p_user_identifier IS NULL OR TRIM(p_user_identifier) = '' THEN
    RETURN;
  END IF;

  -- Extract wallet address from canonical_user_id if needed
  IF p_user_identifier LIKE 'prize:pid:%' THEN
    v_wallet := SUBSTRING(p_user_identifier FROM 11);
    v_canonical := p_user_identifier;
  ELSIF p_user_identifier LIKE '0x%' THEN
    v_wallet := LOWER(p_user_identifier);
    v_canonical := 'prize:pid:' || LOWER(p_user_identifier);
  ELSE
    v_wallet := p_user_identifier;
    v_canonical := p_user_identifier;
  END IF;

  -- Return from competition_entries joined with competitions
  -- Competition entries is the aggregated view per user/competition
  RETURN QUERY
  SELECT 
    ce.id::TEXT,
    ce.competition_id::TEXT,
    COALESCE(c.title, ce.competition_title, 'Unknown Competition'),
    COALESCE(c.description, ce.competition_description, ''),
    COALESCE(c.image_url, NULL),
    COALESCE(c.status, 'active'),
    c.end_date,
    c.prize_value,
    COALESCE(c.is_instant_win, false),
    COALESCE(c.ticket_price, 1)::NUMERIC,  -- NEW: Return ticket price, default to $1
    c.draw_date,
    c.vrf_tx_hash,
    c.vrf_status,
    c.vrf_draw_completed_at,
    COALESCE(ce.tickets_count, 0)::INTEGER,
    COALESCE(ce.ticket_numbers_csv, ''),
    -- FIX: Calculate amount_spent = tickets_count * ticket_price
    COALESCE(
      NULLIF(ce.amount_spent, 0),  -- Use stored amount_spent if not zero
      ce.tickets_count * COALESCE(c.ticket_price, 1)  -- Otherwise calculate from ticket_price
    )::NUMERIC,
    COALESCE(
      NULLIF(ce.amount_paid, 0),
      ce.tickets_count * COALESCE(c.ticket_price, 1)
    )::NUMERIC,
    COALESCE(ce.is_winner, false),
    COALESCE(ce.wallet_address, v_wallet),
    ce.latest_purchase_at,
    ce.created_at,
    'completed'::TEXT,
    -- Build individual_purchases from tickets table grouped by purchase_key
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', agg.purchase_key,
            'purchased_at', agg.min_created_at,
            'tickets_count', agg.ticket_count,
            'ticket_numbers', agg.ticket_nums,
            'amount_spent', agg.ticket_count * COALESCE(c.ticket_price, 1)
          )
        )
        FROM (
          SELECT 
            COALESCE(tkt.purchase_key, DATE_TRUNC('minute', tkt.created_at)::TEXT) as purchase_key,
            MIN(tkt.created_at) as min_created_at,
            COUNT(*)::INTEGER as ticket_count,
            STRING_AGG(tkt.ticket_number::TEXT, ',' ORDER BY tkt.ticket_number) as ticket_nums
          FROM tickets tkt
          WHERE tkt.competition_id = ce.competition_id::UUID
            AND tkt.canonical_user_id = v_canonical
          GROUP BY COALESCE(tkt.purchase_key, DATE_TRUNC('minute', tkt.created_at)::TEXT)
        ) agg
      ),
      '[]'::JSONB
    )
  FROM competition_entries ce
  LEFT JOIN competitions c ON c.id = ce.competition_id::UUID
  WHERE ce.canonical_user_id = v_canonical
    AND ce.tickets_count > 0
    AND ce.ticket_numbers_csv IS NOT NULL 
    AND ce.ticket_numbers_csv != ''
  ORDER BY ce.latest_purchase_at DESC NULLS LAST;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_user_competition_entries(TEXT) TO authenticated, anon, service_role;

-- Test the fix
SELECT 
  competition_title,
  tickets_count,
  competition_ticket_price,
  amount_spent,
  tickets_count * competition_ticket_price as calculated_amount
FROM get_user_competition_entries('prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363')
WHERE competition_title ILIKE '%solana slammer%';
