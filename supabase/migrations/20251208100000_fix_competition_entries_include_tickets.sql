/*
  # Fix Competition Entries RPC to Include Tickets Table Fallback

  ## Problem
  The `get_competition_entries_bypass_rls` function only queries the `joincompetition` table.
  However, the `purchase-tickets-with-bonus` function creates entries in BOTH:
  - `tickets` table (via assignTickets() - always succeeds)
  - `joincompetition` table (for dashboard display - can fail silently)

  When the `joincompetition` insert fails, tickets exist but entries don't appear in the UI
  because the RPC function doesn't check the `tickets` table as a fallback.

  Additionally, there was a type mismatch: `competitionid` in `joincompetition` is TEXT,
  but was being compared directly to UUID causing no results.

  ## Solution
  Update the RPC function to:
  1. Fix the TEXT/UUID type mismatch by casting properly
  2. Query both `joincompetition` AND `tickets` tables
  3. Aggregate tickets from the `tickets` table that don't have corresponding `joincompetition` entries
  4. Deduplicate results across both sources
  5. Support both UUID and legacy UID identifiers
*/

-- Drop existing function first to ensure clean recreation
DROP FUNCTION IF EXISTS get_competition_entries_bypass_rls(text);

-- Recreate with tickets table fallback and proper type handling
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
  -- Handle TEXT competitionid column by comparing as TEXT
  SELECT
    COALESCE(jc.uid, jc.id::text) as uid,
    jc.competitionid::text as competitionid,
    jc.userid,
    jc.privy_user_id,
    jc.numberoftickets,
    jc.ticketnumbers,
    jc.amountspent,
    jc.walletaddress,
    jc.chain,
    jc.transactionhash,
    jc.purchasedate::timestamptz,
    jc.created_at::timestamptz
  FROM joincompetition jc
  WHERE
    -- Match against the competition identifier (comparing as TEXT to handle the column type)
    jc.competitionid = competition_identifier
    OR jc.competitionid = comp_uuid::text
    OR jc.competitionid = comp_uid_text
    OR (comp_uuid IS NOT NULL AND jc.competitionid::text = comp_uuid::text)

  UNION ALL

  -- Part 2: Get tickets from tickets table that don't have joincompetition entries
  -- This catches purchases where joincompetition insert failed but tickets were created
  SELECT
    ('tickets-' || t.privy_user_id || '-' || COALESCE(MIN(t.created_at)::text, ''))::text as uid,
    t.competition_id::text as competitionid,
    t.privy_user_id as userid,
    t.privy_user_id as privy_user_id,
    COUNT(*)::integer as numberoftickets,
    string_agg(t.ticket_number::text, ',' ORDER BY t.ticket_number) as ticketnumbers,
    COALESCE(SUM(t.purchase_price), 0)::numeric as amountspent,
    NULL::text as walletaddress,
    'USDC'::text as chain,
    NULL::text as transactionhash,
    MIN(t.created_at)::timestamptz as purchasedate,
    MIN(t.created_at)::timestamptz as created_at
  FROM tickets t
  WHERE t.competition_id = comp_uuid
    -- Exclude tickets that already have a joincompetition entry (avoid duplicates)
    AND NOT EXISTS (
      SELECT 1 FROM joincompetition jc2
      WHERE (
        jc2.competitionid = competition_identifier
        OR jc2.competitionid = comp_uuid::text
        OR jc2.competitionid = comp_uid_text
      )
      AND (jc2.privy_user_id = t.privy_user_id OR jc2.userid = t.privy_user_id)
    )
  GROUP BY t.competition_id, t.privy_user_id

  ORDER BY purchasedate DESC;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_competition_entries_bypass_rls(text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_competition_entries_bypass_rls(text) TO anon;
GRANT EXECUTE ON FUNCTION get_competition_entries_bypass_rls(text) TO service_role;

-- Add helpful comment
COMMENT ON FUNCTION get_competition_entries_bypass_rls(text) IS
'Returns competition entries from joincompetition table with fallback to tickets table for entries where joincompetition insert failed. Supports UUID and legacy UID identifiers.';
