-- FIX: Credit missing $3 Coinbase topup to balance
-- Run in Supabase SQL Editor

-- ============================================================================
-- DIAGNOSTIC: Why are Coinbase topups stuck at "pending"?
-- ============================================================================

-- 1. Check user's Coinbase transactions - are they stuck at pending?
SELECT 
  id,
  type,
  amount,
  status,
  payment_status,
  payment_provider,
  tx_id,
  webhook_ref,
  wallet_credited,
  created_at,
  completed_at
FROM user_transactions 
WHERE canonical_user_id = 'prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363'
  AND payment_provider = 'coinbase'
ORDER BY created_at DESC
LIMIT 10;

-- 2. Check webhook events - are webhooks being received?
SELECT 
  id,
  provider,
  event_type,
  charge_id,
  user_id,
  status,
  webhook_received_at,
  created_at
FROM payment_webhook_events
WHERE provider = 'coinbase_commerce'
ORDER BY created_at DESC
LIMIT 20;

-- 3. Check if there are any charge:confirmed events for this user
SELECT 
  id,
  event_type,
  user_id,
  charge_id,
  webhook_received_at
FROM payment_webhook_events
WHERE provider = 'coinbase_commerce'
  AND user_id LIKE '%0x0ff51ec0ecc9ae1e5e6048976ba307c849781363%'
ORDER BY created_at DESC
LIMIT 10;

-- ============================================================================
-- IMMEDIATE FIX: Mark pending coinbase topups as completed and credit them
-- This will fix ALL pending coinbase topups for this user
-- ============================================================================

-- First, see how many pending topups need fixing:
SELECT id, amount, created_at 
FROM user_transactions 
WHERE canonical_user_id = 'prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363'
  AND payment_provider = 'coinbase'
  AND status = 'pending'
  AND type = 'topup';

-- UNCOMMENT TO FIX ALL PENDING COINBASE TOPUPS:
-- DO $$
-- DECLARE
--   r RECORD;
--   result JSONB;
-- BEGIN
--   FOR r IN 
--     SELECT id, amount 
--     FROM user_transactions 
--     WHERE canonical_user_id = 'prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363'
--       AND payment_provider = 'coinbase'
--       AND status = 'pending'
--       AND type = 'topup'
--       AND (wallet_credited IS NULL OR wallet_credited = false)
--   LOOP
--     -- Credit the balance
--     SELECT credit_balance_with_first_deposit_bonus(
--       'prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363',
--       r.amount,
--       'coinbase_pending_fix',
--       'fix_' || r.id::text
--     ) INTO result;
--     
--     -- Mark as completed
--     UPDATE user_transactions 
--     SET status = 'completed',
--         payment_status = 'completed',
--         wallet_credited = true,
--         completed_at = NOW()
--     WHERE id = r.id;
--     
--     RAISE NOTICE 'Fixed transaction % for $%', r.id, r.amount;
--   END LOOP;
-- END $$;
