-- RUN THIS NOW IN SUPABASE SQL EDITOR
-- Fixes competition entries showing Anonymous/Unknown

DROP FUNCTION IF EXISTS get_competition_entries_bypass_rls(TEXT) CASCADE;
DROP FUNCTION IF EXISTS get_competition_entries(TEXT) CASCADE;

CREATE OR REPLACE FUNCTION get_competition_entries_bypass_rls(competition_identifier TEXT)
RETURNS TABLE (
  uid TEXT,
  competitionid TEXT,
  userid TEXT,
  privy_user_id TEXT,
  numberoftickets INTEGER,
  ticketnumbers TEXT,
  amountspent NUMERIC,
  walletaddress TEXT,
  username TEXT,
  chain TEXT,
  transactionhash TEXT,
  purchasedate TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  comp_uuid UUID := NULL;
BEGIN
  IF competition_identifier IS NULL OR TRIM(competition_identifier) = '' THEN
    RETURN;
  END IF;

  BEGIN
    comp_uuid := competition_identifier::UUID;
  EXCEPTION WHEN OTHERS THEN
    SELECT c.id INTO comp_uuid FROM competitions c WHERE c.uid = competition_identifier LIMIT 1;
  END;

  RETURN QUERY
  SELECT DISTINCT ON (jc.id)
    COALESCE(jc.uid::TEXT, jc.id::TEXT, gen_random_uuid()::TEXT),
    COALESCE(jc.competitionid, ''),
    COALESCE(jc.userid::TEXT, ''),
    COALESCE(jc.wallet_address, ''),
    COALESCE(jc.numberoftickets, 1)::INTEGER,
    COALESCE(jc.ticketnumbers, ''),
    COALESCE(jc.amountspent, 0)::NUMERIC,
    jc.wallet_address,  -- DIRECTLY return wallet_address, no COALESCE to empty
    COALESCE(cu.username, ''),
    COALESCE(jc.chain, 'Base'),
    COALESCE(jc.transactionhash, ''),
    COALESCE(jc.purchasedate, jc.created_at, NOW()),
    COALESCE(jc.created_at, NOW())
  FROM joincompetition jc
  LEFT JOIN LATERAL (
    SELECT cu2.username 
    FROM canonical_users cu2 
    WHERE cu2.wallet_address = jc.wallet_address 
       OR cu2.canonical_user_id = jc.canonical_user_id
    LIMIT 1
  ) cu ON true
  WHERE jc.competitionid = competition_identifier
     OR jc.competitionid = comp_uuid::TEXT
     OR (comp_uuid IS NOT NULL AND jc.competition_id = comp_uuid)
  ORDER BY jc.id, jc.purchasedate DESC;
END;
$$;

CREATE OR REPLACE FUNCTION get_competition_entries(competition_identifier TEXT)
RETURNS TABLE (
  uid TEXT,
  competitionid TEXT,
  userid TEXT,
  privy_user_id TEXT,
  numberoftickets INTEGER,
  ticketnumbers TEXT,
  amountspent NUMERIC,
  walletaddress TEXT,
  username TEXT,
  chain TEXT,
  transactionhash TEXT,
  purchasedate TIMESTAMPTZ,
  created_at TIMESTAMPTZ
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

GRANT EXECUTE ON FUNCTION get_competition_entries_bypass_rls(TEXT) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION get_competition_entries(TEXT) TO authenticated, anon, service_role;
