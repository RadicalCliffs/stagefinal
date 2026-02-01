-- Verification script for restored RPC functions
-- Run this after applying the migrations to verify all functions exist

\echo '=== Checking for Restored RPC Functions ==='
\echo ''

-- Check if all 4 functions exist
\echo 'Checking function existence...'
SELECT 
  routine_name,
  routine_type,
  CASE 
    WHEN data_type = 'record' THEN 'TABLE(' || (
      SELECT string_agg(parameter_name || ' ' || COALESCE(udt_name, data_type), ', ')
      FROM information_schema.parameters
      WHERE specific_name = r.specific_name
        AND parameter_mode = 'OUT'
    ) || ')'
    ELSE data_type
  END as return_type,
  security_type,
  routine_definition IS NOT NULL as has_definition
FROM information_schema.routines r
WHERE routine_schema = 'public'
  AND routine_name IN (
    'credit_sub_account_balance',
    'debit_sub_account_balance',
    'confirm_ticket_purchase',
    'get_joincompetition_entries_for_competition'
  )
ORDER BY routine_name;

\echo ''
\echo '=== Expected: 4 functions ==='
\echo ''

-- Check function parameters for credit_sub_account_balance
\echo 'Checking credit_sub_account_balance parameters...'
SELECT 
  parameter_name,
  data_type,
  parameter_mode
FROM information_schema.parameters
WHERE specific_name = (
  SELECT specific_name 
  FROM information_schema.routines 
  WHERE routine_schema = 'public' 
    AND routine_name = 'credit_sub_account_balance'
  LIMIT 1
)
ORDER BY ordinal_position;

\echo ''

-- Check function parameters for debit_sub_account_balance
\echo 'Checking debit_sub_account_balance parameters...'
SELECT 
  parameter_name,
  data_type,
  parameter_mode
FROM information_schema.parameters
WHERE specific_name = (
  SELECT specific_name 
  FROM information_schema.routines 
  WHERE routine_schema = 'public' 
    AND routine_name = 'debit_sub_account_balance'
  LIMIT 1
)
ORDER BY ordinal_position;

\echo ''

-- Check function parameters for confirm_ticket_purchase
\echo 'Checking confirm_ticket_purchase parameters...'
SELECT 
  parameter_name,
  data_type,
  parameter_mode
FROM information_schema.parameters
WHERE specific_name = (
  SELECT specific_name 
  FROM information_schema.routines 
  WHERE routine_schema = 'public' 
    AND routine_name = 'confirm_ticket_purchase'
  LIMIT 1
)
ORDER BY ordinal_position;

\echo ''

-- Check function parameters for get_joincompetition_entries_for_competition
\echo 'Checking get_joincompetition_entries_for_competition parameters...'
SELECT 
  parameter_name,
  data_type,
  parameter_mode
FROM information_schema.parameters
WHERE specific_name = (
  SELECT specific_name 
  FROM information_schema.routines 
  WHERE routine_schema = 'public' 
    AND routine_name = 'get_joincompetition_entries_for_competition'
  LIMIT 1
)
ORDER BY ordinal_position;

\echo ''
\echo '=== Checking Permissions ==='
\echo ''

-- Check grants for service_role
SELECT 
  routine_name,
  grantee,
  privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name IN (
    'credit_sub_account_balance',
    'debit_sub_account_balance',
    'confirm_ticket_purchase',
    'get_joincompetition_entries_for_competition'
  )
  AND grantee IN ('service_role', 'authenticated', 'public')
ORDER BY routine_name, grantee;

\echo ''
\echo '=== Verification Complete ==='
\echo 'If all 4 functions appear with correct parameters and permissions, the migration was successful.'
