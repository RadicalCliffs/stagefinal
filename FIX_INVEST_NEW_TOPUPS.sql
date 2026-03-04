-- ============================================================================
-- FIX NEW STUCK TOPUPS FOR USER 'INVEST' (20:00 and 20:03 UTC)
-- Transaction IDs: d29acaad-4d15-4c41-a14e-92595962711d, eff224a1-d3ee-438c-a808-b98489b2b2ae
-- NOTE: Need charge IDs from Edge Function logs
-- ============================================================================

-- Step 1: Check current state
SELECT 
  id,
  canonical_user_id,
  amount,
  status,
  payment_status,
  charge_id,
  posted_to_balance,
  created_at
FROM user_transactions
WHERE id IN (
  'd29acaad-4d15-4c41-a14e-92595962711d',
  'eff224a1-d3ee-438c-a808-b98489b2b2ae'
);

-- Step 2: Update with charge data
UPDATE user_transactions SET
  canonical_user_id = 'prize:pid:0x7b343a531688ac9ed7fbce4f16048970d1c7ba05',
  wallet_address = '0x7b343a531688ac9ed7fbce4f16048970d1c7ba05',
  charge_id = '01aca19c-328d-476e-bba6-3b8559bfb4d1',
  charge_code = 'VRYJQL8E',
  checkout_url = 'https://commerce.coinbase.com/pay/01aca19c-328d-476e-bba6-3b8559bfb4d1',
  status = 'completed',
  payment_status = 'confirmed',
  updated_at = NOW()
WHERE id = 'eff224a1-d3ee-438c-a808-b98489b2b2ae';

UPDATE user_transactions SET
  canonical_user_id = 'prize:pid:0x7b343a531688ac9ed7fbce4f16048970d1c7ba05',
  wallet_address = '0x7b343a531688ac9ed7fbce4f16048970d1c7ba05',
  charge_id = '9d36ec69-6372-4073-b44d-d1aded976ecc',
  charge_code = '6V2W87PN',
  checkout_url = 'https://commerce.coinbase.com/pay/9d36ec69-6372-4073-b44d-d1aded976ecc',
  status = 'completed',
  payment_status = 'confirmed',
  updated_at = NOW()
WHERE id = 'd29acaad-4d15-4c41-a14e-92595962711d';

-- Step 3: Credit balances
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM user_transactions 
    WHERE id = 'eff224a1-d3ee-438c-a808-b98489b2b2ae' 
    AND posted_to_balance = true
  ) THEN
    PERFORM credit_balance_with_first_deposit_bonus(
      'prize:pid:0x7b343a531688ac9ed7fbce4f16048970d1c7ba05', 
      3.00, 
      'commerce_topup',
      'eff224a1-d3ee-438c-a808-b98489b2b2ae'
    );
    
    UPDATE user_transactions 
    SET posted_to_balance = true
    WHERE id = 'eff224a1-d3ee-438c-a808-b98489b2b2ae';
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM user_transactions 
    WHERE id = 'd29acaad-4d15-4c41-a14e-92595962711d' 
    AND posted_to_balance = true
  ) THEN
    PERFORM credit_balance_with_first_deposit_bonus(
      'prize:pid:0x7b343a531688ac9ed7fbce4f16048970d1c7ba05', 
      3.00, 
      'commerce_topup',
      'd29acaad-4d15-4c41-a14e-92595962711d'
    );
    
    UPDATE user_transactions 
    SET posted_to_balance = true
    WHERE id = 'd29acaad-4d15-4c41-a14e-92595962711d';
  END IF;
END $$;

-- Step 4: Verify balance
SELECT 
  canonical_user_id,
  available_balance
FROM sub_account_balances
WHERE canonical_user_id = 'prize:pid:0x7b343a531688ac9ed7fbce4f16048970d1c7ba05';
