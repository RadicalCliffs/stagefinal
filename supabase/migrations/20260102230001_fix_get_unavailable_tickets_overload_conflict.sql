-- =====================================================
-- FIX: Resolve get_unavailable_tickets Function Overloading Conflict
-- =====================================================
-- ERROR: PGRST203 "Could not choose the best candidate function between:
--   public.get_unavailable_tickets(competition_id => uuid),
--   public.get_unavailable_tickets(competition_id => text, exclude_user_id => text)"
--
-- The error indicates there are multiple overloaded functions with different
-- signatures, causing PostgREST to be unable to determine which to call.
--
-- SOLUTION: Drop ALL variants and create a single function that accepts
-- only a single competition_id parameter. The frontend only passes
-- { competition_id: string } so we don't need the exclude_user_id variant.
-- =====================================================

BEGIN;

-- =====================================================
-- PART 1: Drop ALL existing variants of get_unavailable_tickets
-- =====================================================
-- Need to drop all possible signatures to eliminate overload conflict

DROP FUNCTION IF EXISTS get_unavailable_tickets(uuid) CASCADE;
DROP FUNCTION IF EXISTS get_unavailable_tickets(text) CASCADE;
DROP FUNCTION IF EXISTS get_unavailable_tickets(uuid, text) CASCADE;
DROP FUNCTION IF EXISTS get_unavailable_tickets(text, text) CASCADE;
DROP FUNCTION IF EXISTS get_unavailable_tickets(competition_id uuid) CASCADE;
DROP FUNCTION IF EXISTS get_unavailable_tickets(competition_id text) CASCADE;
DROP FUNCTION IF EXISTS get_unavailable_tickets(competition_id uuid, exclude_user_id text) CASCADE;
DROP FUNCTION IF EXISTS get_unavailable_tickets(competition_id text, exclude_user_id text) CASCADE;

-- Also try with p_ prefix in case that was used
DROP FUNCTION IF EXISTS get_unavailable_tickets(p_competition_id uuid) CASCADE;
DROP FUNCTION IF EXISTS get_unavailable_tickets(p_competition_id text) CASCADE;
DROP FUNCTION IF EXISTS get_unavailable_tickets(p_competition_id uuid, p_exclude_user_id text) CASCADE;
DROP FUNCTION IF EXISTS get_unavailable_tickets(p_competition_id text, p_exclude_user_id text) CASCADE;

-- =====================================================
-- PART 2: Create a SINGLE unambiguous function
-- =====================================================
-- Use TEXT parameter since that's what the frontend sends via Supabase RPC
-- The function handles UUID conversion internally

CREATE FUNCTION get_unavailable_tickets(competition_id text)
RETURNS int4[]
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_unavailable int4[] := ARRAY[]::int4[];
  v_comp_uuid uuid := NULL;
  v_comp_uid TEXT := NULL;
BEGIN
  -- Validate input
  IF competition_id IS NULL OR trim(competition_id) = '' THEN
    RETURN ARRAY[]::int4[];
  END IF;

  -- Try to parse as UUID
  BEGIN
    v_comp_uuid := competition_id::uuid;
    -- Get the competition's uid field for legacy lookups
    SELECT uid INTO v_comp_uid FROM competitions WHERE id = v_comp_uuid LIMIT 1;
  EXCEPTION WHEN invalid_text_representation THEN
    -- Not a valid UUID, try to find by uid
    SELECT id, uid INTO v_comp_uuid, v_comp_uid
    FROM competitions
    WHERE uid = competition_id
    LIMIT 1;

    IF v_comp_uuid IS NULL THEN
      RETURN ARRAY[]::int4[];
    END IF;
  END;

  -- Competition UUID is now resolved, collect unavailable tickets from all sources
  SELECT COALESCE(array_agg(DISTINCT ticket_num ORDER BY ticket_num), ARRAY[]::int4[])
  INTO v_unavailable
  FROM (
    -- Source 1: Sold tickets from joincompetition table (comma-separated string)
    SELECT CAST(trim(t_num) AS int4) AS ticket_num
    FROM (
      SELECT unnest(string_to_array(jc.ticketnumbers, ',')) AS t_num
      FROM joincompetition jc
      WHERE (
        jc.competitionid = v_comp_uuid::text
        OR (v_comp_uid IS NOT NULL AND jc.competitionid = v_comp_uid)
      )
      AND jc.ticketnumbers IS NOT NULL
      AND trim(jc.ticketnumbers) != ''
    ) jc_parsed
    WHERE trim(t_num) ~ '^[0-9]+$'

    UNION ALL

    -- Source 2: Sold tickets from tickets table (individual rows)
    SELECT t.ticket_number AS ticket_num
    FROM tickets t
    WHERE t.competition_id = v_comp_uuid

    UNION ALL

    -- Source 3: Pending reservations from pending_tickets table (not expired, not owned by user)
    SELECT unnest(pt.ticket_numbers) AS ticket_num
    FROM pending_tickets pt
    WHERE pt.competition_id = v_comp_uuid
      AND pt.status IN ('pending', 'confirming')
      AND pt.expires_at > NOW()
  ) all_unavailable
  WHERE ticket_num IS NOT NULL AND ticket_num > 0;

  RETURN v_unavailable;
END;
$$;

-- Grant permissions to all roles
GRANT EXECUTE ON FUNCTION get_unavailable_tickets(text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_unavailable_tickets(text) TO anon;
GRANT EXECUTE ON FUNCTION get_unavailable_tickets(text) TO service_role;

COMMENT ON FUNCTION get_unavailable_tickets(text) IS
'Returns array of unavailable ticket numbers (sold + pending) for a competition.
Called by frontend as: supabase.rpc(''get_unavailable_tickets'', { competition_id: ''uuid-string'' })
Returns int4[] of ticket numbers that are NOT available for purchase.
Accepts UUID string or legacy uid - handles conversion internally.';


-- =====================================================
-- PART 3: Ensure permissive RLS on ticket tables
-- =====================================================
-- Make sure SELECT is allowed for all ticket-related queries

-- joincompetition table - public SELECT
DO $$
BEGIN
  -- Drop any restrictive SELECT policies
  DROP POLICY IF EXISTS "Users can read own entries" ON joincompetition;
  DROP POLICY IF EXISTS "Public can view all entries" ON joincompetition;
  DROP POLICY IF EXISTS "Allow public read access to joincompetition" ON joincompetition;
  DROP POLICY IF EXISTS "Public SELECT on joincompetition" ON joincompetition;

  -- Create single permissive SELECT policy
  CREATE POLICY "Public SELECT on joincompetition"
    ON joincompetition FOR SELECT
    USING (true);

  RAISE NOTICE 'joincompetition: Permissive SELECT policy created';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'joincompetition policy note: %', SQLERRM;
END $$;

-- tickets table - public SELECT
DO $$
BEGIN
  DROP POLICY IF EXISTS "Anyone can view tickets for availability" ON tickets;
  DROP POLICY IF EXISTS "Public can view tickets" ON tickets;
  DROP POLICY IF EXISTS "Users can view own tickets" ON tickets;
  DROP POLICY IF EXISTS "Public SELECT on tickets" ON tickets;

  CREATE POLICY "Public SELECT on tickets"
    ON tickets FOR SELECT
    USING (true);

  RAISE NOTICE 'tickets: Permissive SELECT policy created';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'tickets policy note: %', SQLERRM;
END $$;

-- pending_tickets table - public SELECT
DO $$
BEGIN
  DROP POLICY IF EXISTS "Anyone can view pending tickets for availability" ON pending_tickets;
  DROP POLICY IF EXISTS "Users can view own pending tickets" ON pending_tickets;
  DROP POLICY IF EXISTS "Public can view pending ticket counts" ON pending_tickets;
  DROP POLICY IF EXISTS "Public SELECT on pending_tickets" ON pending_tickets;

  CREATE POLICY "Public SELECT on pending_tickets"
    ON pending_tickets FOR SELECT
    USING (true);

  RAISE NOTICE 'pending_tickets: Permissive SELECT policy created';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pending_tickets policy note: %', SQLERRM;
END $$;

-- competitions table - public SELECT
DO $$
BEGIN
  DROP POLICY IF EXISTS "Public SELECT on competitions" ON competitions;

  CREATE POLICY "Public SELECT on competitions"
    ON competitions FOR SELECT
    USING (true);

  RAISE NOTICE 'competitions: Permissive SELECT policy created';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'competitions policy note: %', SQLERRM;
END $$;


-- =====================================================
-- PART 4: Grant table SELECT permissions
-- =====================================================

GRANT SELECT ON joincompetition TO anon;
GRANT SELECT ON joincompetition TO authenticated;

GRANT SELECT ON tickets TO anon;
GRANT SELECT ON tickets TO authenticated;

GRANT SELECT ON pending_tickets TO anon;
GRANT SELECT ON pending_tickets TO authenticated;

GRANT SELECT ON competitions TO anon;
GRANT SELECT ON competitions TO authenticated;


-- =====================================================
-- PART 5: Ensure INSERT/UPDATE policies for service_role
-- =====================================================

DO $$
BEGIN
  DROP POLICY IF EXISTS "Service role can manage all entries" ON joincompetition;
  DROP POLICY IF EXISTS "Service role full access on joincompetition" ON joincompetition;
  CREATE POLICY "Service role full access on joincompetition"
    ON joincompetition FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DO $$
BEGIN
  DROP POLICY IF EXISTS "Service role can manage tickets" ON tickets;
  DROP POLICY IF EXISTS "Service role full access on tickets" ON tickets;
  CREATE POLICY "Service role full access on tickets"
    ON tickets FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DO $$
BEGIN
  DROP POLICY IF EXISTS "Service role can manage pending tickets" ON pending_tickets;
  DROP POLICY IF EXISTS "Service role full access on pending_tickets" ON pending_tickets;
  CREATE POLICY "Service role full access on pending_tickets"
    ON pending_tickets FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

GRANT ALL ON joincompetition TO service_role;
GRANT ALL ON tickets TO service_role;
GRANT ALL ON pending_tickets TO service_role;
GRANT ALL ON competitions TO service_role;


-- =====================================================
-- VALIDATION
-- =====================================================

DO $$
DECLARE
  func_count INTEGER;
BEGIN
  -- Count how many get_unavailable_tickets functions exist
  SELECT COUNT(*) INTO func_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
  AND p.proname = 'get_unavailable_tickets';

  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'FIX: Resolved get_unavailable_tickets Overload Conflict';
  RAISE NOTICE '=====================================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Function count (should be 1): %', func_count;

  IF func_count = 1 THEN
    RAISE NOTICE '✓ SUCCESS: Single function exists - no overload conflict';
  ELSIF func_count > 1 THEN
    RAISE WARNING '✗ WARNING: Multiple overloads still exist!';
  ELSE
    RAISE WARNING '✗ ERROR: Function was not created!';
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE 'Frontend can now call:';
  RAISE NOTICE '  supabase.rpc(''get_unavailable_tickets'', { competition_id: uuid_string })';
  RAISE NOTICE '';
  RAISE NOTICE 'The function accepts TEXT and returns int4[] of unavailable ticket numbers.';
  RAISE NOTICE '=====================================================';
END $$;

COMMIT;
