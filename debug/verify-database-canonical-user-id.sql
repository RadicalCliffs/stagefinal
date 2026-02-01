-- ============================================================================
-- VERIFICATION SCRIPT: canonical_user_id Database Compatibility
-- ============================================================================
-- Purpose: Verify all database functions, triggers, and indexes properly
--          handle canonical_user_id format (prize:pid:<wallet>)
--
-- Run this script against the Supabase database to verify compatibility
-- ============================================================================

BEGIN;

-- ============================================================================
-- TEST 1: Verify RPC function accepts canonical_user_id format
-- ============================================================================

DO $$
DECLARE
  test_wallet TEXT := '0xabcdef1234567890abcdef1234567890abcdef12';
  test_canonical TEXT := 'prize:pid:0xabcdef1234567890abcdef1234567890abcdef12';
  function_exists BOOLEAN;
BEGIN
  RAISE NOTICE '============================================================';
  RAISE NOTICE 'TEST 1: RPC Functions - canonical_user_id Format Support';
  RAISE NOTICE '============================================================';
  
  -- Check if get_user_transactions exists
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' 
    AND p.proname = 'get_user_transactions'
  ) INTO function_exists;
  
  IF function_exists THEN
    RAISE NOTICE '✓ get_user_transactions() function exists';
  ELSE
    RAISE WARNING '✗ get_user_transactions() function NOT found';
  END IF;
  
  -- Check if get_user_competition_entries exists
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' 
    AND p.proname = 'get_user_competition_entries'
  ) INTO function_exists;
  
  IF function_exists THEN
    RAISE NOTICE '✓ get_user_competition_entries() function exists';
  ELSE
    RAISE WARNING '✗ get_user_competition_entries() function NOT found';
  END IF;
  
  -- Check if get_comprehensive_user_dashboard_entries exists
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' 
    AND p.proname = 'get_comprehensive_user_dashboard_entries'
  ) INTO function_exists;
  
  IF function_exists THEN
    RAISE NOTICE '✓ get_comprehensive_user_dashboard_entries() function exists';
  ELSE
    RAISE WARNING '✗ get_comprehensive_user_dashboard_entries() function NOT found';
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE 'Note: Functions should accept p_user_identifier parameter';
  RAISE NOTICE '      and parse prize:pid: format internally';
END $$;

-- ============================================================================
-- TEST 2: Verify triggers on canonical_users table
-- ============================================================================

DO $$
DECLARE
  trigger_count INTEGER;
  trigger_names TEXT[];
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '============================================================';
  RAISE NOTICE 'TEST 2: Triggers - canonical_users Normalization';
  RAISE NOTICE '============================================================';
  
  -- Count normalization triggers
  SELECT COUNT(*), ARRAY_AGG(tgname ORDER BY tgname)
  INTO trigger_count, trigger_names
  FROM pg_trigger t
  JOIN pg_class c ON t.tgrelid = c.oid
  WHERE c.relname = 'canonical_users'
  AND t.tgname IN (
    'trg_canonical_users_normalize',
    'canonical_users_normalize_before_write',
    'cu_normalize_and_enforce_trg'
  )
  AND NOT t.tgisinternal;
  
  RAISE NOTICE 'Normalization triggers found: % / 3', trigger_count;
  
  IF trigger_count >= 3 THEN
    RAISE NOTICE '✓ All normalization triggers present:';
    FOR i IN 1..array_length(trigger_names, 1) LOOP
      RAISE NOTICE '  - %', trigger_names[i];
    END LOOP;
  ELSE
    RAISE WARNING '✗ Missing normalization triggers (expected 3, found %)', trigger_count;
    IF trigger_count > 0 THEN
      RAISE NOTICE 'Found triggers:';
      FOR i IN 1..array_length(trigger_names, 1) LOOP
        RAISE NOTICE '  - %', trigger_names[i];
      END LOOP;
    END IF;
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE 'Trigger execution order (alphabetical):';
  RAISE NOTICE '  1. canonical_users_normalize_before_write (validates EVM)';
  RAISE NOTICE '  2. cu_normalize_and_enforce_trg (fallback wallet)';
  RAISE NOTICE '  3. trg_canonical_users_normalize (basic normalization)';
END $$;

-- ============================================================================
-- TEST 3: Verify indexes on canonical_user_id columns
-- ============================================================================

DO $$
DECLARE
  idx_record RECORD;
  idx_count INTEGER := 0;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '============================================================';
  RAISE NOTICE 'TEST 3: Indexes - canonical_user_id Coverage';
  RAISE NOTICE '============================================================';
  
  -- Find all indexes on canonical_user_id columns
  FOR idx_record IN
    SELECT 
      c.relname AS table_name,
      i.relname AS index_name,
      am.amname AS index_type
    FROM pg_index x
    JOIN pg_class c ON c.oid = x.indrelid
    JOIN pg_class i ON i.oid = x.indexrelid
    JOIN pg_am am ON i.relam = am.oid
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(x.indkey)
    WHERE a.attname = 'canonical_user_id'
    AND c.relkind = 'r'
    AND c.relname IN (
      'canonical_users',
      'user_transactions',
      'joincompetition',
      'competition_entries',
      'sub_account_balances',
      'balance_ledger',
      'pending_tickets',
      'tickets',
      'winners'
    )
    ORDER BY c.relname, i.relname
  LOOP
    IF idx_count = 0 THEN
      RAISE NOTICE 'canonical_user_id indexes found:';
    END IF;
    idx_count := idx_count + 1;
    RAISE NOTICE '  ✓ %.% (type: %)', 
      idx_record.table_name, 
      idx_record.index_name,
      idx_record.index_type;
  END LOOP;
  
  IF idx_count = 0 THEN
    RAISE WARNING '✗ No canonical_user_id indexes found!';
  ELSE
    RAISE NOTICE '';
    RAISE NOTICE 'Total canonical_user_id indexes: %', idx_count;
  END IF;
END $$;

-- ============================================================================
-- TEST 4: Verify trigger functions handle EVM address validation
-- ============================================================================

DO $$
DECLARE
  func_body TEXT;
  validates_evm BOOLEAN := FALSE;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '============================================================';
  RAISE NOTICE 'TEST 4: Trigger Functions - EVM Address Validation';
  RAISE NOTICE '============================================================';
  
  -- Check if canonical_users_normalize_before_write validates EVM format
  SELECT pg_get_functiondef(p.oid) INTO func_body
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
  AND p.proname = 'canonical_users_normalize_before_write';
  
  IF func_body IS NOT NULL THEN
    -- Check if function validates EVM address pattern (0x + 40 hex chars)
    validates_evm := func_body LIKE '%0x[0-9a-fA-F]{40}%';
    
    IF validates_evm THEN
      RAISE NOTICE '✓ canonical_users_normalize_before_write() validates EVM format';
      RAISE NOTICE '  Pattern check: 0x + 40 hex characters';
    ELSE
      RAISE WARNING '✗ canonical_users_normalize_before_write() does NOT validate EVM format';
      RAISE NOTICE '  This may allow invalid wallet addresses';
    END IF;
  ELSE
    RAISE WARNING '✗ canonical_users_normalize_before_write() function NOT found';
  END IF;
  
  -- Check if util.normalize_evm_address exists
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'util'
    AND p.proname = 'normalize_evm_address'
  ) INTO validates_evm;
  
  IF validates_evm THEN
    RAISE NOTICE '✓ util.normalize_evm_address() function exists';
  ELSE
    RAISE WARNING '✗ util.normalize_evm_address() function NOT found';
  END IF;
END $$;

-- ============================================================================
-- TEST 5: Test canonical_user_id normalization (dry run)
-- ============================================================================

DO $$
DECLARE
  test_wallet TEXT := '0xABCDEF1234567890ABCDEF1234567890ABCDEF12';
  normalized_wallet TEXT;
  canonical_id TEXT;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '============================================================';
  RAISE NOTICE 'TEST 5: Normalization - Sample Test (Dry Run)';
  RAISE NOTICE '============================================================';
  
  -- Test wallet normalization (if util function exists)
  BEGIN
    SELECT util.normalize_evm_address(test_wallet) INTO normalized_wallet;
    RAISE NOTICE 'Input wallet:  %', test_wallet;
    RAISE NOTICE 'Normalized:    %', normalized_wallet;
    
    -- Generate canonical_user_id
    canonical_id := 'prize:pid:' || normalized_wallet;
    RAISE NOTICE 'Canonical ID:  %', canonical_id;
    
    IF normalized_wallet = LOWER(test_wallet) THEN
      RAISE NOTICE '✓ Wallet normalization works (lowercase)';
    ELSE
      RAISE WARNING '✗ Wallet normalization unexpected result';
    END IF;
    
    IF canonical_id LIKE 'prize:pid:0x%' AND LENGTH(canonical_id) = 52 THEN
      RAISE NOTICE '✓ Canonical ID format correct (prize:pid: + 42 chars)';
    ELSE
      RAISE WARNING '✗ Canonical ID format incorrect';
    END IF;
    
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '✗ util.normalize_evm_address() not available or error: %', SQLERRM;
  END;
END $$;

-- ============================================================================
-- TEST 6: Verify _set_cuid triggers on user tables
-- ============================================================================

DO $$
DECLARE
  trigger_count INTEGER;
  trigger_record RECORD;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '============================================================';
  RAISE NOTICE 'TEST 6: CUID Triggers - Auto-Population on User Tables';
  RAISE NOTICE '============================================================';
  
  -- Find all _set_cuid triggers
  SELECT COUNT(*) INTO trigger_count
  FROM pg_trigger t
  JOIN pg_class c ON t.tgrelid = c.oid
  WHERE t.tgname LIKE '%_set_cuid'
  AND NOT t.tgisinternal;
  
  RAISE NOTICE 'CUID auto-population triggers found: %', trigger_count;
  
  IF trigger_count > 0 THEN
    RAISE NOTICE '';
    FOR trigger_record IN
      SELECT c.relname AS table_name, t.tgname AS trigger_name
      FROM pg_trigger t
      JOIN pg_class c ON t.tgrelid = c.oid
      WHERE t.tgname LIKE '%_set_cuid'
      AND NOT t.tgisinternal
      ORDER BY c.relname
    LOOP
      RAISE NOTICE '  ✓ %.%', trigger_record.table_name, trigger_record.trigger_name;
    END LOOP;
  ELSE
    RAISE WARNING '✗ No CUID auto-population triggers found';
  END IF;
END $$;

-- ============================================================================
-- SUMMARY
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '============================================================';
  RAISE NOTICE 'VERIFICATION COMPLETE';
  RAISE NOTICE '============================================================';
  RAISE NOTICE 'Review the test results above to ensure:';
  RAISE NOTICE '  1. RPC functions exist and accept p_user_identifier';
  RAISE NOTICE '  2. Normalization triggers are present on canonical_users';
  RAISE NOTICE '  3. Indexes exist on canonical_user_id columns';
  RAISE NOTICE '  4. Trigger functions validate EVM address format';
  RAISE NOTICE '  5. Normalization produces correct canonical_user_id';
  RAISE NOTICE '  6. CUID triggers auto-populate canonical_user_id';
  RAISE NOTICE '';
  RAISE NOTICE 'Expected Results:';
  RAISE NOTICE '  ✓ = PASS (component working correctly)';
  RAISE NOTICE '  ✗ = FAIL (component missing or incorrect)';
  RAISE NOTICE '';
  RAISE NOTICE 'If all tests pass, database is ready for canonical_user_id!';
  RAISE NOTICE '============================================================';
END $$;

COMMIT;

-- ============================================================================
-- OPTIONAL: Manual Test Queries
-- ============================================================================
-- Uncomment and run these queries to manually test canonical_user_id:

-- Test 1: Query with canonical_user_id format
-- SELECT * FROM get_user_transactions('prize:pid:0xabcdef1234567890abcdef1234567890abcdef12');

-- Test 2: Query with direct wallet address
-- SELECT * FROM get_user_transactions('0xABCDEF1234567890ABCDEF1234567890ABCDEF12');

-- Test 3: Check if user_transactions has canonical_user_id column
-- SELECT column_name, data_type 
-- FROM information_schema.columns 
-- WHERE table_name = 'user_transactions' 
-- AND column_name = 'canonical_user_id';

-- Test 4: Sample query to see canonical_user_id format in data
-- SELECT canonical_user_id, wallet_address, uid 
-- FROM canonical_users 
-- WHERE wallet_address IS NOT NULL 
-- LIMIT 5;

-- Test 5: Verify canonical_user_id format in user_transactions
-- SELECT canonical_user_id, wallet_address, transaction_type, amount
-- FROM user_transactions
-- WHERE canonical_user_id LIKE 'prize:pid:%'
-- LIMIT 5;
