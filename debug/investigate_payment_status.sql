-- =====================================================
-- INVESTIGATION: What payment_status values are ACTUALLY being used?
-- =====================================================
-- Run this against your production database to see what's really happening

-- 1. Get all distinct payment_status values in user_transactions
SELECT 
  payment_status,
  COUNT(*) as count,
  COUNT(DISTINCT canonical_user_id) as unique_users,
  MIN(created_at) as first_seen,
  MAX(created_at) as last_seen
FROM user_transactions
WHERE competition_id IS NOT NULL  -- Only competition entries, not top-ups
GROUP BY payment_status
ORDER BY count DESC;

-- 2. Get all distinct status values in user_transactions
SELECT 
  status,
  COUNT(*) as count,
  COUNT(DISTINCT canonical_user_id) as unique_users,
  MIN(created_at) as first_seen,
  MAX(created_at) as last_seen
FROM user_transactions
WHERE competition_id IS NOT NULL
GROUP BY status
ORDER BY count DESC;

-- 3. Get payment_provider breakdown by payment_status
SELECT 
  payment_provider,
  payment_status,
  status,
  COUNT(*) as count
FROM user_transactions
WHERE competition_id IS NOT NULL
GROUP BY payment_provider, payment_status, status
ORDER BY count DESC;

-- 4. Sample recent transactions with all relevant fields
SELECT 
  id,
  canonical_user_id,
  competition_id,
  payment_provider,
  payment_status,
  status,
  type,
  amount,
  ticket_count,
  created_at,
  completed_at
FROM user_transactions
WHERE competition_id IS NOT NULL
ORDER BY created_at DESC
LIMIT 50;

-- 5. Check what get_comprehensive_user_dashboard_entries returns for a test user
-- Replace 'TEST_USER_ID' with an actual canonical_user_id
-- SELECT * FROM get_comprehensive_user_dashboard_entries('TEST_USER_ID');

-- 6. Check if there are transactions that SHOULD show up but don't
-- (have competition_id and ticket_count, but status is not 'completed'/'confirmed')
SELECT 
  payment_status,
  status,
  payment_provider,
  COUNT(*) as count,
  SUM(ticket_count) as total_tickets
FROM user_transactions
WHERE competition_id IS NOT NULL
  AND ticket_count > 0
  AND type != 'topup'
  AND payment_status NOT IN ('completed', 'confirmed')  -- These would be EXCLUDED by current filter
GROUP BY payment_status, status, payment_provider
ORDER BY count DESC;
