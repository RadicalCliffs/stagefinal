-- Diagnose Orders Tab Issues
-- Run this in Supabase SQL Editor

-- 1. See what user_transactions look like for your user
SELECT 
  ut.id,
  ut.type,
  ut.competition_id,
  ut.amount,
  ut.currency,
  ut.status,
  ut.payment_status,
  ut.created_at,
  ut.webhook_ref,
  ut.payment_provider,
  c.title as competition_title,
  CASE 
    WHEN ut.competition_id IS NULL THEN 'topup (no comp_id)'
    WHEN ut.webhook_ref LIKE 'TOPUP_%' THEN 'topup (webhook)'
    ELSE 'entry'
  END as calculated_type
FROM user_transactions ut
LEFT JOIN competitions c ON ut.competition_id = c.id
WHERE ut.canonical_user_id = 'prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363'
   OR LOWER(ut.wallet_address) = '0x0ff51ec0ecc9ae1e5e6048976ba307c849781363'
   OR ut.user_id = 'prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363'
ORDER BY ut.created_at DESC
LIMIT 30;

-- 2. Check for duplicate transactions (same competition, same amount, similar time)
SELECT 
  competition_id,
  amount,
  type,
  DATE_TRUNC('minute', created_at) as minute_bucket,
  COUNT(*) as duplicate_count
FROM user_transactions
WHERE canonical_user_id = 'prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363'
   OR LOWER(wallet_address) = '0x0ff51ec0ecc9ae1e5e6048976ba307c849781363'
GROUP BY competition_id, amount, type, DATE_TRUNC('minute', created_at)
HAVING COUNT(*) > 1
ORDER BY minute_bucket DESC;

-- 3. Check what the RPC returns
SELECT * FROM get_user_transactions('prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363');

-- 4. Check for recent purchases in tickets table (last 7 days)
SELECT 
  t.id,
  t.competition_id,
  t.ticket_number,
  t.purchased_at,
  t.canonical_user_id,
  t.wallet_address,
  c.title as competition_title
FROM tickets t
LEFT JOIN competitions c ON t.competition_id = c.id
WHERE (t.canonical_user_id = 'prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363'
   OR LOWER(t.wallet_address) = '0x0ff51ec0ecc9ae1e5e6048976ba307c849781363')
   AND t.purchased_at > NOW() - INTERVAL '7 days'
ORDER BY t.purchased_at DESC
LIMIT 20;

-- 5. Check for recent purchases in joincompetition table
SELECT 
  jc.id,
  jc.competition_id,
  jc.ticket_count,
  jc.created_at,
  jc.canonical_user_id,
  jc.wallet_address,
  c.title as competition_title
FROM joincompetition jc
LEFT JOIN competitions c ON jc.competition_id = c.id
WHERE (jc.canonical_user_id = 'prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363'
   OR LOWER(jc.wallet_address) = '0x0ff51ec0ecc9ae1e5e6048976ba307c849781363')
   AND jc.created_at > NOW() - INTERVAL '7 days'
ORDER BY jc.created_at DESC
LIMIT 20;
