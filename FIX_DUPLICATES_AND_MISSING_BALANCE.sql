-- ============================================================================
-- FIX DUPLICATE TOPUPS AND MISSING sub_account_balances
-- ============================================================================

-- Step 1: Check for duplicate balance_ledger entries for user invest
SELECT 
  reference_id,
  COUNT(*) as duplicate_count,
  SUM(amount) as total_duplicated_amount
FROM balance_ledger
WHERE canonical_user_id = 'prize:pid:0x7b343a531688ac9ed7fbce4f16048970d1c7ba05'
  AND transaction_type = 'commerce_topup'
GROUP BY reference_id
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC;

-- Step 2: Remove duplicates (keep only the FIRST entry for each reference_id)
WITH duplicates AS (
  SELECT id,
    ROW_NUMBER() OVER (PARTITION BY reference_id ORDER BY created_at ASC) as rn
  FROM balance_ledger
  WHERE canonical_user_id = 'prize:pid:0x7b343a531688ac9ed7fbce4f16048970d1c7ba05'
    AND transaction_type = 'commerce_topup'
)
DELETE FROM balance_ledger
WHERE id IN (
  SELECT id FROM duplicates WHERE rn > 1
);

-- Step 3: Calculate correct balance from remaining ledger entries
WITH correct_balance AS (
  SELECT 
    canonical_user_id,
    SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as total_credits,
    SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) as total_debits,
    SUM(amount) as net_balance
  FROM balance_ledger
  WHERE canonical_user_id = 'prize:pid:0x7b343a531688ac9ed7fbce4f16048970d1c7ba05'
  GROUP BY canonical_user_id
)
SELECT * FROM correct_balance;

-- Step 4: Create or update sub_account_balances with correct amount
-- Step 4: Create or update sub_account_balances with correct amount
WITH correct_amount AS (
  SELECT COALESCE(SUM(amount), 0) as total
  FROM balance_ledger 
  WHERE canonical_user_id = 'prize:pid:0x7b343a531688ac9ed7fbce4f16048970d1c7ba05'
)
INSERT INTO sub_account_balances (
  canonical_user_id,
  canonical_user_id_norm,
  user_id,
  currency,
  available_balance,
  bonus_balance,
  pending_balance,
  last_updated,
  updated_at
)
SELECT
  'prize:pid:0x7b343a531688ac9ed7fbce4f16048970d1c7ba05',
  'prize:pid:0x7b343a531688ac9ed7fbce4f16048970d1c7ba05',
  'prize:pid:0x7b343a531688ac9ed7fbce4f16048970d1c7ba05',
  'USD',
  total,
  0,
  0,
  NOW(),
  NOW()
FROM correct_amount
ON CONFLICT (canonical_user_id, currency)
DO UPDATE SET
  available_balance = (SELECT COALESCE(SUM(amount), 0) FROM balance_ledger WHERE canonical_user_id = 'prize:pid:0x7b343a531688ac9ed7fbce4f16048970d1c7ba05'),
  last_updated = NOW(),
  updated_at = NOW();

-- Step 5: Verify final state
SELECT 
  canonical_user_id,
  available_balance,
  bonus_balance,
  pending_balance
FROM sub_account_balances
WHERE canonical_user_id = 'prize:pid:0x7b343a531688ac9ed7fbce4f16048970d1c7ba05';

-- Step 6: Check balance_ledger is clean (no more duplicates)
SELECT 
  reference_id,
  COUNT(*) as count
FROM balance_ledger
WHERE canonical_user_id = 'prize:pid:0x7b343a531688ac9ed7fbce4f16048970d1c7ba05'
GROUP BY reference_id
HAVING COUNT(*) > 1;
