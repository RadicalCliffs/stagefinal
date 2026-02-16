-- =====================================================
-- CRITICAL INVESTIGATION: What's REALLY in user_transactions?
-- =====================================================
-- Run this to see actual payment_status and status values being used
-- This will tell us if the issue is really about 'success' status or something else

\echo '=== INVESTIGATION 1: Distinct payment_status values ==='
\echo 'Checking what payment_status values actually exist in user_transactions...'
SELECT 
  payment_status,
  COUNT(*) as transaction_count,
  COUNT(DISTINCT canonical_user_id) as unique_users,
  STRING_AGG(DISTINCT payment_provider, ', ') as providers_using_this_status,
  MIN(created_at)::date as first_seen,
  MAX(created_at)::date as last_seen
FROM user_transactions
WHERE competition_id IS NOT NULL  -- Only competition entries
GROUP BY payment_status
ORDER BY transaction_count DESC;

\echo ''
\echo '=== INVESTIGATION 2: Distinct status values ==='
\echo 'Checking what status values actually exist in user_transactions...'
SELECT 
  status,
  COUNT(*) as transaction_count,
  COUNT(DISTINCT canonical_user_id) as unique_users,
  STRING_AGG(DISTINCT payment_provider, ', ') as providers_using_this_status,
  MIN(created_at)::date as first_seen,
  MAX(created_at)::date as last_seen
FROM user_transactions
WHERE competition_id IS NOT NULL  -- Only competition entries
GROUP BY status
ORDER BY transaction_count DESC;

\echo ''
\echo '=== INVESTIGATION 3: Payment provider breakdown ==='
\echo 'Showing which providers use which status combinations...'
SELECT 
  payment_provider,
  payment_status,
  status,
  COUNT(*) as count,
  ROUND(AVG(ticket_count), 2) as avg_tickets
FROM user_transactions
WHERE competition_id IS NOT NULL
  AND ticket_count > 0
GROUP BY payment_provider, payment_status, status
ORDER BY count DESC
LIMIT 20;

\echo ''
\echo '=== INVESTIGATION 4: What's being EXCLUDED by current filter? ==='
\echo 'These transactions SHOULD show in dashboard but currently DON''T...'
SELECT 
  payment_status,
  status,
  payment_provider,
  type,
  COUNT(*) as transactions_excluded,
  SUM(ticket_count) as tickets_excluded,
  ROUND(SUM(amount), 2) as revenue_excluded
FROM user_transactions
WHERE competition_id IS NOT NULL
  AND ticket_count > 0
  AND type != 'topup'
  -- These are EXCLUDED by the current filter in get_comprehensive_user_dashboard_entries
  AND payment_status NOT IN ('completed', 'confirmed')
GROUP BY payment_status, status, payment_provider, type
ORDER BY transactions_excluded DESC;

\echo ''
\echo '=== INVESTIGATION 5: Sample of balance payments (last 10) ==='
\echo 'Checking actual status values from balance deductions...'
SELECT 
  id,
  canonical_user_id,
  competition_id,
  payment_provider,
  payment_status,
  status,
  ticket_count,
  amount,
  created_at::date as date
FROM user_transactions
WHERE type != 'topup'
  AND (payment_provider LIKE '%balance%' OR payment_provider = 'balance')
  AND competition_id IS NOT NULL
ORDER BY created_at DESC
LIMIT 10;

\echo ''
\echo '=== INVESTIGATION 6: Sample of base_account payments (last 10) ==='
\echo 'Checking actual status values from base network payments...'
SELECT 
  id,
  canonical_user_id,
  competition_id,
  payment_provider,
  payment_status,
  status,
  ticket_count,
  amount,
  created_at::date as date
FROM user_transactions
WHERE type != 'topup'
  AND (payment_provider LIKE '%base%' OR payment_provider = 'base_account' OR payment_provider = 'privy_base_wallet')
  AND competition_id IS NOT NULL
ORDER BY created_at DESC
LIMIT 10;

\echo ''
\echo '=== INVESTIGATION 7: Get RPC result for a test user ==='
\echo 'Replace TEST_USER_CANONICAL_ID with an actual canonical_user_id that should have entries...'
\echo 'SELECT * FROM get_comprehensive_user_dashboard_entries(''TEST_USER_CANONICAL_ID'');'
