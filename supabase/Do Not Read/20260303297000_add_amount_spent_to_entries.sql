-- ============================================================================
-- FIX: Add amount_spent to get_user_competition_entries
-- ============================================================================
-- The function is missing the amount_spent field that the dashboard expects

DROP FUNCTION IF EXISTS public.get_user_competition_entries(TEXT) CASCADE;

CREATE OR REPLACE FUNCTION public.get_user_competition_entries(p_user_identifier TEXT)
RETURNS TABLE (
  id TEXT, 
  competition_id TEXT, 
  competition_title TEXT,
  competition_image_url TEXT, 
  ticket_count INTEGER, 
  ticket_numbers TEXT,
  amount_spent NUMERIC,
  entry_status TEXT, 
  competition_status TEXT,
  competition_end_date TIMESTAMPTZ, 
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  lower_identifier TEXT;
  search_wallet TEXT;
BEGIN
  lower_identifier := LOWER(TRIM(p_user_identifier));

  IF p_user_identifier LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(p_user_identifier FROM 11));
  ELSIF p_user_identifier LIKE '0x%' THEN
    search_wallet := lower_identifier;
  ELSE
    search_wallet := NULL;
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(jc.uid, jc.id::TEXT, gen_random_uuid()::TEXT),
    COALESCE(jc.competition_id::TEXT, c.id::TEXT),
    COALESCE(c.title, ''),
    COALESCE(c.image_url, ''),
    COALESCE(jc.numberoftickets, 0)::INTEGER,
    COALESCE(jc.ticketnumbers, ''),
    COALESCE(jc.amountspent, jc.numberoftickets * c.ticket_price, 0)::NUMERIC,  -- ADDED: use actual amount or calculate
    'confirmed',
    COALESCE(c.status, 'active'),
    c.end_date,
    COALESCE(jc.created_at, NOW())
  FROM joincompetition jc
  LEFT JOIN competitions c ON jc.competition_id = c.id
  WHERE
    LOWER(jc.wallet_address) = lower_identifier
    OR jc.canonical_user_id = p_user_identifier
    OR jc.privy_user_id = p_user_identifier
    OR jc.userid::TEXT = p_user_identifier
    OR (search_wallet IS NOT NULL AND LOWER(jc.wallet_address) = search_wallet)
  ORDER BY jc.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_competition_entries(TEXT) TO authenticated, anon, service_role;

-- Force PostgREST schema reload
NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '========================================================';
  RAISE NOTICE 'FIXED: get_user_competition_entries NOW RETURNS amount_spent';
  RAISE NOTICE '========================================================';
END $$;
