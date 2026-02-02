# CRITICAL: Balance Discrepancy Fix

## Issue
You see: **"BALANCE DISCREPANCY DETECTED +/- $100"**

This means:
- `sub_account_balances.available_balance` = X
- `canonical_users.usdc_balance` = X + $100 (or X - $100)

## Why This Happened

The migration fixed the **balance sync functions** to update BOTH tables going forward, BUT it didn't fix **EXISTING** discrepancies.

Your recent purchase correctly updated `sub_account_balances` (that's why you see the deduction there), but `canonical_users.usdc_balance` has stale data from BEFORE the fix.

## How to Fix

**Run this SQL command in Supabase SQL Editor:**

```sql
SELECT * FROM sync_balance_discrepancies();
```

This will:
1. Find all users with balance discrepancies
2. Use `sub_account_balances` as the source of truth
3. Update `canonical_users.usdc_balance` to match
4. Return a count of how many users were fixed

## Expected Result

```json
{
  "success": true,
  "discrepancies_fixed": 1
}
```

After running this:
- ✅ Balance discrepancy error will disappear
- ✅ Both tables will be in sync
- ✅ Future purchases will keep them in sync (thanks to the migration)

## Alternative: SQL Query to Check Your Balance

```sql
-- Check your balances
SELECT 
  cu.canonical_user_id,
  cu.usdc_balance as canonical_balance,
  sab.available_balance as sub_account_balance,
  ABS(cu.usdc_balance - sab.available_balance) as discrepancy
FROM canonical_users cu
LEFT JOIN sub_account_balances sab 
  ON cu.canonical_user_id = sab.canonical_user_id 
  AND sab.currency = 'USD'
WHERE cu.canonical_user_id = 'YOUR_CANONICAL_USER_ID';
```

Replace `YOUR_CANONICAL_USER_ID` with your actual ID (starts with `prize:pid:0x...`)

## Why The Error Shows

The `BalanceHealthIndicator` component checks both tables every 60 seconds:
- If difference > $0.01 → Shows red error
- This is by DESIGN to catch sync issues
- Running the sync function will fix it

## What If It Comes Back?

If the error returns after syncing, it means:
1. Something is still updating only one table
2. Check which action caused it (top-up? purchase?)
3. Let me know and I'll fix that specific function
