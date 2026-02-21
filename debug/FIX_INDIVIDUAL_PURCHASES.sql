-- FIX: Keep entries separate by purchase date, don't aggregate
-- RUN THIS IN SUPABASE SQL EDITOR

-- First, let's see what the current individual_purchases looks like for Bitcoin Bonanza
SELECT 
  ce.id,
  ce.wallet_address,
  ce.ticket_count,
  ce.ticket_numbers,
  ce.amount_paid,
  ce.created_at,
  c.title
FROM competition_entries ce
JOIN competitions c ON c.id = ce.competition_id
WHERE c.title ILIKE '%bonanza%'
ORDER BY ce.created_at DESC;

-- The problem: joincompetition aggregates multiple purchases into one row
-- We need to look at the ACTUAL purchase records

-- Check if there are multiple rows per user per competition in joincompetition
SELECT 
  wallet_address,
  competitionid,
  COUNT(*) as row_count,
  array_agg(id) as ids,
  array_agg(ticketnumbers) as all_tickets,
  array_agg(numberoftickets) as all_counts,
  array_agg(purchasedate) as all_dates
FROM joincompetition jc
WHERE EXISTS (SELECT 1 FROM competitions c WHERE c.id::text = jc.competitionid AND c.title ILIKE '%bonanza%')
GROUP BY wallet_address, competitionid
HAVING COUNT(*) > 1;

-- The fix: The individual_purchases in get_user_competition_entries is being built wrong
-- It's likely combining data in a way that creates phantom entries

-- Let's see the current RPC definition
SELECT prosrc 
FROM pg_proc 
WHERE proname = 'get_user_competition_entries';

-- REPLACE the get_user_competition_entries function to:
-- 1. Keep each purchase as a separate row (no aggregation)
-- 2. Pull from joincompetition directly without creating phantom individual_purchases

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

  -- Return EACH purchase as a SEPARATE row - no aggregation!
  -- This preserves the purchase date of each individual buy
  RETURN QUERY
  SELECT 
    jc.id::TEXT,
    jc.competitionid::TEXT,
    COALESCE(c.title, 'Unknown Competition'),
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
    COALESCE(jc.numberoftickets, array_length(string_to_array(jc.ticketnumbers, ','), 1), 1)::INTEGER,
    COALESCE(jc.ticketnumbers, ''),
    COALESCE(jc.amountspent, jc.numberoftickets, 1)::NUMERIC,
    COALESCE(jc.amountspent, jc.numberoftickets, 1)::NUMERIC,
    COALESCE(jc.is_winner, false),
    COALESCE(jc.wallet_address, v_wallet),
    jc.purchasedate,
    jc.created_at,
    'completed'::TEXT,
    '[]'::JSONB  -- Empty array - we return separate rows instead of nested individual_purchases
  FROM joincompetition jc
  LEFT JOIN competitions c ON (
    c.id::TEXT = jc.competitionid 
    OR c.uid = jc.competitionid
  )
  WHERE (
    LOWER(jc.wallet_address) = LOWER(v_wallet)
    OR jc.userid = v_wallet
    OR jc.canonical_user_id = v_canonical
  )
  AND jc.ticketnumbers IS NOT NULL 
  AND jc.ticketnumbers != ''
  AND array_length(string_to_array(jc.ticketnumbers, ','), 1) > 0
  ORDER BY jc.purchasedate DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_user_competition_entries(TEXT) TO authenticated, anon, service_role;

-- Verify: This should now show SEPARATE rows for each purchase
SELECT * FROM get_user_competition_entries('prize:pid:YOUR_WALLET_ADDRESS_HERE') LIMIT 10;
