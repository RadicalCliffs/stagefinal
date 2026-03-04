-- ============================================================================
-- COMPREHENSIVE FIX FOR USER 'INVEST' STUCK TOPUPS
-- User: investors@theprize.io (username: invest)
-- Issue: 2x $3 topups paid but not credited due to create-charge session_id bug
-- Charge IDs: f523f343-f839-4838-948d-cbfd5103f658, aaf7dbbd-556c-4338-9e12-767678c005b8
-- Transaction IDs: acf7261a-1175-42ef-8a86-efcbe0c656bf, eb94dae4-d3a6-4736-bb52-f97f36e66ec4
-- ============================================================================

-- Step 1: Check current transaction state
SELECT 
  id,
  user_id,
  canonical_user_id,
  wallet_address,
  amount,
  status,
  payment_status,
  charge_id,
  charge_code,
  posted_to_balance,
  created_at
FROM user_transactions
WHERE user_id = 'prize:pid:0x7b343a531688ac9ed7fbce4f16048970d1c7ba05'
  AND type = 'topup'
ORDER BY created_at DESC;

-- Step 2: Check if webhooks arrived for these charges
SELECT 
  event_id,
  event_type,
  status,
  payload->'event'->'data'->'id' as charge_id,
  payload->'event'->'data'->'code' as charge_code,
  payload->'event'->'data'->'pricing'->'local'->'amount' as amount,
  received_at
FROM payment_webhook_events
WHERE provider = 'coinbase_commerce'
  AND (
    payload->'event'->'data'->>'id' = 'f523f343-f839-4838-948d-cbfd5103f658'
    OR payload->'event'->'data'->>'id' = 'aaf7dbbd-556c-4338-9e12-767678c005b8'
    OR payload->'event'->'data'->>'code' = 'H6FLGWZM'
    OR payload->'event'->'data'->>'code' = 'TCWKD4AZ'
  )
ORDER BY received_at DESC;

-- Step 3: Update first transaction with charge data
UPDATE user_transactions SET
  canonical_user_id = 'prize:pid:0x7b343a531688ac9ed7fbce4f16048970d1c7ba05',
  wallet_address = '0x7b343a531688ac9ed7fbce4f16048970d1c7ba05',
  charge_id = 'f523f343-f839-4838-948d-cbfd5103f658',
  charge_code = 'H6FLGWZM',
  checkout_url = 'https://commerce.coinbase.com/pay/f523f343-f839-4838-948d-cbfd5103f658',
  status = 'completed',
  payment_status = 'confirmed',
  updated_at = NOW()
WHERE id = 'acf7261a-1175-42ef-8a86-efcbe0c656bf';

-- Step 4: Update second transaction with charge data
UPDATE user_transactions SET
  canonical_user_id = 'prize:pid:0x7b343a531688ac9ed7fbce4f16048970d1c7ba05',
  wallet_address = '0x7b343a531688ac9ed7fbce4f16048970d1c7ba05',
  charge_id = 'aaf7dbbd-556c-4338-9e12-767678c005b8',
  charge_code = 'TCWKD4AZ',
  checkout_url = 'https://commerce.coinbase.com/pay/aaf7dbbd-556c-4338-9e12-767678c005b8',
  status = 'completed',
  payment_status = 'confirmed',
  updated_at = NOW()
WHERE id = 'eb94dae4-d3a6-4736-bb52-f97f36e66ec4';

-- Step 5: Credit ONLY if not already posted (prevents duplicates)
DO $$
BEGIN
  -- Check first transaction
  IF NOT EXISTS (
    SELECT 1 FROM user_transactions 
    WHERE id = 'acf7261a-1175-42ef-8a86-efcbe0c656bf' 
    AND posted_to_balance = true
  ) THEN
    PERFORM credit_balance_with_first_deposit_bonus(
      'prize:pid:0x7b343a531688ac9ed7fbce4f16048970d1c7ba05', 
      3.00, 
      'commerce_topup',
      'acf7261a-1175-42ef-8a86-efcbe0c656bf'
    );
    
    UPDATE user_transactions 
    SET posted_to_balance = true
    WHERE id = 'acf7261a-1175-42ef-8a86-efcbe0c656bf';
    
    RAISE NOTICE 'Transaction 1 credited';
  ELSE
    RAISE NOTICE 'Transaction 1 already credited - skipping';
  END IF;
  
  -- Check second transaction
  IF NOT EXISTS (
    SELECT 1 FROM user_transactions 
    WHERE id = 'eb94dae4-d3a6-4736-bb52-f97f36e66ec4' 
    AND posted_to_balance = true
  ) THEN
    PERFORM credit_balance_with_first_deposit_bonus(
      'prize:pid:0x7b343a531688ac9ed7fbce4f16048970d1c7ba05', 
      3.00, 
      'commerce_topup',
      'eb94dae4-d3a6-4736-bb52-f97f36e66ec4'
    );
    
    UPDATE user_transactions 
    SET posted_to_balance = true
    WHERE id = 'eb94dae4-d3a6-4736-bb52-f97f36e66ec4';
    
    RAISE NOTICE 'Transaction 2 credited';
  ELSE
    RAISE NOTICE 'Transaction 2 already credited - skipping';
  END IF;
END $$;

-- Step 6: Verify final state
SELECT 
  id,
  amount,
  status,
  payment_status,
  charge_id,
  charge_code,
  posted_to_balance
FROM user_transactions
WHERE id IN (
  'acf7261a-1175-42ef-8a86-efcbe0c656bf',
  'eb94dae4-d3a6-4736-bb52-f97f36e66ec4'
);

-- Step 7: Check user's balance
SELECT 
  canonical_user_id,
  available_balance
FROM sub_account_balances
WHERE canonical_user_id = 'prize:pid:0x7b343a531688ac9ed7fbce4f16048970d1c7ba05';

-- Step 8: Check for duplicate ledger entries
SELECT 
  id,
  canonical_user_id,
  amount,
  transaction_type,
  reference_id,
  created_at
FROM balance_ledger
WHERE canonical_user_id = 'prize:pid:0x7b343a531688ac9ed7fbce4f16048970d1c7ba05'
  AND reference_id IN (
    'acf7261a-1175-42ef-8a86-efcbe0c656bf',
    'eb94dae4-d3a6-4736-bb52-f97f36e66ec4'
  )
ORDER BY created_at DESC;

-- === COMPLETE: User invest should now have $6 + bonuses credited ===
