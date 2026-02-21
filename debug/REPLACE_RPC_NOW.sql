-- COMPLETE REPLACEMENT OF get_user_competition_entries
-- This version returns FLAT rows, NO individual_purchases nonsense
-- RUN THIS NOW

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
  IF p_user_identifier IS NULL OR TRIM(p_user_identifier) = '' THEN
    RETURN;
  END IF;

  -- Extract wallet from canonical_user_id
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

  -- Return ONLY valid entries - entries with actual ticket numbers
  -- Each row is ONE purchase, NO aggregation, NO individual_purchases
  RETURN QUERY
  SELECT 
    jc.id::TEXT,
    jc.competitionid::TEXT,
    COALESCE(c.title, 'Unknown'),
    COALESCE(c.description, ''),
    c.image_url,
    COALESCE(c.status, 'active'),
    c.end_date,
    c.prize_value,
    COALESCE(c.instant_win, false),
    c.draw_date,
    c.vrf_tx_hash,
    c.vrf_status,
    c.vrf_draw_completed_at,
    -- tickets_count = actual count from parsing ticketnumbers
    array_length(string_to_array(jc.ticketnumbers, ','), 1)::INTEGER,
    jc.ticketnumbers,
    array_length(string_to_array(jc.ticketnumbers, ','), 1)::NUMERIC,
    array_length(string_to_array(jc.ticketnumbers, ','), 1)::NUMERIC,
    COALESCE(jc.is_winner, false),
    jc.wallet_address,
    jc.purchasedate,
    jc.created_at,
    'completed'::TEXT,
    '[]'::JSONB  -- ALWAYS EMPTY - no more phantom entries
  FROM joincompetition jc
  LEFT JOIN competitions c ON c.id::TEXT = jc.competitionid OR c.uid = jc.competitionid
  WHERE (
    LOWER(jc.wallet_address) = LOWER(v_wallet)
    OR jc.userid = v_wallet
    OR jc.canonical_user_id = v_canonical
  )
  -- CRITICAL: Only include entries with VALID ticket numbers
  AND jc.ticketnumbers IS NOT NULL 
  AND TRIM(jc.ticketnumbers) != ''
  AND jc.ticketnumbers != '0'
  AND array_length(string_to_array(jc.ticketnumbers, ','), 1) > 0
  ORDER BY jc.purchasedate DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_user_competition_entries(TEXT) TO authenticated, anon, service_role;

-- VERIFY: Run this with your wallet to check
-- SELECT * FROM get_user_competition_entries('prize:pid:0xYOUR_WALLET');
