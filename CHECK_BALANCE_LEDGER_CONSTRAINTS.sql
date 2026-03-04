-- ============================================================================
-- CHECK BALANCE_LEDGER CONSTRAINTS
-- ============================================================================

-- Check all constraints on balance_ledger
SELECT 
  conname as constraint_name,
  contype as constraint_type,
  pg_get_constraintdef(oid) as definition
FROM pg_constraint
WHERE conrelid = 'balance_ledger'::regclass;

-- Check if canonical_user_id exists in canonical_users for the stuck topup users
SELECT 
  ut.canonical_user_id,
  CASE 
    WHEN cu.canonical_user_id IS NOT NULL THEN '✅ EXISTS'
    ELSE '❌ MISSING'
  END as user_exists
FROM user_transactions ut
LEFT JOIN canonical_users cu ON ut.canonical_user_id = cu.canonical_user_id
WHERE ut.type = 'topup'
  AND (ut.status IN ('completed', 'finished', 'confirmed') 
       OR ut.payment_status IN ('completed', 'finished', 'confirmed'))
  AND (ut.posted_to_balance IS NULL OR ut.posted_to_balance = false)
GROUP BY ut.canonical_user_id, cu.canonical_user_id
ORDER BY user_exists;
