/*
  # Fix Entries Display and Reservation Handling - Part 1

  ## Problem Addressed:
  1. Entries table on competition pages shows "No entries yet" even when entries exist

  ## Root Cause:
  get_competition_entries_bypass_rls RPC doesn't properly combine joincompetition and tickets tables

  ## Solution:
  Update get_competition_entries_bypass_rls to properly query both tables with correct type handling
*/

-- Drop existing function
DROP FUNCTION IF EXISTS get_competition_entries_bypass_rls(text);

-- Recreate with improved logic
CREATE OR REPLACE FUNCTION get_competition_entries_bypass_rls(competition_identifier text)
RETURNS TABLE (
  uid text,
  competitionid text,
  userid text,
  privy_user_id text,
  numberoftickets integer,
  ticketnumbers text,
  amountspent numeric,
  wallet_address text,
  chain text,
  transactionhash text,
  purchasedate timestamp with time zone,
  created_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $func$
DECLARE
  comp_uuid uuid;
  comp_uid_text text;
BEGIN
  -- Normalize the competition identifier
  -- Try to parse as UUID first
  BEGIN
    comp_uuid := competition_identifier::uuid;
    comp_uid_text := competition_identifier;
  EXCEPTION WHEN invalid_text_representation THEN
    -- Not a UUID, try to lookup by legacy uid field
    SELECT c.id, c.uid INTO comp_uuid, comp_uid_text
    FROM competitions c
    WHERE c.uid = competition_identifier
    LIMIT 1;
  END;

  -- If we have a UUID but uid is still the input, look up the actual uid
  IF comp_uuid IS NOT NULL AND comp_uid_text = competition_identifier THEN
    SELECT c.uid INTO comp_uid_text FROM competitions c WHERE c.id = comp_uuid LIMIT 1;
  END IF;

  RETURN QUERY
  -- Source 1: joincompetition table (primary source for confirmed entries)
  SELECT
    COALESCE(jc.uid::text, jc.id::text, gen_random_uuid()::text) as uid,
    COALESCE(jc.competitionid, '')::text as competitionid,
    COALESCE(jc.userid, '')::text as userid,
    COALESCE(jc.privy_user_id, jc.wallet_address, '')::text as privy_user_id,
    COALESCE(jc.numberoftickets, 1)::integer as numberoftickets,
    COALESCE(jc.ticketnumbers, '')::text as ticketnumbers,
    COALESCE(jc.amountspent, 0)::numeric as amountspent,
    COALESCE(jc.wallet_address, '')::text as wallet_address,
    COALESCE(jc.chain, 'Base')::text as chain,
    COALESCE(jc.transactionhash, '')::text as transactionhash,
    COALESCE(jc.purchasedate, jc.created_at, NOW())::timestamptz as purchasedate,
    COALESCE(jc.created_at, NOW())::timestamptz as created_at
  FROM joincompetition jc
  WHERE
    -- Match against competition identifier as TEXT (the column type)
    jc.competitionid = competition_identifier
    -- Also match against UUID cast to text
    OR (comp_uuid IS NOT NULL AND jc.competitionid = comp_uuid::text)
    -- Also match against legacy uid
    OR (comp_uid_text IS NOT NULL AND comp_uid_text != '' AND jc.competitionid = comp_uid_text)

  UNION ALL

  -- Source 2: tickets table (fallback for entries where joincompetition insert may have failed)
  -- Group by user to aggregate their tickets
  SELECT
    ('tickets-' || COALESCE(t.privy_user_id, 'unknown') || '-' || t.competition_id::text)::text as uid,
    COALESCE(t.competition_id::text, '')::text as competitionid,
    COALESCE(t.privy_user_id, '')::text as userid,
    COALESCE(t.privy_user_id, '')::text as privy_user_id,
    COUNT(*)::integer as numberoftickets,
    string_agg(t.ticket_number::text, ',' ORDER BY t.ticket_number)::text as ticketnumbers,
    COALESCE(SUM(t.purchase_price), 0)::numeric as amountspent,
    ''::text as wallet_address,
    'USDC'::text as chain,
    ''::text as transactionhash,
    MIN(t.created_at)::timestamptz as purchasedate,
    MIN(t.created_at)::timestamptz as created_at
  FROM tickets t
  WHERE
    t.competition_id = comp_uuid
    -- Exclude users who already have entries in joincompetition (avoid duplicates)
    AND NOT EXISTS (
      SELECT 1 FROM joincompetition jc2
      WHERE (
        jc2.competitionid = competition_identifier
        OR (comp_uuid IS NOT NULL AND jc2.competitionid = comp_uuid::text)
        OR (comp_uid_text IS NOT NULL AND comp_uid_text != '' AND jc2.competitionid = comp_uid_text)
      )
      AND (
        jc2.privy_user_id = t.privy_user_id
        OR jc2.wallet_address = t.privy_user_id
        OR jc2.userid = t.privy_user_id
      )
    )
  GROUP BY t.competition_id, t.privy_user_id

  ORDER BY purchasedate DESC;
END;
$func$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_competition_entries_bypass_rls(text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_competition_entries_bypass_rls(text) TO anon;
GRANT EXECUTE ON FUNCTION get_competition_entries_bypass_rls(text) TO service_role;

COMMENT ON FUNCTION get_competition_entries_bypass_rls(text) IS
'Returns all entries for a competition from joincompetition table with fallback to tickets table.
Properly handles UUID/TEXT type mismatches and deduplicates across tables.
Fixed in migration 20251216000000.';
