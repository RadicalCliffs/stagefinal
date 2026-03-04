-- ============================================================================
-- FIX USER 'invest' TOPUP TRANSACTIONS
-- ============================================================================
-- Problem: User has 2 topup transactions with missing fields:
-- - canonical_user_id is NULL
-- - wallet_address is NULL
-- - No charge_id from Coinbase
-- - Status still 'pending'
-- - Not credited to balance
-- ============================================================================

DO $$ 
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'STEP 1: Inspect current state';
  RAISE NOTICE '========================================';
END $$;

-- Show the problematic transactions
SELECT 
  id,
  user_id,
  canonical_user_id,
  wallet_address,
  amount,
  status,
  payment_status,
  payment_provider,
  charge_id,
  posted_to_balance,
  created_at
FROM user_transactions
WHERE user_id = 'prize:pid:0x7b343a531688ac9ed7fbce4f16048970d1c7ba05'
  AND type = 'topup'
ORDER BY created_at DESC;

DO $$ 
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE 'Checking canonical_users...';
END $$;

SELECT canonical_user_id, username, wallet_address, email
FROM canonical_users
WHERE canonical_user_id = 'prize:pid:0x7b343a531688ac9ed7fbce4f16048970d1c7ba05'
   OR wallet_address ILIKE '%7b343a531688ac9ed7fbce4f16048970d1c7ba05%';

DO $$ 
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE 'Checking for matching webhook events...';
END $$;

SELECT 
  event_id,
  event_type,
  status,
  payload->'event'->'data'->'id' as charge_id,
  payload->'event'->'data'->'metadata'->'user_id' as metadata_user_id,
  payload->'event'->'data'->'pricing'->'local'->'amount' as amount,
  received_at
FROM payment_webhook_events
WHERE provider = 'coinbase_commerce'
  AND received_at > NOW() - INTERVAL '2 hours'
  AND (
    payload->'event'->'data'->'metadata'->>'user_id' ILIKE '%7b343a531688ac9ed7fbce4f16048970d1c7ba05%'
    OR payload->'event'->'data'->'pricing'->'local'->>'amount' = '3'
  )
ORDER BY received_at DESC;

DO $$ 
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'STEP 2: Check if payment was actually confirmed';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'If webhook shows charge:confirmed, proceed with fix.';
  RAISE NOTICE 'If still charge:pending, wait for payment confirmation.';
  RAISE NOTICE '';
  RAISE NOTICE 'MANUAL ACTION REQUIRED:';
  RAISE NOTICE '1. Check webhook events above';
  RAISE NOTICE '2. If payment confirmed, uncomment and run the UPDATE below';
  RAISE NOTICE '3. Then run credit_balance_with_first_deposit_bonus';
END $$;

-- COMMENTED OUT - UNCOMMENT AFTER VERIFYING PAYMENT IS CONFIRMED
/*
DO $$
DECLARE
  v_canonical_user_id TEXT := 'prize:pid:0x7b343a531688ac9ed7fbce4f16048970d1c7ba05';
  v_wallet_address TEXT := '0x7b343a531688ac9ed7fbce4f16048970d1c7ba05';
  v_transaction_id_1 UUID := 'acf7261a-1175-42ef-8a86-efcbe0c656bf';
  v_transaction_id_2 UUID := 'eb94dae4-d3a6-4736-bb52-f97f36e66ec4';
  v_charge_id_1 TEXT := NULL; -- SET THIS from webhook data
  v_charge_id_2 TEXT := NULL; -- SET THIS from webhook data
BEGIN
  RAISE NOTICE 'Fixing transaction 1: %', v_transaction_id_1;
  
  -- Update first transaction
  UPDATE user_transactions
  SET 
    canonical_user_id = v_canonical_user_id,
    wallet_address = v_wallet_address,
    charge_id = v_charge_id_1,
    status = 'completed',
    payment_status = 'confirmed',
    completed_at = NOW(),
    updated_at = NOW()
  WHERE id = v_transaction_id_1;
  
  RAISE NOTICE 'Fixing transaction 2: %', v_transaction_id_2;
  
  -- Update second transaction
  UPDATE user_transactions
  SET 
    canonical_user_id = v_canonical_user_id,
    wallet_address = v_wallet_address,
    charge_id = v_charge_id_2,
    status = 'completed',
    payment_status = 'confirmed',
    completed_at = NOW(),
    updated_at = NOW()
  WHERE id = v_transaction_id_2;
  
  RAISE NOTICE 'Crediting balance for transaction 1...';
  
  -- Credit balance for first transaction
  PERFORM credit_balance_with_first_deposit_bonus(
    p_canonical_user_id := v_canonical_user_id,
    p_amount := 3.00,
    p_reason := 'commerce_topup',
    p_reference_id := v_transaction_id_1::text
  );
  
  RAISE NOTICE 'Crediting balance for transaction 2...';
  
  -- Credit balance for second transaction
  PERFORM credit_balance_with_first_deposit_bonus(
    p_canonical_user_id := v_canonical_user_id,
    p_amount := 3.00,
    p_reason := 'commerce_topup',
    p_reference_id := v_transaction_id_2::text
  );
  
  -- Mark as posted
  UPDATE user_transactions
  SET posted_to_balance = true, updated_at = NOW()
  WHERE id IN (v_transaction_id_1, v_transaction_id_2);
  
  RAISE NOTICE '✅ COMPLETE - User should now see $6 ($3 x 2 topups) in balance';
END $$;
*/

DO $$ 
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'DIAGNOSIS COMPLETE';
  RAISE NOTICE '========================================';
END $$;
