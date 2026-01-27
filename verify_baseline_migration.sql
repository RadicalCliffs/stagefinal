-- =====================================================
-- BASELINE MIGRATION VERIFICATION SCRIPT
-- =====================================================
-- Run this after applying 00000000000000_initial_schema.sql
-- to verify that everything was created correctly.
--
-- Usage:
--   1. Apply the baseline migration
--   2. Run this verification script
--   3. Check that all counts match expected values
--
-- Expected Results:
--   - 45 tables
--   - 43+ functions
--   - 125+ indexes
--   - 45 tables with RLS enabled
--   - All key functions accessible
-- =====================================================

-- =====================================================
-- PART 1: TABLE COUNT VERIFICATION
-- =====================================================

SELECT '=== TABLE COUNT ===' AS section;
SELECT 
  COUNT(*) AS table_count,
  '45 expected' AS expected
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_type = 'BASE TABLE';

-- =====================================================
-- PART 2: LIST ALL TABLES
-- =====================================================

SELECT '=== ALL TABLES ===' AS section;
SELECT 
  table_name,
  (SELECT COUNT(*) FROM information_schema.columns 
   WHERE table_schema = 'public' AND columns.table_name = tables.table_name) AS column_count
FROM information_schema.tables
WHERE table_schema = 'public' 
AND table_type = 'BASE TABLE'
ORDER BY table_name;

-- =====================================================
-- PART 3: FUNCTION COUNT VERIFICATION
-- =====================================================

SELECT '=== FUNCTION COUNT ===' AS section;
SELECT 
  COUNT(*) AS function_count,
  '43+ expected' AS expected
FROM information_schema.routines 
WHERE routine_schema = 'public' 
AND routine_type = 'FUNCTION';

-- =====================================================
-- PART 4: LIST ALL FUNCTIONS
-- =====================================================

SELECT '=== ALL FUNCTIONS ===' AS section;
SELECT 
  routine_name AS function_name,
  CASE 
    WHEN routine_name LIKE '%balance%' THEN 'Balance Management'
    WHEN routine_name LIKE '%wallet%' THEN 'Wallet Operations'
    WHEN routine_name LIKE '%ticket%' THEN 'Ticket Management'
    WHEN routine_name LIKE '%competition%' THEN 'Competition Queries'
    WHEN routine_name LIKE '%user%' THEN 'User Management'
    WHEN routine_name LIKE '%payment%' OR routine_name LIKE '%order%' THEN 'Payment Processing'
    ELSE 'Other'
  END AS category
FROM information_schema.routines 
WHERE routine_schema = 'public' 
AND routine_type = 'FUNCTION'
ORDER BY category, routine_name;

-- =====================================================
-- PART 5: INDEX COUNT VERIFICATION
-- =====================================================

SELECT '=== INDEX COUNT ===' AS section;
SELECT 
  COUNT(*) AS index_count,
  '125+ expected' AS expected
FROM pg_indexes 
WHERE schemaname = 'public';

-- =====================================================
-- PART 6: RLS VERIFICATION
-- =====================================================

SELECT '=== RLS ENABLED TABLES ===' AS section;
SELECT 
  tablename,
  rowsecurity AS rls_enabled
FROM pg_tables 
WHERE schemaname = 'public' 
ORDER BY tablename;

SELECT '=== RLS SUMMARY ===' AS section;
SELECT 
  COUNT(*) AS tables_with_rls,
  '45 expected' AS expected
FROM pg_tables 
WHERE schemaname = 'public' 
AND rowsecurity = true;

-- =====================================================
-- PART 7: KEY TABLE VERIFICATION
-- =====================================================

SELECT '=== KEY TABLES VERIFICATION ===' AS section;

-- Check canonical_users
SELECT 
  'canonical_users' AS table_name,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_name = 'canonical_users'
  ) THEN '✓ EXISTS' ELSE '✗ MISSING' END AS status;

-- Check competitions
SELECT 
  'competitions' AS table_name,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_name = 'competitions'
  ) THEN '✓ EXISTS' ELSE '✗ MISSING' END AS status;

-- Check tickets
SELECT 
  'tickets' AS table_name,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_name = 'tickets'
  ) THEN '✓ EXISTS' ELSE '✗ MISSING' END AS status;

-- Check sub_account_balances
SELECT 
  'sub_account_balances' AS table_name,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_name = 'sub_account_balances'
  ) THEN '✓ EXISTS' ELSE '✗ MISSING' END AS status;

-- Check balance_ledger
SELECT 
  'balance_ledger' AS table_name,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_name = 'balance_ledger'
  ) THEN '✓ EXISTS' ELSE '✗ MISSING' END AS status;

-- Check orders
SELECT 
  'orders' AS table_name,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_name = 'orders'
  ) THEN '✓ EXISTS' ELSE '✗ MISSING' END AS status;

-- Check payment_idempotency
SELECT 
  'payment_idempotency' AS table_name,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_name = 'payment_idempotency'
  ) THEN '✓ EXISTS' ELSE '✗ MISSING' END AS status;

-- =====================================================
-- PART 8: KEY FUNCTION VERIFICATION
-- =====================================================

SELECT '=== KEY FUNCTIONS VERIFICATION ===' AS section;

-- Check get_user_balance
SELECT 
  'get_user_balance' AS function_name,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.routines 
    WHERE routine_name = 'get_user_balance'
  ) THEN '✓ EXISTS' ELSE '✗ MISSING' END AS status;

-- Check execute_balance_payment
SELECT 
  'execute_balance_payment' AS function_name,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.routines 
    WHERE routine_name = 'execute_balance_payment'
  ) THEN '✓ EXISTS' ELSE '✗ MISSING' END AS status;

-- Check reserve_tickets_atomically
SELECT 
  'reserve_tickets_atomically' AS function_name,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.routines 
    WHERE routine_name = 'reserve_tickets_atomically'
  ) THEN '✓ EXISTS' ELSE '✗ MISSING' END AS status;

-- Check get_user_wallets
SELECT 
  'get_user_wallets' AS function_name,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.routines 
    WHERE routine_name = 'get_user_wallets'
  ) THEN '✓ EXISTS' ELSE '✗ MISSING' END AS status;

-- Check upsert_canonical_user
SELECT 
  'upsert_canonical_user' AS function_name,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.routines 
    WHERE routine_name = 'upsert_canonical_user'
  ) THEN '✓ EXISTS' ELSE '✗ MISSING' END AS status;

-- Check get_comprehensive_user_dashboard_entries
SELECT 
  'get_comprehensive_user_dashboard_entries' AS function_name,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.routines 
    WHERE routine_name = 'get_comprehensive_user_dashboard_entries'
  ) THEN '✓ EXISTS' ELSE '✗ MISSING' END AS status;

-- =====================================================
-- PART 9: EXTENSION VERIFICATION
-- =====================================================

SELECT '=== EXTENSIONS ===' AS section;
SELECT 
  extname AS extension_name,
  '✓ INSTALLED' AS status
FROM pg_extension 
WHERE extname IN ('uuid-ossp', 'pgcrypto')
ORDER BY extname;

-- =====================================================
-- PART 10: GRANTS VERIFICATION
-- =====================================================

SELECT '=== GRANTS TO anon ROLE ===' AS section;
SELECT 
  COUNT(DISTINCT routine_name) AS functions_granted_to_anon
FROM information_schema.routine_privileges
WHERE grantee = 'anon'
AND routine_schema = 'public';

SELECT '=== GRANTS TO authenticated ROLE ===' AS section;
SELECT 
  COUNT(DISTINCT routine_name) AS functions_granted_to_authenticated
FROM information_schema.routine_privileges
WHERE grantee = 'authenticated'
AND routine_schema = 'public';

-- =====================================================
-- PART 11: FOREIGN KEY VERIFICATION
-- =====================================================

SELECT '=== FOREIGN KEYS ===' AS section;
SELECT 
  COUNT(*) AS foreign_key_count
FROM information_schema.table_constraints
WHERE constraint_schema = 'public'
AND constraint_type = 'FOREIGN KEY';

-- =====================================================
-- PART 12: UNIQUE CONSTRAINT VERIFICATION
-- =====================================================

SELECT '=== UNIQUE CONSTRAINTS ===' AS section;
SELECT 
  COUNT(*) AS unique_constraint_count
FROM information_schema.table_constraints
WHERE constraint_schema = 'public'
AND constraint_type = 'UNIQUE';

-- =====================================================
-- PART 13: PRIMARY KEY VERIFICATION
-- =====================================================

SELECT '=== PRIMARY KEYS ===' AS section;
SELECT 
  COUNT(*) AS primary_key_count,
  '45 expected (one per table)' AS expected
FROM information_schema.table_constraints
WHERE constraint_schema = 'public'
AND constraint_type = 'PRIMARY KEY';

-- =====================================================
-- PART 14: SAMPLE FUNCTION TEST
-- =====================================================

SELECT '=== SAMPLE FUNCTION TEST ===' AS section;

-- Test get_user_balance (should return 0 for non-existent user)
SELECT 
  'get_user_balance' AS test_function,
  get_user_balance('test-non-existent-user') AS result,
  '0 expected' AS expected;

-- =====================================================
-- VERIFICATION COMPLETE
-- =====================================================

SELECT '=== VERIFICATION COMPLETE ===' AS section;
SELECT 
  'Review the results above. All key checks should show ✓ EXISTS.' AS message;
