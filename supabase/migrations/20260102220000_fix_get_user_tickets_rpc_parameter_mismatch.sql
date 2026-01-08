-- =====================================================
-- FIX: get_user_tickets_for_competition Parameter Mismatch
-- =====================================================
-- This migration fixes HTTP 404 error caused by parameter name mismatch:
--
-- PROBLEM:
-- The frontend calls: get_user_tickets_for_competition(user_id, competition_id)
-- But database has: get_user_tickets_for_competition(competition_identifier, exclude_user_id, user_identifier)
--
-- ERROR:
-- "Could not find the function public.get_user_tickets_for_competition(competition_id, user_id) in the schema cache"
-- "hint": "Perhaps you meant to call the function public.get_user_tickets_for_competition(competition_identifier, exclude_user_id, user_identifier)"
--
-- This causes tickets to appear momentarily before showing as unavailable,
-- because the RPC call fails and falls back to incomplete data sources.
--
-- SOLUTION:
-- Drop ALL versions of this function regardless of signature, then create
-- the correct version with (user_id, competition_id) parameters to match
-- the frontend expectations.
-- =====================================================

BEGIN;

-- =====================================================
-- STEP 1: Drop ALL existing versions of the function
-- =====================================================
-- PostgreSQL allows function overloading with different parameter signatures.
-- We need to drop ALL versions to avoid conflicts.

-- Drop 2-parameter versions (various signatures)
DROP FUNCTION IF EXISTS get_user_tickets_for_competition(text, text) CASCADE;
DROP FUNCTION IF EXISTS get_user_tickets_for_competition(text, uuid) CASCADE;
DROP FUNCTION IF EXISTS get_user_tickets_for_competition(uuid, text) CASCADE;
DROP FUNCTION IF EXISTS get_user_tickets_for_competition(uuid, uuid) CASCADE;

-- Drop 3-parameter versions (the problematic overload from error)
DROP FUNCTION IF EXISTS get_user_tickets_for_competition(text, text, text) CASCADE;

-- Use a DO block to find and drop ANY remaining versions
DO $$
DECLARE
  func_oid oid;
  func_sig text;
BEGIN
  -- Find all remaining versions of this function
  FOR func_oid, func_sig IN
    SELECT p.oid, pg_catalog.pg_get_function_identity_arguments(p.oid)
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'get_user_tickets_for_competition'
      AND n.nspname = 'public'
  LOOP
    RAISE NOTICE 'Dropping existing function: get_user_tickets_for_competition(%)', func_sig;
    EXECUTE 'DROP FUNCTION IF EXISTS public.get_user_tickets_for_competition(' || func_sig || ') CASCADE';
  END LOOP;
END $$;


-- =====================================================
-- STEP 2: Create the correct function with expected parameters
-- =====================================================
-- Frontend calls with: { user_id: string, competition_id: string }
-- So we create with parameters: (user_id text, competition_id text)

CREATE OR REPLACE FUNCTION get_user_tickets_for_competition(
  user_id text,
  competition_id text
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_comp_uuid uuid;
  v_comp_uid text;
  v_tickets integer[];
  v_ticket_count integer;
  v_search_wallet text;
  v_canonical_user_id text;
BEGIN
  -- Validate inputs - return empty result for invalid inputs
  IF user_id IS NULL OR trim(user_id) = '' OR competition_id IS NULL OR trim(competition_id) = '' THEN
    RETURN json_build_object(
      'user_id', COALESCE(user_id, ''),
      'competition_id', COALESCE(competition_id, ''),
      'tickets', ARRAY[]::integer[],
      'ticket_count', 0
    );
  END IF;

  -- Extract wallet address for matching
  -- Handle prize:pid:0x... format
  IF user_id LIKE 'prize:pid:0x%' THEN
    v_search_wallet := LOWER(SUBSTRING(user_id FROM 11));
    v_canonical_user_id := 'prize:pid:' || v_search_wallet;
  -- Handle raw wallet address format
  ELSIF user_id LIKE '0x%' AND LENGTH(user_id) = 42 THEN
    v_search_wallet := LOWER(user_id);
    v_canonical_user_id := 'prize:pid:' || v_search_wallet;
  ELSE
    v_search_wallet := NULL;
    v_canonical_user_id := user_id;
  END IF;

  -- Parse competition ID - try UUID first, then legacy uid
  BEGIN
    v_comp_uuid := competition_id::uuid;
    -- Also get the legacy uid for this competition
    SELECT c.uid INTO v_comp_uid
    FROM competitions c
    WHERE c.id = v_comp_uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    -- Not a UUID, try to lookup by legacy uid field
    SELECT c.id, c.uid INTO v_comp_uuid, v_comp_uid
    FROM competitions c
    WHERE c.uid = competition_id
    LIMIT 1;
  END;

  -- If no valid competition found, return empty result
  IF v_comp_uuid IS NULL THEN
    RETURN json_build_object(
      'user_id', user_id,
      'competition_id', competition_id,
      'tickets', ARRAY[]::integer[],
      'ticket_count', 0
    );
  END IF;

  -- Query tickets from all possible sources
  WITH all_tickets AS (
    -- SOURCE 1: joincompetition table (primary - has comma-separated ticketnumbers)
    SELECT DISTINCT CAST(trim(t_num) AS integer) AS ticket_num
    FROM (
      SELECT unnest(string_to_array(jc.ticketnumbers, ',')) AS t_num
      FROM joincompetition jc
      WHERE (
        -- Match by competition UUID or legacy uid
        jc.competitionid = v_comp_uuid::text
        OR jc.competitionid = competition_id
        OR (v_comp_uid IS NOT NULL AND jc.competitionid = v_comp_uid)
      )
      AND (
        -- Match by various user identifiers
        jc.privy_user_id = user_id
        OR jc.privy_user_id = v_canonical_user_id
        OR jc.userid = user_id
        OR jc.userid = v_canonical_user_id
        OR (v_search_wallet IS NOT NULL AND LOWER(jc.walletaddress) = v_search_wallet)
        OR (v_search_wallet IS NOT NULL AND jc.walletaddress = user_id)
      )
      AND jc.ticketnumbers IS NOT NULL
      AND trim(jc.ticketnumbers) != ''
    ) jc_tickets
    WHERE trim(t_num) ~ '^[0-9]+$'

    UNION

    -- SOURCE 2: tickets table
    SELECT DISTINCT t.ticket_number AS ticket_num
    FROM tickets t
    WHERE t.competition_id = v_comp_uuid
      AND (
        t.user_id = user_id
        OR t.user_id = v_canonical_user_id
        OR (v_search_wallet IS NOT NULL AND LOWER(t.user_id) = v_search_wallet)
        OR t.privy_user_id = user_id
        OR t.privy_user_id = v_canonical_user_id
      )

    UNION

    -- SOURCE 3: pending_tickets table (confirmed reservations)
    SELECT DISTINCT unnest(pt.ticket_numbers) AS ticket_num
    FROM pending_tickets pt
    WHERE pt.competition_id = v_comp_uuid
      AND pt.status = 'confirmed'
      AND (
        pt.user_id = user_id
        OR pt.user_id = v_canonical_user_id
        OR (v_search_wallet IS NOT NULL AND LOWER(pt.user_id) = v_search_wallet)
      )
  )
  SELECT
    array_agg(ticket_num ORDER BY ticket_num),
    count(*)::integer
  INTO v_tickets, v_ticket_count
  FROM all_tickets
  WHERE ticket_num IS NOT NULL;

  -- Return JSON with all ticket information
  RETURN json_build_object(
    'user_id', user_id,
    'competition_id', competition_id,
    'tickets', COALESCE(v_tickets, ARRAY[]::integer[]),
    'ticket_count', COALESCE(v_ticket_count, 0)
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'get_user_tickets_for_competition error for user % competition %: %',
      LEFT(user_id, 20), LEFT(competition_id, 20), SQLERRM;
    RETURN json_build_object(
      'user_id', user_id,
      'competition_id', competition_id,
      'tickets', ARRAY[]::integer[],
      'ticket_count', 0
    );
END;
$$;


-- =====================================================
-- STEP 3: Grant permissions
-- =====================================================

GRANT EXECUTE ON FUNCTION get_user_tickets_for_competition(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_tickets_for_competition(text, text) TO anon;
GRANT EXECUTE ON FUNCTION get_user_tickets_for_competition(text, text) TO service_role;

COMMENT ON FUNCTION get_user_tickets_for_competition(text, text) IS
'Get all tickets owned by a user for a specific competition.
Parameters: user_id (Privy DID, wallet address, or canonical user ID), competition_id (UUID or legacy uid).
Returns JSON: { user_id, competition_id, tickets: int[], ticket_count: int }
Searches joincompetition, tickets, and pending_tickets tables.';


-- =====================================================
-- STEP 4: Validate function exists with correct signature
-- =====================================================

DO $$
DECLARE
  func_count integer;
  func_sig text;
BEGIN
  -- Check that our function exists
  SELECT COUNT(*), string_agg(pg_catalog.pg_get_function_identity_arguments(p.oid), ', ')
  INTO func_count, func_sig
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE p.proname = 'get_user_tickets_for_competition'
    AND n.nspname = 'public';

  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'FIX: get_user_tickets_for_competition Parameter Mismatch';
  RAISE NOTICE '=====================================================';

  IF func_count = 1 THEN
    RAISE NOTICE 'SUCCESS: Function created with signature: (%)', func_sig;
    RAISE NOTICE '';
    RAISE NOTICE 'Frontend can now call:';
    RAISE NOTICE '  supabase.rpc("get_user_tickets_for_competition", {';
    RAISE NOTICE '    user_id: "did:privy:..." or "0x..." or "prize:pid:0x...",';
    RAISE NOTICE '    competition_id: "uuid-string" or "legacy-uid"';
    RAISE NOTICE '  })';
  ELSIF func_count = 0 THEN
    RAISE WARNING 'ERROR: Function was not created!';
  ELSE
    RAISE WARNING 'WARNING: Multiple function overloads exist (%). This may cause HTTP 300 errors.', func_count;
    RAISE NOTICE 'Signatures found: %', func_sig;
  END IF;

  RAISE NOTICE '=====================================================';
END $$;

COMMIT;
