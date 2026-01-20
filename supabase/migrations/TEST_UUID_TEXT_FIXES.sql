-- ============================================================================
-- TEST SCRIPT: Verify UUID to TEXT Fixes for User-Identifying Fields
-- ============================================================================
-- This script tests that all user_id columns are TEXT and can accept
-- wallet addresses, canonical_user_ids, and Privy DIDs without errors.
--
-- Run this script after applying the UUID→TEXT migrations to verify the fixes.
--
-- Expected Results: All tests should pass without UUID casting errors
-- ============================================================================

\echo '====================================================================='
\echo 'TEST SUITE: UUID to TEXT Migration Verification'
\echo '====================================================================='
\echo ''

-- ============================================================================
-- TEST 1: Verify Table Column Types
-- ============================================================================

\echo '---------------------------------------------------------------------'
\echo 'TEST 1: Verify table column types are TEXT (not UUID)'
\echo '---------------------------------------------------------------------'

SELECT 
  table_name,
  column_name,
  data_type,
  CASE 
    WHEN data_type IN ('text', 'character varying') THEN '✓ PASS'
    WHEN data_type = 'uuid' THEN '✗ FAIL - Still UUID!'
    ELSE '? UNKNOWN'
  END as status
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('tickets', 'user_transactions', 'pending_tickets', 'balance_ledger', 'wallet_balances')
  AND column_name IN ('user_id', 'canonical_user_id')
ORDER BY table_name, column_name;

\echo ''

-- ============================================================================
-- TEST 2: Test Inserting Wallet Address into tickets.user_id
-- ============================================================================

\echo '---------------------------------------------------------------------'
\echo 'TEST 2: Insert wallet address into tickets.user_id (should succeed)'
\echo '---------------------------------------------------------------------'

DO $$
DECLARE
  test_wallet TEXT := '0x1234567890123456789012345678901234567890';
  test_canonical TEXT := 'prize:pid:0x1234567890123456789012345678901234567890';
  test_privy_did TEXT := 'did:privy:test123';
  comp_id UUID;
BEGIN
  -- Get a competition ID to use
  SELECT id INTO comp_id FROM competitions LIMIT 1;
  
  IF comp_id IS NULL THEN
    RAISE NOTICE '✗ SKIP - No competitions in database to test with';
    RETURN;
  END IF;
  
  -- Test 1: Insert with wallet address
  BEGIN
    INSERT INTO tickets (
      competition_id,
      user_id,
      canonical_user_id,
      ticket_number,
      purchase_price,
      purchased_at
    ) VALUES (
      comp_id,
      test_wallet,  -- TEXT wallet address
      test_canonical,  -- TEXT canonical ID
      999991,
      0.01,
      NOW()
    );
    RAISE NOTICE '✓ PASS - Wallet address inserted successfully';
    
    -- Clean up
    DELETE FROM tickets WHERE ticket_number = 999991;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '✗ FAIL - Error inserting wallet address: %', SQLERRM;
  END;
  
  -- Test 2: Insert with Privy DID
  BEGIN
    INSERT INTO tickets (
      competition_id,
      user_id,
      canonical_user_id,
      ticket_number,
      purchase_price,
      purchased_at
    ) VALUES (
      comp_id,
      test_privy_did,  -- TEXT Privy DID
      test_canonical,  -- TEXT canonical ID
      999992,
      0.01,
      NOW()
    );
    RAISE NOTICE '✓ PASS - Privy DID inserted successfully';
    
    -- Clean up
    DELETE FROM tickets WHERE ticket_number = 999992;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '✗ FAIL - Error inserting Privy DID: %', SQLERRM;
  END;
END $$;

\echo ''

-- ============================================================================
-- TEST 3: Test Querying with Wallet Address (Simulating Frontend Query)
-- ============================================================================

\echo '---------------------------------------------------------------------'
\echo 'TEST 3: Query tickets with wallet address filter (should succeed)'
\echo '---------------------------------------------------------------------'

DO $$
DECLARE
  test_wallet TEXT := '0x2137af5047526a1180580ab02985a818b1d9c789';
  result_count INTEGER;
BEGIN
  -- This simulates the frontend query that was failing:
  -- SELECT * FROM tickets WHERE user_id = '0x2137af...'
  BEGIN
    SELECT COUNT(*) INTO result_count
    FROM tickets
    WHERE user_id = test_wallet
       OR canonical_user_id = 'prize:pid:' || test_wallet;
    
    RAISE NOTICE '✓ PASS - Query with wallet address succeeded (found % rows)', result_count;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '✗ FAIL - Error querying with wallet address: %', SQLERRM;
  END;
END $$;

\echo ''

-- ============================================================================
-- TEST 4: Test RPC Functions Accept TEXT Parameters
-- ============================================================================

\echo '---------------------------------------------------------------------'
\echo 'TEST 4: Test RPC functions accept TEXT canonical_user_id'
\echo '---------------------------------------------------------------------'

DO $$
DECLARE
  test_canonical TEXT := 'prize:pid:0x1234567890123456789012345678901234567890';
  result JSONB;
BEGIN
  -- Test upsert_canonical_user
  BEGIN
    SELECT upsert_canonical_user(
      p_canonical_user_id := test_canonical || '_test',
      p_email := 'test_uuid_fix@example.com',
      p_wallet_address := '0x1234567890123456789012345678901234567890'
    ) INTO result;
    
    IF result->>'success' = 'true' THEN
      RAISE NOTICE '✓ PASS - upsert_canonical_user accepts TEXT canonical_user_id';
      
      -- Clean up test user
      DELETE FROM canonical_users WHERE canonical_user_id = test_canonical || '_test';
    ELSE
      RAISE NOTICE '✗ FAIL - upsert_canonical_user error: %', result->>'error';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '✗ FAIL - upsert_canonical_user exception: %', SQLERRM;
  END;
END $$;

\echo ''

-- ============================================================================
-- TEST 5: Test get_comprehensive_user_dashboard_entries RPC
-- ============================================================================

\echo '---------------------------------------------------------------------'
\echo 'TEST 5: Test get_comprehensive_user_dashboard_entries with TEXT ID'
\echo '---------------------------------------------------------------------'

DO $$
DECLARE
  test_wallet TEXT := '0x2137af5047526a1180580ab02985a818b1d9c789';
  test_canonical TEXT := 'prize:pid:0x2137af5047526a1180580ab02985a818b1d9c789';
  result_count INTEGER;
BEGIN
  -- Test with wallet address
  BEGIN
    SELECT COUNT(*) INTO result_count
    FROM get_comprehensive_user_dashboard_entries(test_wallet);
    
    RAISE NOTICE '✓ PASS - RPC with wallet address succeeded (found % entries)', result_count;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '✗ FAIL - RPC with wallet address error: %', SQLERRM;
  END;
  
  -- Test with canonical user ID
  BEGIN
    SELECT COUNT(*) INTO result_count
    FROM get_comprehensive_user_dashboard_entries(test_canonical);
    
    RAISE NOTICE '✓ PASS - RPC with canonical_user_id succeeded (found % entries)', result_count;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '✗ FAIL - RPC with canonical_user_id error: %', SQLERRM;
  END;
END $$;

\echo ''

-- ============================================================================
-- TEST 6: Verify No UUID Casts on user_id in Active Functions
-- ============================================================================

\echo '---------------------------------------------------------------------'
\echo 'TEST 6: Check for problematic ::uuid casts on user_id fields'
\echo '---------------------------------------------------------------------'

SELECT 
  proname as function_name,
  pg_get_functiondef(oid) as function_body
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND pg_get_functiondef(oid) LIKE '%user_id%::uuid%'
  AND proname NOT LIKE '%test%'
ORDER BY proname;

\echo '(If no results shown above, no problematic casts found - PASS)'
\echo ''

-- ============================================================================
-- Summary
-- ============================================================================

\echo '====================================================================='
\echo 'TEST SUITE COMPLETE'
\echo '====================================================================='
\echo ''
\echo 'Review the test results above. All tests should show ✓ PASS.'
\echo 'If any tests show ✗ FAIL, investigate the error messages.'
\echo ''
\echo 'After verifying all tests pass:'
\echo '1. Test the frontend dashboard at /dashboard/entries'
\echo '2. Verify no "invalid input syntax for type uuid" errors in console'
\echo '3. Verify no "operator does not exist: uuid = text" errors'
\echo '====================================================================='
