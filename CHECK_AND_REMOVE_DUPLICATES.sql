-- Check for duplicate ledger entries for invest's transactions
SELECT 
  id,
  canonical_user_id,
  amount,
  transaction_type,
  reference_id,
  created_at,
  LEAD(created_at) OVER (PARTITION BY reference_id ORDER BY created_at) - created_at as time_diff
FROM balance_ledger
WHERE canonical_user_id = 'prize:pid:0x7b343a531688ac9ed7fbce4f16048970d1c7ba05'
  AND reference_id IN (
    'acf7261a-1175-42ef-8a86-efcbe0c656bf',
    'eb94dae4-d3a6-4736-bb52-f97f36e66ec4'
  )
ORDER BY reference_id, created_at;

-- Delete duplicate ledger entries (keep only the earliest entry for each reference_id)
WITH duplicates AS (
  SELECT id,
    ROW_NUMBER() OVER (PARTITION BY reference_id ORDER BY created_at ASC) as rn
  FROM balance_ledger
  WHERE canonical_user_id = 'prize:pid:0x7b343a531688ac9ed7fbce4f16048970d1c7ba05'
    AND reference_id IN (
      'acf7261a-1175-42ef-8a86-efcbe0c656bf',
      'eb94dae4-d3a6-4736-bb52-f97f36e66ec4'
    )
)
DELETE FROM balance_ledger
WHERE id IN (
  SELECT id FROM duplicates WHERE rn > 1
);

-- Recalculate user's balance
SELECT 
  canonical_user_id,
  available_balance
FROM sub_account_balances
WHERE canonical_user_id = 'prize:pid:0x7b343a531688ac9ed7fbce4f16048970d1c7ba05';
