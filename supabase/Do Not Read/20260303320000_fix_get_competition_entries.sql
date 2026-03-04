-- ============================================================================
-- FIX: get_competition_entries_bypass_rls (last function using competitionid)
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_competition_entries_bypass_rls(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.get_competition_entries_bypass_rls(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.get_competition_entries(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.get_competition_entries(UUID) CASCADE;

CREATE OR REPLACE FUNCTION public.get_competition_entries_bypass_rls(competition_identifier UUID)
RETURNS TABLE (
  uid TEXT, competitionid TEXT, userid TEXT, privy_user_id TEXT,
  numberoftickets INTEGER, ticketnumbers TEXT, amountspent NUMERIC,
  wallet_address TEXT, chain TEXT, transactionhash TEXT,
  purchasedate TIMESTAMPTZ, created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF competition_identifier IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(jc.uid::TEXT, jc.id::TEXT, gen_random_uuid()::TEXT),
    COALESCE(jc.competition_id::TEXT, '')::TEXT,  -- Changed from competitionid
    COALESCE(jc.userid::TEXT, '')::TEXT,
    COALESCE(jc.privy_user_id, jc.wallet_address, '')::TEXT,
    COALESCE(jc.numberoftickets, 1)::INTEGER,
    COALESCE(jc.ticketnumbers, '')::TEXT,
    COALESCE(jc.amountspent, 0)::NUMERIC,
    COALESCE(jc.wallet_address, '')::TEXT,
    COALESCE(jc.chain, 'Base')::TEXT,
    COALESCE(jc.transactionhash, '')::TEXT,
    COALESCE(jc.purchasedate, jc.created_at, NOW())::TIMESTAMPTZ,
    COALESCE(jc.created_at, NOW())::TIMESTAMPTZ
  FROM joincompetition jc
  WHERE jc.competition_id = competition_identifier  -- Changed from competitionid

  UNION ALL

  SELECT
    ('tickets-' || COALESCE(t.canonical_user_id, t.user_id, 'unknown') || '-' || t.competition_id::TEXT)::TEXT,
    COALESCE(t.competition_id::TEXT, '')::TEXT,
    COALESCE(t.user_id, '')::TEXT,
    COALESCE(t.user_id, '')::TEXT,
    COUNT(*)::INTEGER,
    string_agg(t.ticket_number::TEXT, ',' ORDER BY t.ticket_number)::TEXT,
    COALESCE(SUM(t.purchase_price), 0)::NUMERIC,
    COALESCE(t.user_id, '')::TEXT,
    'USDC'::TEXT,
    ''::TEXT,
    MIN(t.created_at)::TIMESTAMPTZ,
    MIN(t.created_at)::TIMESTAMPTZ
  FROM tickets t
  WHERE t.competition_id = competition_identifier
    AND NOT EXISTS (
      SELECT 1 FROM joincompetition jc2
      WHERE jc2.competition_id = competition_identifier  -- Changed from competitionid
        AND (jc2.canonical_user_id = t.canonical_user_id
          OR LOWER(jc2.wallet_address) = LOWER(t.user_id)
          OR jc2.userid::TEXT = t.user_id)
    )
  GROUP BY t.competition_id, t.canonical_user_id, t.user_id

  ORDER BY purchasedate DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_competition_entries_bypass_rls(UUID) TO authenticated, anon, service_role;

CREATE OR REPLACE FUNCTION public.get_competition_entries(competition_identifier UUID)
RETURNS TABLE (
  uid TEXT, competitionid TEXT, userid TEXT, privy_user_id TEXT,
  numberoftickets INTEGER, ticketnumbers TEXT, amountspent NUMERIC,
  wallet_address TEXT, chain TEXT, transactionhash TEXT,
  purchasedate TIMESTAMPTZ, created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN QUERY SELECT * FROM get_competition_entries_bypass_rls(competition_identifier);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_competition_entries(UUID) TO authenticated, anon, service_role;

-- Force PostgREST schema reload
NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '========================================================';
  RAISE NOTICE 'FIXED: get_competition_entries_bypass_rls';
  RAISE NOTICE 'FIXED: get_competition_entries';
  RAISE NOTICE 'ALL FUNCTIONS NOW USE competition_id';
  RAISE NOTICE 'NO MORE competitionid REFERENCES';
  RAISE NOTICE '========================================================';
END $$;
