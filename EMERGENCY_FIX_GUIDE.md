# EMERGENCY FIX GUIDE

## Critical Issues Fixed

### Issue 1: Orders Tab Error - ticket_numbers Column Missing ✅
**Error:** `column ut.ticket_numbers does not exist`
**Fix:** Removed `ticket_numbers` from get_user_transactions RPC SELECT

### Issue 2: Balance Reset to $501 ✅
**Problem:** sync_balance_discrepancies used wrong source of truth
**Fix:** Created `rollback_balance_from_ledger()` that uses balance_ledger

### Issue 3: Hardcoded $100 Top-Up ⚠️
**Status:** Need to check notifications table
**Likely:** Placeholder/test notification in database
**Fix:** See cleanup SQL below

---

## How to Apply Fixes

### Step 1: Deploy Migration
Run this in Supabase SQL Editor:

```sql
-- The migration is in: supabase/migrations/20260202100000_emergency_fix_rpc_and_balance.sql
-- Or paste the SQL directly here
```

### Step 2: Restore Correct Balances

**For your specific user:**
```sql
SELECT * FROM rollback_balance_from_ledger('YOUR_CANONICAL_USER_ID');
```

Replace `YOUR_CANONICAL_USER_ID` with your actual ID (starts with `prize:pid:0x...`)

**For all users:**
```sql
SELECT * FROM rollback_balance_from_ledger();
```

This will:
1. Get the last `balance_after` from `balance_ledger` (source of truth)
2. Update `canonical_users.usdc_balance` to match
3. Update `sub_account_balances.available_balance` to match
4. Return count of users fixed

### Step 3: Check Your Balance

```sql
SELECT 
  cu.canonical_user_id,
  cu.usdc_balance as canonical,
  sab.available_balance as sub_account,
  bl.balance_after as ledger_last,
  bl.created_at as ledger_last_updated
FROM canonical_users cu
LEFT JOIN sub_account_balances sab 
  ON cu.canonical_user_id = sab.canonical_user_id 
  AND sab.currency = 'USD'
LEFT JOIN LATERAL (
  SELECT balance_after, created_at
  FROM balance_ledger
  WHERE canonical_user_id = cu.canonical_user_id
    AND currency = 'USD'
  ORDER BY created_at DESC, id DESC
  LIMIT 1
) bl ON true
WHERE cu.canonical_user_id = 'YOUR_CANONICAL_USER_ID';
```

**Expected result:** All three balance columns should match

---

## Fix Hardcoded $100 Top-Up Messages

### Step 1: Check for placeholder notifications

```sql
-- Find all $100 top-up notifications
SELECT 
  id,
  user_id,
  title,
  message,
  amount,
  created_at
FROM user_notifications
WHERE type = 'topup'
  AND message LIKE '%100%'
ORDER BY created_at DESC;
```

### Step 2: Delete placeholder notifications

If you find test/placeholder notifications:

```sql
-- Delete specific placeholder notification
DELETE FROM user_notifications 
WHERE id = 'NOTIFICATION_ID_HERE';

-- Or delete all $100 top-up placeholders for a user
DELETE FROM user_notifications
WHERE type = 'topup'
  AND user_id = 'YOUR_USER_ID'
  AND message LIKE '%$100%'
  AND created_at < '2026-02-02'; -- Only old ones
```

### Step 3: Verify actual top-ups from transactions

```sql
-- Check actual top-up transactions
SELECT 
  id,
  user_id,
  canonical_user_id,
  amount,
  type,
  status,
  webhook_ref,
  created_at
FROM user_transactions
WHERE canonical_user_id = 'YOUR_CANONICAL_USER_ID'
  AND (
    competition_id IS NULL 
    OR webhook_ref LIKE 'TOPUP_%'
    OR type = 'topup'
    OR type = 'deposit'
  )
ORDER BY created_at DESC;
```

---

## Why This Happened

### Orders Tab Error:
- Migration added `ticket_numbers` to SELECT
- But column doesn't exist in production `user_transactions` table
- Column might exist in another table or be a future addition

### Balance Reset:
- `sync_balance_discrepancies()` used `sub_account_balances` as source
- But `sub_account_balances` was stale, missing recent purchases
- **balance_ledger** is the ACTUAL source of truth (transaction log)
- Should have used ledger to reconstruct balance

### Hardcoded $100:
- Likely a test/placeholder notification created during backfill
- Or a seed data issue
- Should be removed manually

---

## Verification

### After applying fixes, check:

**1. Orders tab loads without error:**
- Go to User Dashboard → Orders
- Should see transactions, no console errors

**2. Balance is correct:**
- Your balance should reflect all purchases
- Run the balance check SQL above
- All three columns should match

**3. Top-up history is accurate:**
- Check user_notifications table
- Should see actual top-up amounts, not $100
- Each top-up should match user_transactions records

---

## Emergency Rollback

If something goes wrong:

**Restore balance from a specific date:**
```sql
SELECT 
  canonical_user_id,
  balance_after as correct_balance
FROM balance_ledger
WHERE canonical_user_id = 'YOUR_ID'
  AND created_at < '2026-02-02 08:00:00' -- Before sync
  AND currency = 'USD'
ORDER BY created_at DESC
LIMIT 1;

-- Then manually update:
UPDATE canonical_users 
SET usdc_balance = <correct_balance>
WHERE canonical_user_id = 'YOUR_ID';

UPDATE sub_account_balances
SET available_balance = <correct_balance>
WHERE canonical_user_id = 'YOUR_ID' AND currency = 'USD';
```

---

## Files Changed

1. ✅ `supabase/migrations/20260202100000_emergency_fix_rpc_and_balance.sql`
   - Fixed get_user_transactions (removed ticket_numbers)
   - Added rollback_balance_from_ledger()
   - Updated sync_balance_discrepancies()

2. ✅ `EMERGENCY_FIX_GUIDE.md` (this file)
   - Step-by-step instructions
   - SQL queries to verify
   - Rollback procedure

---

## Next Steps

1. **Deploy the migration** (paste SQL in Supabase SQL Editor)
2. **Run:** `SELECT * FROM rollback_balance_from_ledger('YOUR_ID');`
3. **Verify balance** using the check SQL
4. **Clean up** placeholder notifications
5. **Test Orders tab** - should load without errors
6. **Report back** if issues persist
