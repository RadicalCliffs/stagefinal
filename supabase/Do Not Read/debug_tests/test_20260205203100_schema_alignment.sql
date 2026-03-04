-- ============================================================================
-- Test: Verify migration 20260205203100 creates correct function signatures
-- This test should be run AFTER applying the migration
-- ============================================================================

BEGIN;

RAISE NOTICE '==============================================================================';
RAISE NOTICE 'Testing Migration 20260205203100: Production Schema Alignment';
RAISE NOTICE '==============================================================================';

-- ============================================================================
-- Test 1: Verify NO conflicting get_unavailable_tickets overloads
-- ============================================================================
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Count get_unavailable_tickets functions in public schema
  SELECT COUNT(*) INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE p.proname = 'get_unavailable_tickets'
    AND n.nspname = 'public';
  
  -- Should have exactly 1 (TEXT version only)
  IF v_count != 1 THEN
    RAISE EXCEPTION 'FAILED: Expected exactly 1 get_unavailable_tickets function, found %', v_count;
  END IF;
  
  RAISE NOTICE '✓ Test 1 PASSED: Exactly 1 get_unavailable_tickets function exists (no conflicts)';
END $$;

-- ============================================================================
-- Test 2: Verify get_unavailable_tickets returns INTEGER[] not TABLE
-- ============================================================================
DO $$
DECLARE
  v_return_type TEXT;
BEGIN
  SELECT pg_catalog.format_type(p.prorettype, NULL) INTO v_return_type
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE p.proname = 'get_unavailable_tickets'
    AND n.nspname = 'public';
  
  -- Should return integer[] not RECORD (which means TABLE)
  IF v_return_type != 'integer[]' THEN
    RAISE EXCEPTION 'FAILED: Expected return type integer[], found %', v_return_type;
  END IF;
  
  RAISE NOTICE '✓ Test 2 PASSED: get_unavailable_tickets returns INTEGER[] (not TABLE)';
END $$;

-- ============================================================================
-- Test 3: Verify get_unavailable_tickets has TEXT parameter
-- ============================================================================
DO $$
DECLARE
  v_args TEXT;
BEGIN
  SELECT pg_catalog.pg_get_function_arguments(p.oid) INTO v_args
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE p.proname = 'get_unavailable_tickets'
    AND n.nspname = 'public';
  
  -- Should have p_competition_id text parameter
  IF v_args NOT LIKE '%p_competition_id text%' THEN
    RAISE EXCEPTION 'FAILED: Expected parameter p_competition_id text, found: %', v_args;
  END IF;
  
  RAISE NOTICE '✓ Test 3 PASSED: get_unavailable_tickets has TEXT parameter';
END $$;

-- ============================================================================
-- Test 4: Verify get_competition_unavailable_tickets has both overloads
-- ============================================================================
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Count get_competition_unavailable_tickets functions
  SELECT COUNT(*) INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE p.proname = 'get_competition_unavailable_tickets'
    AND n.nspname = 'public';
  
  -- Should have exactly 2 (UUID and TEXT versions)
  IF v_count != 2 THEN
    RAISE EXCEPTION 'FAILED: Expected 2 get_competition_unavailable_tickets functions, found %', v_count;
  END IF;
  
  RAISE NOTICE '✓ Test 4 PASSED: Exactly 2 get_competition_unavailable_tickets functions (UUID and TEXT)';
END $$;

-- ============================================================================
-- Test 5: Verify get_competition_unavailable_tickets returns TABLE
-- ============================================================================
DO $$
DECLARE
  v_return_type TEXT;
  v_count_record INTEGER := 0;
BEGIN
  -- Both should return RECORD (which means TABLE)
  SELECT COUNT(*) INTO v_count_record
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE p.proname = 'get_competition_unavailable_tickets'
    AND n.nspname = 'public'
    AND p.prorettype = (SELECT oid FROM pg_type WHERE typname = 'record');
  
  IF v_count_record != 2 THEN
    RAISE EXCEPTION 'FAILED: Expected 2 functions returning TABLE (RECORD), found %', v_count_record;
  END IF;
  
  RAISE NOTICE '✓ Test 5 PASSED: get_competition_unavailable_tickets functions return TABLE';
END $$;

-- ============================================================================
-- Test 6: Verify allocate_lucky_dip_tickets exists
-- ============================================================================
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE p.proname = 'allocate_lucky_dip_tickets'
    AND n.nspname = 'public';
  
  IF v_count != 1 THEN
    RAISE EXCEPTION 'FAILED: Expected 1 allocate_lucky_dip_tickets function, found %', v_count;
  END IF;
  
  RAISE NOTICE '✓ Test 6 PASSED: allocate_lucky_dip_tickets function exists';
END $$;

-- ============================================================================
-- Test 7: Verify allocate_lucky_dip_tickets has 6 parameters
-- ============================================================================
DO $$
DECLARE
  v_param_count INTEGER;
  v_args TEXT;
BEGIN
  SELECT pronargs, pg_catalog.pg_get_function_arguments(p.oid)
  INTO v_param_count, v_args
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE p.proname = 'allocate_lucky_dip_tickets'
    AND n.nspname = 'public';
  
  IF v_param_count != 6 THEN
    RAISE EXCEPTION 'FAILED: Expected 6 parameters, found %. Args: %', v_param_count, v_args;
  END IF;
  
  -- Verify required parameters
  IF v_args NOT LIKE '%p_user_id%' OR
     v_args NOT LIKE '%p_competition_id%' OR
     v_args NOT LIKE '%p_count%' OR
     v_args NOT LIKE '%p_ticket_price%' OR
     v_args NOT LIKE '%p_hold_minutes%' OR
     v_args NOT LIKE '%p_session_id%' THEN
    RAISE EXCEPTION 'FAILED: Missing required parameters. Args: %', v_args;
  END IF;
  
  RAISE NOTICE '✓ Test 7 PASSED: allocate_lucky_dip_tickets has 6 parameters';
END $$;

-- ============================================================================
-- Test 8: Verify allocate_lucky_dip_tickets_batch exists with 7 parameters
-- ============================================================================
DO $$
DECLARE
  v_count INTEGER;
  v_param_count INTEGER;
  v_args TEXT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE p.proname = 'allocate_lucky_dip_tickets_batch'
    AND n.nspname = 'public';
  
  IF v_count != 1 THEN
    RAISE EXCEPTION 'FAILED: Expected 1 allocate_lucky_dip_tickets_batch function, found %', v_count;
  END IF;
  
  -- Check parameter count
  SELECT pronargs, pg_catalog.pg_get_function_arguments(p.oid)
  INTO v_param_count, v_args
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE p.proname = 'allocate_lucky_dip_tickets_batch'
    AND n.nspname = 'public';
  
  IF v_param_count != 7 THEN
    RAISE EXCEPTION 'FAILED: Expected 7 parameters, found %. Args: %', v_param_count, v_args;
  END IF;
  
  -- Verify p_excluded_tickets parameter exists
  IF v_args NOT LIKE '%p_excluded_tickets%' THEN
    RAISE EXCEPTION 'FAILED: Missing p_excluded_tickets parameter. Args: %', v_args;
  END IF;
  
  RAISE NOTICE '✓ Test 8 PASSED: allocate_lucky_dip_tickets_batch has 7 parameters including p_excluded_tickets';
END $$;

-- ============================================================================
-- Test 9: Verify functions return JSONB
-- ============================================================================
DO $$
DECLARE
  v_return_type_1 TEXT;
  v_return_type_2 TEXT;
BEGIN
  -- Check allocate_lucky_dip_tickets
  SELECT pg_catalog.format_type(p.prorettype, NULL) INTO v_return_type_1
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE p.proname = 'allocate_lucky_dip_tickets'
    AND n.nspname = 'public';
  
  -- Check allocate_lucky_dip_tickets_batch
  SELECT pg_catalog.format_type(p.prorettype, NULL) INTO v_return_type_2
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE p.proname = 'allocate_lucky_dip_tickets_batch'
    AND n.nspname = 'public';
  
  IF v_return_type_1 != 'jsonb' OR v_return_type_2 != 'jsonb' THEN
    RAISE EXCEPTION 'FAILED: Expected both functions to return jsonb. Found: % and %', v_return_type_1, v_return_type_2;
  END IF;
  
  RAISE NOTICE '✓ Test 9 PASSED: Allocation functions return JSONB';
END $$;

-- ============================================================================
-- Test 10: Verify all functions have proper permissions
-- ============================================================================
DO $$
DECLARE
  v_has_auth INTEGER;
  v_has_anon INTEGER;
  v_has_service INTEGER;
BEGIN
  -- Check get_unavailable_tickets permissions
  SELECT 
    SUM(CASE WHEN has_function_privilege('authenticated', p.oid, 'execute') THEN 1 ELSE 0 END),
    SUM(CASE WHEN has_function_privilege('anon', p.oid, 'execute') THEN 1 ELSE 0 END),
    SUM(CASE WHEN has_function_privilege('service_role', p.oid, 'execute') THEN 1 ELSE 0 END)
  INTO v_has_auth, v_has_anon, v_has_service
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE p.proname IN ('get_unavailable_tickets', 'get_competition_unavailable_tickets', 
                      'allocate_lucky_dip_tickets', 'allocate_lucky_dip_tickets_batch')
    AND n.nspname = 'public';
  
  -- All functions should be executable by authenticated, anon, and service_role
  IF v_has_auth < 5 THEN
    RAISE EXCEPTION 'FAILED: Not all functions have authenticated execute permission';
  END IF;
  
  IF v_has_anon < 3 THEN
    RAISE EXCEPTION 'FAILED: Not all read functions have anon execute permission';
  END IF;
  
  IF v_has_service < 5 THEN
    RAISE EXCEPTION 'FAILED: Not all functions have service_role execute permission';
  END IF;
  
  RAISE NOTICE '✓ Test 10 PASSED: All functions have proper permissions';
END $$;

-- ============================================================================
-- Test 11: Functional test - get_unavailable_tickets returns array
-- ============================================================================
DO $$
DECLARE
  v_result INTEGER[];
BEGIN
  -- Call with a test UUID (should return empty array or valid array)
  v_result := get_unavailable_tickets('00000000-0000-0000-0000-000000000000');
  
  -- Should return an array (even if empty)
  IF v_result IS NULL THEN
    RAISE EXCEPTION 'FAILED: Function returned NULL instead of empty array';
  END IF;
  
  RAISE NOTICE '✓ Test 11 PASSED: get_unavailable_tickets returns array (empty is ok)';
END $$;

-- ============================================================================
-- Test 12: Functional test - get_competition_unavailable_tickets returns table
-- ============================================================================
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Call with a test UUID (should return 0 or more rows)
  SELECT COUNT(*) INTO v_count
  FROM get_competition_unavailable_tickets('00000000-0000-0000-0000-000000000000'::UUID);
  
  -- Should execute without error (count can be 0)
  RAISE NOTICE '✓ Test 12 PASSED: get_competition_unavailable_tickets returns table (% rows)', v_count;
END $$;

RAISE NOTICE '==============================================================================';
RAISE NOTICE 'All Tests PASSED! ✓';
RAISE NOTICE '==============================================================================';
RAISE NOTICE 'Migration 20260205203100 successfully:';
RAISE NOTICE '  ✓ Removed conflicting function overloads';
RAISE NOTICE '  ✓ Created production-aligned function signatures';
RAISE NOTICE '  ✓ Granted proper permissions';
RAISE NOTICE '  ✓ Functions are callable and return correct types';
RAISE NOTICE '==============================================================================';

ROLLBACK; -- Test should not modify database
