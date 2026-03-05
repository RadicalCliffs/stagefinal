-- ============================================================================
-- FIX NULL canonical_user_id IN user_transactions
-- ============================================================================
-- Problem: Topups were credited but user_transactions still has NULL canonical_user_id
-- Result: Transactions don't appear in orders tab (frontend filters by canonical_user_id)
-- Fix: Update all transactions to use their user_id as canonical_user_id
-- ============================================================================

-- Step 1: Show ALL transactions with NULL canonical_user_id
SELECT 
  id,
  user_id,
  canonical_user_id,
  type,
  amount,
  status,
  payment_status,
  posted_to_balance,
  wallet_credited,
  created_at
FROM user_transactions
WHERE canonical_user_id IS NULL
  AND user_id IS NOT NULL
ORDER BY created_at DESC;

-- Step 2: Update ALL transactions to set canonical_user_id = user_id
-- This makes them visible in orders tab
UPDATE user_transactions
SET 
  canonical_user_id = user_id,
  updated_at = NOW()
WHERE canonical_user_id IS NULL
  AND user_id IS NOT NULL;

-- Step 3: Verify the fix - should return 0 rows
SELECT 
  id,
  user_id,
  canonical_user_id,
  type,
  amount,
  status
FROM user_transactions
WHERE canonical_user_id IS NULL
  AND user_id IS NOT NULL;

-- Step 4: Show user 'invest' transactions (should now all be visible)
SELECT 
  id,
  canonical_user_id,
  type,
  amount,
  status,
  payment_status,
  posted_to_balance,
  charge_id,
  charge_code,
  created_at
FROM user_transactions
WHERE canonical_user_id = 'prize:pid:0x7b343a531688ac9ed7fbce4f16048970d1c7ba05'
ORDER BY created_at DESC;
