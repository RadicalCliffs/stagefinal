-- DIAGNOSE: Why did yammy's top-up go in twice?
-- User: yammy
-- Wallet: 0xc344b1...26dd (full: 0xc344b1xxxxxxxxxxxx26dd)
-- Account ID: prize:pid:0xc344...26dd
-- Run in Supabase SQL Editor

-- The wallet address partial is: 0xc344b1...26dd
-- Let's find the full canonical_user_id

-- ============================================================================
-- STEP 1: Find yammy's canonical_user_id
-- ============================================================================
SELECT 
  canonical_user_id,
  wallet_address,
  smart_wallet_address,
  username,
  created_at,
  has_used_new_user_bonus
FROM canonical_users
WHERE canonical_user_id ILIKE '%0xc344%'
   OR wallet_address ILIKE '%0xc344%'
   OR username = 'yammy';

-- ============================================================================
-- STEP 2: Check ALL user_transactions for this user (looking for duplicates)
-- ============================================================================
SELECT 
  id,
  type,
  amount,
  status,
  payment_status,
  payment_provider,
  tx_id,
  charge_id,
  webhook_ref,
  posted_to_balance,
  wallet_credited,
  created_at,
  completed_at,
  metadata
FROM user_transactions 
WHERE (canonical_user_id ILIKE '%0xc344%' OR user_id ILIKE '%0xc344%')
ORDER BY created_at DESC
LIMIT 20;

-- ============================================================================
-- STEP 3: Check balance_ledger for any duplicate credits
-- ============================================================================
SELECT 
  id,
  canonical_user_id,
  transaction_type,
  amount,
  reference_id,
  description,
  balance_before,
  balance_after,
  created_at
FROM balance_ledger
WHERE canonical_user_id ILIKE '%0xc344%'
ORDER BY created_at DESC
LIMIT 20;

-- ============================================================================
-- STEP 4: Check sub_account_balances (current balance)
-- ============================================================================
SELECT 
  id,
  canonical_user_id,
  user_id,
  currency,
  available_balance,
  bonus_balance,
  pending_balance,
  updated_at
FROM sub_account_balances
WHERE canonical_user_id ILIKE '%0xc344%'
   OR user_id ILIKE '%0xc344%';

-- ============================================================================
-- STEP 5: Check payment_webhook_events - did webhook fire twice?
-- ============================================================================
SELECT 
  id,
  event_id,
  provider,
  event_type,
  charge_id,
  user_id,
  status,
  webhook_received_at,
  created_at,
  payload->'event'->>'id' as coinbase_event_id,
  payload->'event'->'data'->>'code' as charge_code,
  payload->'event'->'data'->'metadata'->>'user_id' as metadata_user_id
FROM payment_webhook_events
WHERE user_id ILIKE '%0xc344%'
   OR payload::text ILIKE '%0xc344%'
ORDER BY created_at DESC
LIMIT 20;

-- ============================================================================
-- STEP 6: Check for potential causes of duplicate crediting
-- ============================================================================

-- A) Check if the same tx_id was credited multiple times
SELECT 
  tx_id,
  charge_id,
  COUNT(*) as transaction_count,
  SUM(amount) as total_amount,
  array_agg(id) as transaction_ids,
  array_agg(status) as statuses,
  array_agg(posted_to_balance) as posted_flags
FROM user_transactions 
WHERE (canonical_user_id ILIKE '%0xc344%' OR user_id ILIKE '%0xc344%')
  AND type = 'topup'
GROUP BY tx_id, charge_id
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC;

-- B) Check if any reference_ids are duplicated in balance_ledger
SELECT 
  reference_id,
  COUNT(*) as ledger_count,
  SUM(amount) as total_credited,
  array_agg(created_at ORDER BY created_at) as credit_times
FROM balance_ledger
WHERE canonical_user_id ILIKE '%0xc344%'
  AND transaction_type IN ('deposit', 'credit', 'topup')
GROUP BY reference_id
HAVING COUNT(*) > 1;

-- ============================================================================
-- STEP 7: SPECIFIC TOPUP ANALYSIS - find matching amounts
-- ============================================================================
-- Look for topups that might have been credited more than once
SELECT 
  t.amount,
  COUNT(*) as topup_count,
  COUNT(DISTINCT t.id) as unique_transactions,
  COUNT(DISTINCT l.id) as ledger_entries,
  SUM(CASE WHEN t.posted_to_balance = true THEN 1 ELSE 0 END) as posted_count,
  array_agg(t.id ORDER BY t.created_at) as transaction_ids,
  array_agg(t.status ORDER BY t.created_at) as statuses,
  array_agg(t.created_at ORDER BY t.created_at) as timestamps
FROM user_transactions t
LEFT JOIN balance_ledger l ON l.reference_id = t.id::text OR l.reference_id = t.tx_id
WHERE (t.canonical_user_id ILIKE '%0xc344%' OR t.user_id ILIKE '%0xc344%')
  AND t.type = 'topup'
GROUP BY t.amount
ORDER BY t.amount DESC;

-- ============================================================================
-- STEP 8: Timeline of ALL balance changes
-- ============================================================================
SELECT 
  'user_transaction' as source,
  id::text as record_id,
  amount,
  status,
  type as transaction_type,
  posted_to_balance as credited,
  created_at,
  completed_at
FROM user_transactions
WHERE (canonical_user_id ILIKE '%0xc344%' OR user_id ILIKE '%0xc344%')
  AND type = 'topup'

UNION ALL

SELECT 
  'balance_ledger' as source,
  id::text as record_id,
  amount,
  NULL as status,
  transaction_type,
  true as credited,
  created_at,
  NULL as completed_at
FROM balance_ledger
WHERE canonical_user_id ILIKE '%0xc344%'
  AND transaction_type IN ('deposit', 'credit', 'topup')

ORDER BY created_at DESC;
