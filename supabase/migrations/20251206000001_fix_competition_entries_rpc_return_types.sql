/*
  # Fix get_competition_entries_bypass_rls Return Type Mismatch

  ## Problem
  The previous migration (20251206000000_sync_production_rpc_functions.sql) declared
  incorrect return types for get_competition_entries_bypass_rls:
  - Returned `uid uuid` but joincompetition.uid is TEXT
  - This caused 400 errors when calling the RPC function

  ## Solution
  Recreate the function with correct TEXT return types that match the actual
  joincompetition table schema where:
  - uid is TEXT
  - competitionid is TEXT

  This also improves the lookup logic to properly handle both UUID and legacy UID
  formats for competition identifiers.
*/

-- Drop existing function to recreate with correct signature
DROP FUNCTION IF EXISTS get_competition_entries_bypass_rls(text);

-- Recreate get_competition_entries_bypass_rls with correct TEXT return types
CREATE OR REPLACE FUNCTION get_competition_entries_bypass_rls(competition_identifier text)
RETURNS TABLE (
  uid text,
  competitionid text,
  userid text,
  privy_user_id text,
  numberoftickets integer,
  ticketnumbers text,
  amountspent numeric,
  walletaddress text,
  chain text,
  transactionhash text,
  purchasedate timestamp with time zone,
  created_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  comp_uuid uuid;
  comp_uid text;
BEGIN
  -- Try to parse as UUID first
  BEGIN
    comp_uuid := competition_identifier::uuid;
    -- If successful, also look up the corresponding uid
    SELECT c.uid INTO comp_uid FROM competitions c WHERE c.id = comp_uuid LIMIT 1;
  EXCEPTION WHEN invalid_text_representation THEN
    -- Not a UUID, treat as uid and look up the UUID
    comp_uid := competition_identifier;
    SELECT c.id INTO comp_uuid FROM competitions c WHERE c.uid = competition_identifier LIMIT 1;
  END;

  -- Return entries matching either the UUID or uid
  RETURN QUERY
  SELECT
    jc.uid,
    jc.competitionid,
    jc.userid,
    jc.privy_user_id,
    jc.numberoftickets,
    jc.ticketnumbers,
    jc.amountspent,
    jc.walletaddress,
    jc.chain,
    jc.transactionhash,
    jc.purchasedate,
    jc.created_at
  FROM joincompetition jc
  WHERE
    -- Match against competition UUID (as text, since competitionid is text)
    jc.competitionid = comp_uuid::text
    -- Or match against competition uid
    OR jc.competitionid = comp_uid
    -- Or direct match (handles edge cases)
    OR jc.competitionid = competition_identifier
  ORDER BY jc.purchasedate DESC;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_competition_entries_bypass_rls(text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_competition_entries_bypass_rls(text) TO anon;

-- Add helpful comment
COMMENT ON FUNCTION get_competition_entries_bypass_rls(text) IS
'Returns competition entries bypassing RLS. Supports competition.id (UUID) or competition.uid (legacy text) as identifier. Returns TEXT types matching the joincompetition table schema.';
