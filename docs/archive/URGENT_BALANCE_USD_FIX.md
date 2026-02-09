# 🚨 EMERGENCY: Fix balance_usd Column Error - BLOCKING ALL PURCHASES

## Critical Production Issue

**Error**: `"Failed to update balance: record \"new\" has no field \"balance_usd\""`

**Impact**: 
- ❌ Users CANNOT purchase tickets
- ❌ All balance payments failing with 500 error
- ❌ Revenue completely blocked

**Status**: CRITICAL - IMMEDIATE FIX REQUIRED

---

## Problem

The production database has a column or trigger that references `balance_usd` but the correct column name should be `usdc_balance`.

This is causing PostgreSQL trigger errors when users try to purchase tickets.

---

## Immediate Fix (Apply NOW - 5 minutes)

### Step 1: Run Diagnostic (2 minutes)

1. **Open Supabase Dashboard** → SQL Editor
2. **Copy** contents of: `supabase/DIAGNOSTIC_find_balance_usd_trigger.sql`
3. **Paste and Run**
4. **Review output** to see:
   - What triggers exist on canonical_users
   - What functions reference balance_usd
   - What balance columns exist

### Step 2: Apply HOTFIX (3 minutes)

1. **Open Supabase Dashboard** → SQL Editor
2. **Copy** contents of: `supabase/HOTFIX_balance_usd_column_error.sql`
3. **Paste and Run**
4. **Verify success messages**:
   ```
   ✅ canonical_users.usdc_balance column verified
   Fix applied successfully!
   Users should now be able to purchase tickets.
   ```

---

## What the HOTFIX Does

The HOTFIX script will:

1. **Scan** for all triggers on canonical_users table
2. **Find** any functions referencing balance_usd
3. **Drop** any problematic balance-sync functions
4. **Check** if column is wrongly named `balance_usd`
5. **Rename** column from `balance_usd` to `usdc_balance` (if needed)
6. **Verify** the fix worked

---

## Testing After Fix

### Test 1: Check Column Name
```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'canonical_users'
  AND column_name = 'usdc_balance';
```

**Expected**: 1 row showing usdc_balance column exists

### Test 2: Try a Purchase
- Go to any competition
- Add tickets to cart
- Try to purchase with balance
- **Expected**: Should work without 500 error

### Test 3: Check User Balance
```sql
SELECT canonical_user_id, usdc_balance
FROM canonical_users
WHERE usdc_balance > 0
LIMIT 5;
```

**Expected**: Should return users with balances (no error)

---

## Root Cause Analysis

### Scenario A: Column Name Mismatch
- Production database has column named `balance_usd`
- Our code/migrations reference `usdc_balance`
- **Fix**: Rename column to `usdc_balance`

### Scenario B: Trigger References Wrong Column
- Column is correctly named `usdc_balance`
- But a trigger function references `NEW.balance_usd`
- **Fix**: Drop/recreate trigger with correct column name

The HOTFIX handles both scenarios.

---

## Files in This Fix

1. **`WHERE_USDC_BALANCE_IS_CALLED.md`**
   - Complete reference of all usdc_balance usage
   - Shows all 100+ references across codebase

2. **`DIAGNOSTIC_find_balance_usd_trigger.sql`**
   - Diagnostic queries to identify the issue
   - Non-destructive, safe to run

3. **`HOTFIX_balance_usd_column_error.sql`**
   - Emergency fix script
   - Handles column rename if needed
   - Drops problematic triggers/functions

4. **`URGENT_BALANCE_USD_FIX.md`** (this file)
   - Deployment instructions
   - Testing procedures

---

## Verification Checklist

After applying the HOTFIX, verify:

- [ ] Diagnostic shows correct column name (usdc_balance)
- [ ] No functions reference balance_usd
- [ ] Test purchase works without 500 error
- [ ] User balance displays correctly
- [ ] No trigger errors in Supabase logs

---

## Rollback

If the HOTFIX causes issues (unlikely):

```sql
-- If we renamed the column and need to roll back
ALTER TABLE canonical_users 
  RENAME COLUMN usdc_balance TO balance_usd;
```

But this should NOT be needed - the fix is safe.

---

## Timeline

- **Apply HOTFIX**: NOW (5 minutes)
- **Test**: Immediately after (2 minutes)
- **Monitor**: Next 30 minutes for any issues
- **Full Migration**: Will deploy with next PR merge

---

## Support

If you encounter issues:

1. Check Supabase Dashboard → Logs → Postgres Logs
2. Look for errors mentioning canonical_users or balance
3. Share log output with development team

---

## Related Context

- Error occurred in `purchase-tickets-with-bonus` edge function
- User was trying to purchase 500 tickets
- Balance payment method
- Competition ID: `22786f37-66a1-4bf1-aa15-910ddf8d4eb4`
- User balance: $50,303.45 (sufficient funds)

The error is NOT a balance issue - it's a database schema issue.

---

**Last Updated**: 2026-02-07 12:10 UTC
**Priority**: P0 - CRITICAL
**Status**: HOTFIX READY - APPLY IMMEDIATELY
