/*
  # Add missing get_sold_tickets_for_competition_bypass_rls RPC function

  ## Problem:
  The client code in database.ts:1196 calls `get_sold_tickets_for_competition_bypass_rls`
  as a fallback when the main unavailable tickets RPC fails. However, this function
  doesn't exist in the database, causing the fallback to fail.

  ## Solution:
  1. Create the `get_sold_tickets_for_competition_bypass_rls` RPC function
  2. Use SECURITY DEFINER to bypass RLS
  3. Properly handle UUID/TEXT type mismatches in joincompetition table
  4. Check both UUID (as text) AND legacy uid for backwards compatibility
*/

-- ============================================================================
-- Part 1: Create get_sold_tickets_for_competition_bypass_rls function
-- This function returns ONLY sold tickets (not pending), used as a fallback
-- ============================================================================

DROP FUNCTION IF EXISTS get_sold_tickets_for_competition_bypass_rls(text);

CREATE OR REPLACE FUNCTION get_sold_tickets_for_competition_bypass_rls(
  competition_identifier text
)
RETURNS TABLE (
  ticket_number integer
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_comp_uuid uuid;
  v_comp_uid_legacy text;
BEGIN
  -- Validate input
  IF competition_identifier IS NULL OR trim(competition_identifier) = '' THEN
    RETURN;
  END IF;

  -- Try to parse as UUID
  BEGIN
    v_comp_uuid := competition_identifier::uuid;
    -- Also get the legacy uid for this competition
    SELECT c.uid INTO v_comp_uid_legacy
    FROM competitions c
    WHERE c.id = v_comp_uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    -- Not a UUID, try to lookup by legacy uid field
    SELECT c.id, c.uid INTO v_comp_uuid, v_comp_uid_legacy
    FROM competitions c
    WHERE c.uid = competition_identifier
    LIMIT 1;
  END;

  -- If no valid competition found, return empty
  IF v_comp_uuid IS NULL THEN
    RETURN;
  END IF;

  -- Return sold tickets from multiple sources
  RETURN QUERY

  -- Source 1: Sold tickets from joincompetition table (comma-separated string)
  -- Check BOTH UUID (as text) AND legacy uid
  SELECT DISTINCT
    CAST(trim(t_num) AS integer) as ticket_number
  FROM (
    SELECT unnest(string_to_array(jc.ticketnumbers, ',')) as t_num
    FROM joincompetition jc
    WHERE (
      jc.competitionid = v_comp_uuid::text
      OR (v_comp_uid_legacy IS NOT NULL AND jc.competitionid = v_comp_uid_legacy)
    )
      AND jc.ticketnumbers IS NOT NULL
      AND trim(jc.ticketnumbers) != ''
  ) jc_tickets
  WHERE trim(t_num) ~ '^[0-9]+$'  -- Only valid integers

  UNION

  -- Source 2: Sold tickets from tickets table
  SELECT DISTINCT
    t.ticket_number
  FROM tickets t
  WHERE t.competition_id = v_comp_uuid

  ORDER BY ticket_number;
END;
$$;

-- Grant permissions to all roles for public ticket availability info
GRANT EXECUTE ON FUNCTION get_sold_tickets_for_competition_bypass_rls(text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_sold_tickets_for_competition_bypass_rls(text) TO anon;
GRANT EXECUTE ON FUNCTION get_sold_tickets_for_competition_bypass_rls(text) TO service_role;

COMMENT ON FUNCTION get_sold_tickets_for_competition_bypass_rls(text) IS
'Returns all sold tickets for a competition, bypassing RLS.
Checks both joincompetition and tickets tables.
Properly handles UUID/TEXT type mismatches and legacy uid lookups.
Used as a fallback when the main unavailable tickets RPC fails.';


-- ============================================================================
-- Part 2: Ensure get_unavailable_tickets_for_competition_bypass_rls uses
-- correct parameter names (p_competition_identifier, p_exclude_user_id)
-- and includes legacy uid lookup
-- ============================================================================

DROP FUNCTION IF EXISTS get_unavailable_tickets_for_competition_bypass_rls(text, text);

CREATE OR REPLACE FUNCTION get_unavailable_tickets_for_competition_bypass_rls(
  p_competition_identifier text,
  p_exclude_user_id text DEFAULT NULL
)
RETURNS TABLE (
  ticket_number integer,
  source text,
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_comp_uuid uuid;
  v_comp_uid_legacy text;
BEGIN
  -- Validate input
  IF p_competition_identifier IS NULL OR trim(p_competition_identifier) = '' THEN
    RETURN;
  END IF;

  -- Try to parse as UUID
  BEGIN
    v_comp_uuid := p_competition_identifier::uuid;
    -- Also get the legacy uid for this competition
    SELECT c.uid INTO v_comp_uid_legacy
    FROM competitions c
    WHERE c.id = v_comp_uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    -- Not a UUID, try to lookup by legacy uid field
    SELECT c.id, c.uid INTO v_comp_uuid, v_comp_uid_legacy
    FROM competitions c
    WHERE c.uid = p_competition_identifier
    LIMIT 1;
  END;

  -- If no valid competition found, return empty
  IF v_comp_uuid IS NULL THEN
    RETURN;
  END IF;

  -- Return unavailable tickets from multiple sources
  RETURN QUERY

  -- Source 1: Sold tickets from joincompetition table (comma-separated string)
  -- Check BOTH UUID (as text) AND legacy uid
  SELECT DISTINCT
    CAST(trim(t_num) AS integer) as ticket_number,
    'sold'::text as source,
    NULL::timestamptz as expires_at
  FROM (
    SELECT unnest(string_to_array(jc.ticketnumbers, ',')) as t_num
    FROM joincompetition jc
    WHERE (
      jc.competitionid = v_comp_uuid::text
      OR (v_comp_uid_legacy IS NOT NULL AND jc.competitionid = v_comp_uid_legacy)
    )
      AND jc.ticketnumbers IS NOT NULL
      AND trim(jc.ticketnumbers) != ''
  ) jc_tickets
  WHERE trim(t_num) ~ '^[0-9]+$'  -- Only valid integers

  UNION ALL

  -- Source 2: Sold tickets from tickets table
  SELECT DISTINCT
    t.ticket_number,
    'sold'::text as source,
    NULL::timestamptz as expires_at
  FROM tickets t
  WHERE t.competition_id = v_comp_uuid

  UNION ALL

  -- Source 3: Pending tickets from pending_tickets table (excluding specified user if provided)
  SELECT DISTINCT
    pt_ticket as ticket_number,
    'pending'::text as source,
    pt_expires as expires_at
  FROM (
    SELECT
      unnest(pt.ticket_numbers) as pt_ticket,
      pt.expires_at as pt_expires,
      pt.user_id as pt_user_id
    FROM pending_tickets pt
    WHERE pt.competition_id = v_comp_uuid
      AND pt.status = 'pending'
      AND pt.expires_at > NOW()
  ) pending
  WHERE
    -- If p_exclude_user_id is provided, exclude that user's reservations
    (p_exclude_user_id IS NULL OR pending.pt_user_id != p_exclude_user_id)

  ORDER BY ticket_number;
END;
$$;

-- Grant permissions to all roles
GRANT EXECUTE ON FUNCTION get_unavailable_tickets_for_competition_bypass_rls(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_unavailable_tickets_for_competition_bypass_rls(text, text) TO anon;
GRANT EXECUTE ON FUNCTION get_unavailable_tickets_for_competition_bypass_rls(text, text) TO service_role;

COMMENT ON FUNCTION get_unavailable_tickets_for_competition_bypass_rls(text, text) IS
'Returns all unavailable tickets (sold + pending) for a competition, bypassing RLS.
Second parameter optionally excludes a specific user''s pending reservations.
Properly handles UUID/TEXT type mismatches and legacy uid lookups.';


-- ============================================================================
-- Completion Notice
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '============================================================';
  RAISE NOTICE 'Missing RPC Functions Migration Complete';
  RAISE NOTICE '============================================================';
  RAISE NOTICE 'Changes:';
  RAISE NOTICE '  - Created get_sold_tickets_for_competition_bypass_rls RPC';
  RAISE NOTICE '  - Updated get_unavailable_tickets_for_competition_bypass_rls';
  RAISE NOTICE '    with correct parameter names and legacy uid support';
  RAISE NOTICE '';
  RAISE NOTICE 'These functions properly handle:';
  RAISE NOTICE '  - UUID to TEXT casting for joincompetition.competitionid';
  RAISE NOTICE '  - Legacy uid lookups for backwards compatibility';
  RAISE NOTICE '  - SECURITY DEFINER to bypass RLS issues';
  RAISE NOTICE '============================================================';
END $$;
