-- Test: Verify migration 20260202044500 creates correct function signature
-- This test should be run AFTER applying the migration

BEGIN;

-- Test 1: Verify only ONE upsert_canonical_user function exists in public schema
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE p.proname = 'upsert_canonical_user'
    AND n.nspname = 'public';
  
  IF v_count != 1 THEN
    RAISE EXCEPTION 'FAILED: Expected exactly 1 upsert_canonical_user function, found %', v_count;
  END IF;
  
  RAISE NOTICE 'PASSED: Exactly 1 upsert_canonical_user function exists';
END $$;

-- Test 2: Verify the function has 14 parameters
DO $$
DECLARE
  v_args TEXT;
  v_param_count INTEGER;
BEGIN
  SELECT 
    pg_catalog.pg_get_function_arguments(p.oid),
    pronargs
  INTO v_args, v_param_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE p.proname = 'upsert_canonical_user'
    AND n.nspname = 'public';
  
  IF v_param_count != 14 THEN
    RAISE EXCEPTION 'FAILED: Expected 14 parameters, found %', v_param_count;
  END IF;
  
  RAISE NOTICE 'PASSED: Function has 14 parameters';
  RAISE NOTICE 'Parameters: %', v_args;
END $$;

-- Test 3: Verify p_country parameter exists
DO $$
DECLARE
  v_args TEXT;
BEGIN
  SELECT pg_catalog.pg_get_function_arguments(p.oid)
  INTO v_args
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE p.proname = 'upsert_canonical_user'
    AND n.nspname = 'public';
  
  IF v_args NOT LIKE '%p_country%' THEN
    RAISE EXCEPTION 'FAILED: p_country parameter not found in function signature';
  END IF;
  
  RAISE NOTICE 'PASSED: p_country parameter exists';
END $$;

-- Test 4: Verify p_avatar_url parameter exists
DO $$
DECLARE
  v_args TEXT;
BEGIN
  SELECT pg_catalog.pg_get_function_arguments(p.oid)
  INTO v_args
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE p.proname = 'upsert_canonical_user'
    AND n.nspname = 'public';
  
  IF v_args NOT LIKE '%p_avatar_url%' THEN
    RAISE EXCEPTION 'FAILED: p_avatar_url parameter not found in function signature';
  END IF;
  
  RAISE NOTICE 'PASSED: p_avatar_url parameter exists';
END $$;

-- Test 5: Verify p_auth_provider parameter exists
DO $$
DECLARE
  v_args TEXT;
BEGIN
  SELECT pg_catalog.pg_get_function_arguments(p.oid)
  INTO v_args
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE p.proname = 'upsert_canonical_user'
    AND n.nspname = 'public';
  
  IF v_args NOT LIKE '%p_auth_provider%' THEN
    RAISE EXCEPTION 'FAILED: p_auth_provider parameter not found in function signature';
  END IF;
  
  RAISE NOTICE 'PASSED: p_auth_provider parameter exists';
END $$;

-- Test 6: Call the function with frontend parameters (simulates NewAuthModal call)
DO $$
DECLARE
  v_result JSONB;
  v_test_uid TEXT := 'test-' || gen_random_uuid()::TEXT;
BEGIN
  -- Call with same parameters as NewAuthModal.tsx
  SELECT upsert_canonical_user(
    p_uid := v_test_uid,
    p_canonical_user_id := 'prize:pid:temp999',
    p_email := 'test@example.com',
    p_username := 'testuser',
    p_first_name := 'Test',
    p_last_name := 'User',
    p_telegram_handle := '@testuser',
    p_country := 'US'
    -- Other params should use DEFAULT values
  ) INTO v_result;
  
  IF v_result IS NULL THEN
    RAISE EXCEPTION 'FAILED: Function returned NULL';
  END IF;
  
  IF v_result->>'id' IS NULL THEN
    RAISE EXCEPTION 'FAILED: Function did not return id field';
  END IF;
  
  IF v_result->>'canonical_user_id' IS NULL THEN
    RAISE EXCEPTION 'FAILED: Function did not return canonical_user_id field';
  END IF;
  
  RAISE NOTICE 'PASSED: Function call with frontend parameters succeeded';
  RAISE NOTICE 'Result: %', v_result;
  
  -- Cleanup test data
  DELETE FROM canonical_users WHERE uid = v_test_uid;
END $$;

ROLLBACK; -- Don't commit test data

RAISE NOTICE '';
RAISE NOTICE '========================================';
RAISE NOTICE 'ALL TESTS PASSED!';
RAISE NOTICE 'Migration 20260202044500 is working correctly';
RAISE NOTICE '========================================';
