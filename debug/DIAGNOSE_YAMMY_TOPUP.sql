-- DIAGNOSE: Why did yammy's top-up show $6 instead of $4.50?
-- User: yammy
-- Wallet: 0xc344b1...26dd
-- Expected: $3 + 50% bonus = $4.50
-- Actual: $6
--
-- POSSIBLE CAUSES:
-- A) $3 credited twice (no bonus) = $6
-- B) $3 + $1.50 + $1.50 (bonus applied twice) = $6
--
-- Run in Supabase SQL Editor to find out which one

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
-- STEP 3: THE ANSWER - Check balance_ledger for any duplicate credits
-- THIS WILL TELL US EXACTLY WHAT HAPPENED
-- ============================================================================
SELECT 
  id,
  canonical_user_id,
  transaction_type,  -- 'credit' vs 'bonus_credit' - THIS IS KEY
  amount,
  reference_id,
  description,
  balance_before,
  balance_after,
  created_at
FROM balance_ledger
WHERE canonical_user_id ILIKE '%0xc344%'
ORDER BY created_at ASC;

-- INTERPRETATION:
-- If you see TWO 'credit' entries of $3 each = Scenario A (base credited twice)
-- If you see ONE 'credit' $3 + TWO 'bonus_credit' $1.50 = Scenario B (bonus twice)
-- If you see ONE 'credit' $3 + ONE 'bonus_credit' + ONE 'credit' $1.50 = Mixed

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
-- STEP 8: CHECK ACTIVE TRIGGERS (THE ROOT CAUSE)
-- Multiple triggers were crediting balances causing duplicates!
-- ============================================================================

SELECT trigger_name, event_manipulation, action_timing
FROM information_schema.triggers
WHERE event_object_table = 'user_transactions'
  AND (
    trigger_name ILIKE '%credit%'
    OR trigger_name ILIKE '%topup%' 
    OR trigger_name ILIKE '%bonus%'
    OR trigger_name ILIKE '%commerce_post%'
    OR trigger_name ILIKE '%wallet%'
  )
ORDER BY trigger_name;

-- Known problematic triggers that can cause double-crediting:
-- - trg_user_tx_commerce_post → credits $amount (no bonus)
-- - trg_apply_topup_and_welcome_bonus → credits $amount + 50% 
-- - trg_optimistic_topup_credit → credits $amount + 50%
-- - trg_credit_sub_account_on_instant_wallet_topup → credits $amount
-- - trg_auto_credit_on_external_topup → credits $amount

-- FIX: Run debug/DISABLE_ALL_CREDIT_TRIGGERS.sql to disable all trigger-based
-- crediting and let ONLY webhook code handle it with proper idempotency.

