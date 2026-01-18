-- =====================================================
-- Payment System Health Check
-- =====================================================
-- This script checks the health of the payment system
-- Run this regularly to identify issues with payments
-- Last Updated: January 18, 2026
-- =====================================================

-- =====================================================
-- 1. RECENT TRANSACTIONS OVERVIEW
-- =====================================================
\echo '1. Recent Transactions (Last 24 hours)'
\echo '----------------------------------------'

SELECT 
  status,
  payment_provider,
  COUNT(*) as count,
  SUM(amount) as total_amount,
  MIN(created_at) as oldest,
  MAX(created_at) as newest
FROM user_transactions
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY status, payment_provider
ORDER BY count DESC;

\echo ''

-- =====================================================
-- 2. STUCK PAYMENTS (>30 minutes in pending)
-- =====================================================
\echo '2. Stuck Payments (>30 minutes in pending/processing)'
\echo '---------------------------------------------------'

SELECT 
  id,
  user_id,
  competition_id,
  amount,
  status,
  payment_status,
  payment_provider,
  tx_id as coinbase_charge_id,
  created_at,
  ROUND(EXTRACT(EPOCH FROM (NOW() - created_at))/60, 1) as minutes_stuck
FROM user_transactions
WHERE status IN ('pending', 'processing', 'waiting')
  AND created_at < NOW() - INTERVAL '30 minutes'
  AND created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at ASC
LIMIT 50;

\echo ''

-- =====================================================
-- 3. NEEDS RECONCILIATION
-- =====================================================
\echo '3. Transactions Needing Reconciliation'
\echo '--------------------------------------'

SELECT 
  id,
  user_id,
  competition_id,
  amount,
  status,
  payment_status,
  tx_id as coinbase_charge_id,
  created_at,
  updated_at
FROM user_transactions
WHERE status = 'needs_reconciliation'
  AND created_at > NOW() - INTERVAL '7 days'
ORDER BY created_at DESC
LIMIT 50;

\echo ''

-- =====================================================
-- 4. COMPLETED BUT UNCONFIRMED ENTRIES
-- =====================================================
\echo '4. Completed Payments Without Confirmed Tickets'
\echo '-----------------------------------------------'

SELECT 
  ut.id as transaction_id,
  ut.user_id,
  ut.competition_id,
  ut.amount,
  ut.ticket_count,
  ut.status as txn_status,
  ut.tx_id as coinbase_charge_id,
  pt.id as pending_ticket_id,
  pt.status as pending_status,
  ut.created_at,
  COALESCE(
    (SELECT COUNT(*) FROM tickets WHERE order_id = ut.id),
    0
  ) as actual_tickets_count
FROM user_transactions ut
LEFT JOIN pending_tickets pt ON pt.session_id = ut.id
WHERE ut.payment_provider IN ('coinbase', 'coinbase_commerce')
  AND ut.competition_id IS NOT NULL
  AND ut.status IN ('finished', 'completed')
  AND ut.created_at > NOW() - INTERVAL '7 days'
  AND (
    pt.status IS NULL 
    OR pt.status != 'confirmed'
    OR (SELECT COUNT(*) FROM tickets WHERE order_id = ut.id) = 0
  )
ORDER BY ut.created_at DESC
LIMIT 50;

\echo ''

-- =====================================================
-- 5. TOP-UPS NOT CREDITED
-- =====================================================
\echo '5. Completed Top-ups Not Credited to Balance'
\echo '--------------------------------------------'

SELECT 
  ut.id as transaction_id,
  ut.user_id,
  ut.amount,
  ut.status,
  ut.wallet_credited,
  ut.credit_synced,
  ut.tx_id as coinbase_charge_id,
  ut.created_at,
  sab.available_balance as current_balance,
  sab.last_updated as balance_last_updated
FROM user_transactions ut
LEFT JOIN sub_account_balances sab 
  ON sab.canonical_user_id = ut.user_id 
  AND sab.currency = 'USD'
WHERE ut.payment_provider IN ('coinbase', 'coinbase_commerce')
  AND ut.competition_id IS NULL  -- Top-ups have no competition_id
  AND ut.status IN ('finished', 'completed')
  AND ut.created_at > NOW() - INTERVAL '7 days'
  AND (ut.wallet_credited IS NULL OR ut.wallet_credited = false)
ORDER BY ut.created_at DESC
LIMIT 50;

\echo ''

-- =====================================================
-- 6. WEBHOOK EVENT LOG
-- =====================================================
\echo '6. Recent Webhook Events'
\echo '------------------------'

SELECT 
  id,
  provider,
  status,
  created_at
FROM payment_webhook_events
WHERE provider = 'coinbase_commerce'
  AND created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC
LIMIT 20;

\echo ''

-- =====================================================
-- 7. PAYMENT PIPELINE METRICS
-- =====================================================
\echo '7. Payment Pipeline Metrics (Last 24 hours)'
\echo '----------------------------------------------'

WITH metrics AS (
  SELECT 
    'A. Total Payments Initiated' as metric,
    COUNT(*) as count,
    1 as sort_order
  FROM user_transactions
  WHERE created_at > NOW() - INTERVAL '24 hours'
  
  UNION ALL
  
  SELECT 
    'B. Payments Completed' as metric,
    COUNT(*) as count,
    2 as sort_order
  FROM user_transactions
  WHERE status IN ('finished', 'completed')
    AND created_at > NOW() - INTERVAL '24 hours'
  
  UNION ALL
  
  SELECT 
    'C. Entry Tickets Confirmed' as metric,
    COUNT(*) as count,
    3 as sort_order
  FROM tickets
  WHERE created_at > NOW() - INTERVAL '24 hours'
  
  UNION ALL
  
  SELECT 
    'D. Entries in joincompetition' as metric,
    COUNT(*) as count,
    4 as sort_order
  FROM joincompetition
  WHERE purchasedate > NOW() - INTERVAL '24 hours'
  
  UNION ALL
  
  SELECT 
    'E. Webhook Events Received' as metric,
    COUNT(*) as count,
    5 as sort_order
  FROM payment_webhook_events
  WHERE provider = 'coinbase_commerce'
    AND created_at > NOW() - INTERVAL '24 hours'
  
  UNION ALL
  
  SELECT 
    'F. Payments Stuck/Pending' as metric,
    COUNT(*) as count,
    6 as sort_order
  FROM user_transactions
  WHERE status IN ('pending', 'processing', 'waiting')
    AND created_at > NOW() - INTERVAL '24 hours'
  
  UNION ALL
  
  SELECT 
    'G. Needs Reconciliation' as metric,
    COUNT(*) as count,
    7 as sort_order
  FROM user_transactions
  WHERE status = 'needs_reconciliation'
    AND created_at > NOW() - INTERVAL '24 hours'
)
SELECT metric, count FROM metrics ORDER BY sort_order;

\echo ''

-- =====================================================
-- 8. HEALTH STATUS SUMMARY
-- =====================================================
\echo '10. Health Status Summary'
\echo '-------------------------'

WITH health_metrics AS (
  SELECT 
    COUNT(*) FILTER (WHERE status IN ('pending', 'processing', 'waiting') 
                     AND created_at < NOW() - INTERVAL '30 minutes') as stuck_count,
    COUNT(*) FILTER (WHERE status = 'needs_reconciliation') as reconcile_count,
    COUNT(*) FILTER (WHERE status IN ('finished', 'completed') 
                     AND competition_id IS NOT NULL
                     AND NOT EXISTS (
                       SELECT 1 FROM tickets WHERE order_id = user_transactions.id
                     )) as unconfirmed_entries,
    COUNT(*) FILTER (WHERE status IN ('finished', 'completed') 
                     AND competition_id IS NULL
                     AND (wallet_credited IS NULL OR wallet_credited = false)) as uncredited_topups
  FROM user_transactions
  WHERE created_at > NOW() - INTERVAL '7 days'
)
SELECT 
  CASE 
    WHEN stuck_count = 0 AND reconcile_count = 0 
         AND unconfirmed_entries = 0 AND uncredited_topups = 0 
    THEN 'HEALTHY'
    WHEN stuck_count + reconcile_count + unconfirmed_entries + uncredited_topups < 5
    THEN 'NEEDS ATTENTION'
    ELSE 'CRITICAL'
  END as overall_status,
  stuck_count as stuck_payments,
  reconcile_count as needs_reconciliation,
  unconfirmed_entries as unconfirmed_entries,
  uncredited_topups as uncredited_topups
FROM health_metrics;

\echo ''
\echo 'NEXT STEPS:'
\echo '  - If stuck_payments > 0: Check webhook configuration'
\echo '  - If needs_reconciliation > 0: Run manual reconciliation'
\echo '  - If unconfirmed_entries > 0: Check confirm-pending-tickets logs'
\echo '  - If uncredited_topups > 0: Check commerce-webhook logs'
\echo ''
\echo 'See PAYMENT_ARCHITECTURE_DIAGNOSTIC.md for detailed troubleshooting'
