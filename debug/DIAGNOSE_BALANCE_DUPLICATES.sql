-- DIAGNOSE BALANCE ISSUES
-- Run in Supabase SQL Editor

-- Check for duplicate sub_account_balances records (multiple currencies per user)
SELECT 
  user_id,
  canonical_user_id,
  currency,
  available_balance,
  pending_balance,
  updated_at,
  COUNT(*) OVER (PARTITION BY COALESCE(canonical_user_id, user_id)) as record_count
FROM sub_account_balances
WHERE COALESCE(canonical_user_id, user_id) IN (
  SELECT COALESCE(canonical_user_id, user_id)
  FROM sub_account_balances
  GROUP BY COALESCE(canonical_user_id, user_id)
  HAVING COUNT(*) > 1
)
ORDER BY canonical_user_id, currency;

-- Check for records with both USD and USDC currencies for same user
SELECT 
  COALESCE(canonical_user_id, user_id) as user_key,
  array_agg(currency) as currencies,
  array_agg(available_balance) as balances,
  COUNT(*) as num_records
FROM sub_account_balances
GROUP BY COALESCE(canonical_user_id, user_id)
HAVING COUNT(*) > 1;

-- Check your specific user (replace with your canonical_user_id)
SELECT * FROM sub_account_balances 
WHERE canonical_user_id ILIKE '%YOUR_WALLET_ADDRESS%'
   OR user_id ILIKE '%YOUR_WALLET_ADDRESS%';

-- FIX: Consolidate USDC records into USD and delete duplicates
-- This keeps only USD currency records

-- Step 1: First, update any USDC records to USD where USD doesn't exist yet
-- UPDATE sub_account_balances
-- SET currency = 'USD'
-- WHERE currency = 'USDC'
-- AND NOT EXISTS (
--   SELECT 1 FROM sub_account_balances sab2 
--   WHERE sab2.currency = 'USD' 
--   AND COALESCE(sab2.canonical_user_id, sab2.user_id) = COALESCE(sub_account_balances.canonical_user_id, sub_account_balances.user_id)
-- );

-- Step 2: For users with BOTH USD and USDC, merge the balances into USD record
-- UPDATE sub_account_balances usd
-- SET available_balance = COALESCE(usd.available_balance, 0) + COALESCE(usdc.available_balance, 0),
--     pending_balance = COALESCE(usd.pending_balance, 0) + COALESCE(usdc.pending_balance, 0)
-- FROM sub_account_balances usdc
-- WHERE usd.currency = 'USD'
-- AND usdc.currency = 'USDC'
-- AND COALESCE(usd.canonical_user_id, usd.user_id) = COALESCE(usdc.canonical_user_id, usdc.user_id);

-- Step 3: Delete the USDC duplicate records
-- DELETE FROM sub_account_balances
-- WHERE currency = 'USDC'
-- AND EXISTS (
--   SELECT 1 FROM sub_account_balances sab2 
--   WHERE sab2.currency = 'USD' 
--   AND COALESCE(sab2.canonical_user_id, sab2.user_id) = COALESCE(sub_account_balances.canonical_user_id, sub_account_balances.user_id)
-- );
