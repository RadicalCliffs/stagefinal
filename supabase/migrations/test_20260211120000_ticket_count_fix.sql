-- Test script for ticket count duplication fix
-- Verifies that the updated functions exist and have correct signatures
-- Run this after applying migration 20260211120000

\echo '=== Testing Ticket Count Duplication Fix ==='
\echo ''

-- Test 1: Verify get_user_competition_entries exists with correct signature
\echo 'Test 1: Checking get_user_competition_entries function...'
SELECT 
  routine_name,
  routine_type,
  security_type,
  routine_definition LIKE '%UNION%' AND routine_definition NOT LIKE '%UNION ALL%' as uses_union_not_union_all
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'get_user_competition_entries';

\echo ''

-- Test 2: Verify get_comprehensive_user_dashboard_entries exists with correct signature
\echo 'Test 2: Checking get_comprehensive_user_dashboard_entries function...'
SELECT 
  routine_name,
  routine_type,
  security_type,
  routine_definition LIKE '%UNION%' AND routine_definition NOT LIKE '%UNION ALL%' as uses_union_not_union_all
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'get_comprehensive_user_dashboard_entries';

\echo ''

-- Test 3: Check return columns for get_user_competition_entries
\echo 'Test 3: Checking get_user_competition_entries return columns...'
SELECT 
  parameter_name,
  data_type
FROM information_schema.parameters
WHERE specific_name = (
  SELECT specific_name 
  FROM information_schema.routines 
  WHERE routine_schema = 'public' 
    AND routine_name = 'get_user_competition_entries'
  LIMIT 1
)
  AND parameter_mode = 'OUT'
ORDER BY ordinal_position;

\echo ''

-- Test 4: Check return columns for get_comprehensive_user_dashboard_entries
\echo 'Test 4: Checking get_comprehensive_user_dashboard_entries return columns...'
SELECT 
  parameter_name,
  data_type
FROM information_schema.parameters
WHERE specific_name = (
  SELECT specific_name 
  FROM information_schema.routines 
  WHERE routine_schema = 'public' 
    AND routine_name = 'get_comprehensive_user_dashboard_entries'
  LIMIT 1
)
  AND parameter_mode = 'OUT'
ORDER BY ordinal_position;

\echo ''
\echo '=== Expected Results ==='
\echo 'Both functions should exist with SECURITY DEFINER'
\echo 'Both should use UNION (not UNION ALL) for deduplication'
\echo 'Return columns should match the TABLE(...) definitions'
\echo ''
\echo '=== Test Complete ==='
