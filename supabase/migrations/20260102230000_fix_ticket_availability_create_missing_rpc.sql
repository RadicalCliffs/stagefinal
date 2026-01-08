-- =====================================================
-- FIX: Create Missing get_unavailable_tickets RPC Function
-- =====================================================
-- This migration addresses the critical issue where tickets briefly show
-- as available then switch to unavailable. The root cause is that the
-- frontend calls .rpc('get_unavailable_tickets', { competition_id: ... })
-- but this function DOES NOT EXIST in the database.
--
-- When the RPC fails with 404, the frontend falls back to direct table
-- queries, but those may return incorrect results or fail silently,
-- causing all tickets to appear unavailable.
--
-- SOLUTION:
-- 1. Create the get_unavailable_tickets RPC function that frontend expects
-- 2. Ensure all ticket-related tables have permissive SELECT RLS
-- 3. Provide a consistent API that returns int4[] of unavailable ticket numbers
-- =====================================================

BEGIN;

-- =====================================================
-- PART 1: Create the MISSING get_unavailable_tickets RPC
-- =====================================================
-- This is the function the frontend expects to call!
-- Signature: get_unavailable_tickets(competition_id uuid) RETURNS int4[]

DROP FUNCTION IF EXISTS get_unavailable_tickets(uuid) CASCADE;
DROP FUNCTION IF EXISTS get_unavailable_tickets(text) CASCADE;

-- Create the function with UUID parameter (what frontend sends)
CREATE OR REPLACE FUNCTION get_unavailable_tickets(competition_id uuid)
RETURNS int4[]
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_unavailable int4[] := ARRAY[]::int4[];
  v_comp_uid TEXT;
BEGIN
  -- Validate input
  IF competition_id IS NULL THEN
    RETURN ARRAY[]::int4[];
  END IF;

  -- Get the competition's uid field for legacy lookups
  SELECT uid INTO v_comp_uid FROM competitions WHERE id = competition_id LIMIT 1;

  -- Collect unavailable tickets from all sources
  SELECT COALESCE(array_agg(DISTINCT ticket_num), ARRAY[]::int4[])
  INTO v_unavailable
  FROM (
    -- Source 1: Sold tickets from joincompetition table (comma-separated string)
    SELECT CAST(trim(t_num) AS int4) AS ticket_num
    FROM (
      SELECT unnest(string_to_array(jc.ticketnumbers, ',')) AS t_num
      FROM joincompetition jc
      WHERE (
        jc.competitionid = competition_id::text
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
    WHERE t.competition_id = get_unavailable_tickets.competition_id

    UNION ALL

    -- Source 3: Pending reservations from pending_tickets table
    SELECT unnest(pt.ticket_numbers) AS ticket_num
    FROM pending_tickets pt
    WHERE pt.competition_id = get_unavailable_tickets.competition_id
      AND pt.status IN ('pending', 'confirming')
      AND pt.expires_at > NOW()
  ) all_unavailable
  WHERE ticket_num IS NOT NULL AND ticket_num > 0;

  RETURN v_unavailable;
END;
$$;

-- Also create a TEXT version for flexibility (accepts UUID string)
CREATE OR REPLACE FUNCTION get_unavailable_tickets(competition_id text)
RETURNS int4[]
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_comp_uuid uuid;
BEGIN
  -- Validate input
  IF competition_id IS NULL OR trim(competition_id) = '' THEN
    RETURN ARRAY[]::int4[];
  END IF;

  -- Try to parse as UUID
  BEGIN
    v_comp_uuid := competition_id::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    -- Not a valid UUID, try to find by uid
    SELECT id INTO v_comp_uuid
    FROM competitions
    WHERE uid = competition_id
    LIMIT 1;

    IF v_comp_uuid IS NULL THEN
      RETURN ARRAY[]::int4[];
    END IF;
  END;

  -- Delegate to UUID version
  RETURN get_unavailable_tickets(v_comp_uuid);
END;
$$;

-- Grant permissions to all roles
GRANT EXECUTE ON FUNCTION get_unavailable_tickets(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_unavailable_tickets(uuid) TO anon;
GRANT EXECUTE ON FUNCTION get_unavailable_tickets(uuid) TO service_role;

GRANT EXECUTE ON FUNCTION get_unavailable_tickets(text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_unavailable_tickets(text) TO anon;
GRANT EXECUTE ON FUNCTION get_unavailable_tickets(text) TO service_role;

COMMENT ON FUNCTION get_unavailable_tickets(uuid) IS
'Returns array of unavailable ticket numbers (sold + pending) for a competition.
Called by frontend as: supabase.rpc(''get_unavailable_tickets'', { competition_id: uuid })
Returns int4[] of ticket numbers that are NOT available for purchase.';

COMMENT ON FUNCTION get_unavailable_tickets(text) IS
'Text wrapper for get_unavailable_tickets. Accepts UUID string or legacy uid.';


-- =====================================================
-- PART 2: Ensure permissive RLS on ticket tables
-- =====================================================
-- Make sure SELECT is allowed for all ticket-related queries

-- 2a. joincompetition table - public SELECT
DO $$
BEGIN
  -- Drop any restrictive SELECT policies
  DROP POLICY IF EXISTS "Users can read own entries" ON joincompetition;
  DROP POLICY IF EXISTS "Public can view all entries" ON joincompetition;
  DROP POLICY IF EXISTS "Allow public read access to joincompetition" ON joincompetition;

  -- Create single permissive SELECT policy
  CREATE POLICY "Public SELECT on joincompetition"
    ON joincompetition FOR SELECT
    USING (true);

  RAISE NOTICE 'joincompetition: Permissive SELECT policy created';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'joincompetition policy error: %', SQLERRM;
END $$;

-- 2b. tickets table - public SELECT
DO $$
BEGIN
  DROP POLICY IF EXISTS "Anyone can view tickets for availability" ON tickets;
  DROP POLICY IF EXISTS "Public can view tickets" ON tickets;
  DROP POLICY IF EXISTS "Users can view own tickets" ON tickets;

  CREATE POLICY "Public SELECT on tickets"
    ON tickets FOR SELECT
    USING (true);

  RAISE NOTICE 'tickets: Permissive SELECT policy created';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'tickets policy error: %', SQLERRM;
END $$;

-- 2c. pending_tickets table - public SELECT
DO $$
BEGIN
  DROP POLICY IF EXISTS "Anyone can view pending tickets for availability" ON pending_tickets;
  DROP POLICY IF EXISTS "Users can view own pending tickets" ON pending_tickets;
  DROP POLICY IF EXISTS "Public can view pending ticket counts" ON pending_tickets;

  CREATE POLICY "Public SELECT on pending_tickets"
    ON pending_tickets FOR SELECT
    USING (true);

  RAISE NOTICE 'pending_tickets: Permissive SELECT policy created';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pending_tickets policy error: %', SQLERRM;
END $$;

-- 2d. competitions table - public SELECT
DO $$
BEGIN
  -- Ensure competitions are readable for ticket grid
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'competitions'
    AND policyname = 'Public SELECT on competitions'
  ) THEN
    CREATE POLICY "Public SELECT on competitions"
      ON competitions FOR SELECT
      USING (true);
    RAISE NOTICE 'competitions: Permissive SELECT policy created';
  ELSE
    RAISE NOTICE 'competitions: SELECT policy already exists';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'competitions policy note: %', SQLERRM;
END $$;


-- =====================================================
-- PART 3: Grant table SELECT permissions
-- =====================================================
-- Ensure basic SELECT grants exist as backup

GRANT SELECT ON joincompetition TO anon;
GRANT SELECT ON joincompetition TO authenticated;

GRANT SELECT ON tickets TO anon;
GRANT SELECT ON tickets TO authenticated;

GRANT SELECT ON pending_tickets TO anon;
GRANT SELECT ON pending_tickets TO authenticated;

GRANT SELECT ON competitions TO anon;
GRANT SELECT ON competitions TO authenticated;


-- =====================================================
-- PART 4: Ensure INSERT/UPDATE policies for service_role
-- =====================================================
-- Service role needs full access for edge functions

DO $$
BEGIN
  -- joincompetition service role policy
  DROP POLICY IF EXISTS "Service role can manage all entries" ON joincompetition;
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
  -- tickets service role policy
  DROP POLICY IF EXISTS "Service role can manage tickets" ON tickets;
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
  -- pending_tickets service role policy
  DROP POLICY IF EXISTS "Service role can manage pending tickets" ON pending_tickets;
  CREATE POLICY "Service role full access on pending_tickets"
    ON pending_tickets FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Grant full access to service_role
GRANT ALL ON joincompetition TO service_role;
GRANT ALL ON tickets TO service_role;
GRANT ALL ON pending_tickets TO service_role;
GRANT ALL ON competitions TO service_role;


-- =====================================================
-- VALIDATION
-- =====================================================

DO $$
DECLARE
  func_exists BOOLEAN;
  func_uuid_exists BOOLEAN;
  func_text_exists BOOLEAN;
BEGIN
  -- Check if functions exist
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'get_unavailable_tickets'
  ) INTO func_exists;

  -- Check UUID version
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    JOIN pg_type t ON p.proargtypes[0] = t.oid
    WHERE n.nspname = 'public'
    AND p.proname = 'get_unavailable_tickets'
    AND t.typname = 'uuid'
  ) INTO func_uuid_exists;

  -- Check TEXT version
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    JOIN pg_type t ON p.proargtypes[0] = t.oid
    WHERE n.nspname = 'public'
    AND p.proname = 'get_unavailable_tickets'
    AND t.typname = 'text'
  ) INTO func_text_exists;

  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'FIX: Create Missing get_unavailable_tickets RPC';
  RAISE NOTICE '=====================================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Function Creation Status:';
  RAISE NOTICE '  get_unavailable_tickets exists: %', func_exists;
  RAISE NOTICE '  - UUID version: %', func_uuid_exists;
  RAISE NOTICE '  - TEXT version: %', func_text_exists;
  RAISE NOTICE '';
  RAISE NOTICE 'Frontend can now call:';
  RAISE NOTICE '  supabase.rpc(''get_unavailable_tickets'', { competition_id: uuid })';
  RAISE NOTICE '';
  RAISE NOTICE 'The function returns int4[] of unavailable ticket numbers.';
  RAISE NOTICE '=====================================================';
END $$;

COMMIT;
