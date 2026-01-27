-- Migration: Add username field to get_competition_entries RPC functions
-- This ensures usernames are fetched and returned with entry data for display in tables

-- Drop and recreate get_competition_entries_bypass_rls with username field
DROP FUNCTION IF EXISTS get_competition_entries_bypass_rls(text) CASCADE;

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
  username text,
  chain text,
  transactionhash text,
  purchasedate timestamp with time zone,
  created_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  comp_uuid uuid;
  comp_uid_text text;
BEGIN
  -- Try to parse as UUID
  BEGIN
    comp_uuid := competition_identifier::uuid;
    comp_uid_text := competition_identifier;
  EXCEPTION WHEN invalid_text_representation THEN
    -- Not a UUID, try to lookup by uid
    SELECT c.id, c.uid INTO comp_uuid, comp_uid_text
    FROM competitions c
    WHERE c.uid = competition_identifier
    LIMIT 1;
  END;

  -- If we have a UUID, also get the corresponding uid
  IF comp_uuid IS NOT NULL AND comp_uid_text IS NULL THEN
    SELECT c.uid INTO comp_uid_text FROM competitions c WHERE c.id = comp_uuid LIMIT 1;
  END IF;

  RETURN QUERY
  -- Part 1: Get entries from joincompetition table (primary source)
  -- Join with canonical_users to fetch username
  SELECT
    COALESCE(jc.uid, jc.id::text) as uid,
    jc.competitionid::text as competitionid,
    jc.userid,
    jc.privy_user_id,
    jc.numberoftickets,
    jc.ticketnumbers,
    jc.amountspent,
    jc.wallet_address,
    COALESCE(cu.username, NULL) as username,
    jc.chain,
    jc.transactionhash,
    jc.purchasedate::timestamptz,
    jc.created_at::timestamptz
  FROM joincompetition jc
  LEFT JOIN canonical_users cu ON (
    -- Match by canonical_user_id (prize:pid:0x...)
    cu.canonical_user_id = jc.wallet_address
    -- Or match by wallet_address (0x...)
    OR LOWER(cu.wallet_address) = LOWER(jc.wallet_address)
    -- Or match by canonical_user_id field in joincompetition (if populated)
    OR (jc.canonical_user_id IS NOT NULL AND cu.canonical_user_id = jc.canonical_user_id)
    -- Or match by privy_user_id
    OR (jc.privy_user_id IS NOT NULL AND cu.privy_user_id = jc.privy_user_id)
  )
  WHERE
    -- Match against the competition identifier
    jc.competitionid = competition_identifier
    OR jc.competitionid = comp_uuid::text
    OR jc.competitionid = comp_uid_text
    OR (comp_uuid IS NOT NULL AND jc.competitionid::text = comp_uuid::text)

  UNION ALL

  -- Part 2: Get tickets from tickets table that don't have joincompetition entries
  -- Join with canonical_users to fetch username
  SELECT
    ('tickets-' || t.privy_user_id || '-' || COALESCE(MIN(t.created_at)::text, ''))::text as uid,
    t.competition_id::text as competitionid,
    t.privy_user_id as userid,
    t.privy_user_id as privy_user_id,
    COUNT(*)::integer as numberoftickets,
    string_agg(t.ticket_number::text, ',' ORDER BY t.ticket_number) as ticketnumbers,
    COALESCE(SUM(t.purchase_price), 0)::numeric as amountspent,
    NULL::text as wallet_address,
    COALESCE(cu.username, NULL) as username,
    'USDC'::text as chain,
    NULL::text as transactionhash,
    MIN(t.created_at)::timestamptz as purchasedate,
    MIN(t.created_at)::timestamptz as created_at
  FROM tickets t
  LEFT JOIN canonical_users cu ON cu.privy_user_id = t.privy_user_id
  WHERE
    (t.competition_id = comp_uuid OR t.competition_id::text = comp_uid_text)
    AND NOT EXISTS (
      SELECT 1 FROM joincompetition jc
      WHERE jc.privy_user_id = t.privy_user_id
      AND jc.ticketnumbers LIKE '%' || t.ticket_number || '%'
    )
  GROUP BY t.competition_id, t.privy_user_id, cu.username

  ORDER BY purchasedate DESC;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_competition_entries_bypass_rls(text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_competition_entries_bypass_rls(text) TO anon;
GRANT EXECUTE ON FUNCTION get_competition_entries_bypass_rls(text) TO service_role;

-- Add helpful comment
COMMENT ON FUNCTION get_competition_entries_bypass_rls(text) IS
'Returns competition entries with usernames, bypassing RLS. Supports competition.id (UUID) or competition.uid (legacy text) as identifier. Joins with canonical_users to include username field.';
