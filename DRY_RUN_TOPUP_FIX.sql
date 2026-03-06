-- ============================================================================
-- DRY RUN: Preview what the fix script will do
-- ============================================================================
-- Run this first to see what would happen without making any changes
-- ============================================================================

\echo '🔍 DRY RUN MODE - NO CHANGES WILL BE MADE'
\echo ''

-- Check users without balance records
\echo '=== USERS WITHOUT BALANCE RECORDS ==='
SELECT 
  COUNT(*) as users_without_balance,
  'Will create sub_account_balances records for these users' as action
FROM canonical_users cu
WHERE NOT EXISTS (
  SELECT 1 FROM sub_account_balances sab 
  WHERE sab.canonical_user_id = cu.canonical_user_id 
    AND sab.currency = 'USD'
);

\echo ''
\echo '=== STUCK TOPUPS TO BE CREDITED ==='
SELECT 
  COUNT(*) as stuck_topup_count,
  SUM(amount) as total_amount,
  'Will credit these topups with 50% bonus where applicable' as action
FROM user_transactions
WHERE type = 'topup'
  AND (status = 'completed' OR payment_status = 'completed')
  AND (posted_to_balance IS NULL OR posted_to_balance = false)
  AND amount > 0
  AND canonical_user_id IS NOT NULL;

-- Show sample of stuck topups
\echo ''
\echo '=== SAMPLE OF STUCK TOPUPS (first 10) ==='
SELECT 
  id,
  canonical_user_id,
  amount,
  status,
  payment_status,
  posted_to_balance,
  created_at,
  CASE 
    WHEN webhook_ref IS NOT NULL THEN 'webhook_ref'
    WHEN tx_id IS NOT NULL THEN 'tx_id'
    WHEN charge_id IS NOT NULL THEN 'charge_id'
    ELSE 'transaction.id'
  END as reference_id_source
FROM user_transactions
WHERE type = 'topup'
  AND (status = 'completed' OR payment_status = 'completed')
  AND (posted_to_balance IS NULL OR posted_to_balance = false)
  AND amount > 0
  AND canonical_user_id IS NOT NULL
ORDER BY created_at ASC
LIMIT 10;

\echo ''
\echo '=== CHECK FOR ALREADY-CREDITED TOPUPS ==='
-- This finds topups that appear stuck but actually have balance_ledger entries
SELECT 
  ut.id as transaction_id,
  ut.amount,
  ut.posted_to_balance,
  COUNT(bl.id) as existing_ledger_entries,
  'Will skip - already has ledger entry' as action
FROM user_transactions ut
INNER JOIN balance_ledger bl 
  ON bl.canonical_user_id = ut.canonical_user_id
  AND (
    bl.reference_id = ut.webhook_ref
    OR bl.reference_id = ut.tx_id
    OR bl.reference_id = ut.charge_id
    OR bl.reference_id = ut.id::text
  )
WHERE ut.type = 'topup'
  AND (ut.status = 'completed' OR ut.payment_status = 'completed')
  AND (ut.posted_to_balance IS NULL OR ut.posted_to_balance = false)
  AND ut.amount > 0
  AND ut.canonical_user_id IS NOT NULL
GROUP BY ut.id, ut.amount, ut.posted_to_balance
LIMIT 10;

\echo ''
\echo '=== TRANSACTIONS WITH MISSING FIELDS ==='
SELECT 
  COUNT(*) as missing_field_count,
  'Will backfill canonical_user_id and completed_at' as action
FROM user_transactions
WHERE type = 'topup'
  AND (canonical_user_id IS NULL OR completed_at IS NULL);

\echo ''
\echo '=== CURRENT BALANCE SANITY CHECK ==='
SELECT 
  COUNT(*) as total_accounts,
  COUNT(*) FILTER (WHERE available_balance < 0) as negative_balances,
  COUNT(*) FILTER (WHERE available_balance > 100000) as balances_over_100k,
  MIN(available_balance) as min_balance,
  MAX(available_balance) as max_balance,
  AVG(available_balance) as avg_balance
FROM sub_account_balances
WHERE currency = 'USD';

\echo ''
\echo '=== SUMMARY ==='
\echo 'To execute these changes, run: FIX_ALL_TOPUP_ISSUES_NOW.sql'
\echo 'The script will wait 5 seconds before executing to give you time to cancel.'
\echo ''
