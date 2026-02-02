# QUICK FIX - DO THIS NOW

## 🚨 Critical Issues Fixed

### 1. Orders Tab Error - "ticket_numbers does not exist" ✅
**Status:** FIXED in migration
**What to do:** Deploy the migration

### 2. Balance Reset to $501 ✅
**Status:** FIXED with new function
**What to do:** Run ONE command after migration

### 3. Hardcoded $100 Top-Up ⚠️
**Status:** Documented
**What to do:** Run cleanup SQL

---

## Step-by-Step Fix

### Step 1: Deploy Migration

Go to Supabase SQL Editor and paste/run:
```
supabase/migrations/20260202100000_emergency_fix_rpc_and_balance.sql
```

Or use CLI:
```bash
supabase db push
```

### Step 2: Restore Your Balance

In Supabase SQL Editor, run:
```sql
SELECT * FROM rollback_balance_from_ledger('YOUR_CANONICAL_USER_ID');
```

Replace `YOUR_CANONICAL_USER_ID` with your actual ID (starts with `prize:pid:0x...`)

**This will:**
- Get your correct balance from balance_ledger (transaction log)
- Update canonical_users.usdc_balance
- Update sub_account_balances.available_balance
- Return how many users were fixed

### Step 3: Verify Balance is Correct

```sql
SELECT 
  cu.usdc_balance as canonical,
  sab.available_balance as sub_account,
  bl.balance_after as ledger_last
FROM canonical_users cu
LEFT JOIN sub_account_balances sab ON cu.canonical_user_id = sab.canonical_user_id AND sab.currency = 'USD'
LEFT JOIN LATERAL (
  SELECT balance_after FROM balance_ledger
  WHERE canonical_user_id = cu.canonical_user_id AND currency = 'USD'
  ORDER BY created_at DESC LIMIT 1
) bl ON true
WHERE cu.canonical_user_id = 'YOUR_CANONICAL_USER_ID';
```

**All three should match!**

### Step 4: Clean Up $100 Top-Up Messages

```sql
-- Check for placeholder notifications
SELECT id, message, created_at 
FROM user_notifications
WHERE type = 'topup' 
  AND user_id = 'YOUR_USER_ID'
  AND message LIKE '%100%'
ORDER BY created_at DESC;

-- Delete if they're placeholders
DELETE FROM user_notifications 
WHERE id = 'ID_FROM_ABOVE';
```

---

## What Each Fix Does

### Migration Fixes:
1. **get_user_transactions** - Removed ticket_numbers column reference (doesn't exist)
2. **rollback_balance_from_ledger()** - Restores balance from transaction log
3. **sync_balance_discrepancies()** - Now calls rollback function (proper method)

### Why Balance Was Wrong:
- Old sync used sub_account_balances (stale, missing recent purchases)
- New sync uses balance_ledger (transaction log, always accurate)
- Your purchases ARE recorded, just needed to restore from log

### Why $100 Shows:
- Likely a test/placeholder notification
- Not related to actual top-ups
- Can be deleted safely

---

## Expected Results

After completing all steps:
- ✅ Orders tab loads without errors
- ✅ Balance shows correct amount (including recent purchases)
- ✅ Balance discrepancy error gone
- ✅ Top-up history accurate (no fake $100)

---

## If Something Goes Wrong

Check balance_ledger directly:
```sql
SELECT * FROM balance_ledger
WHERE canonical_user_id = 'YOUR_ID'
  AND currency = 'USD'
ORDER BY created_at DESC
LIMIT 10;
```

The LAST `balance_after` value is your correct balance.

If you need to set it manually:
```sql
UPDATE canonical_users SET usdc_balance = <correct_balance> WHERE canonical_user_id = 'YOUR_ID';
UPDATE sub_account_balances SET available_balance = <correct_balance> WHERE canonical_user_id = 'YOUR_ID' AND currency = 'USD';
```

---

## Full Documentation

See `EMERGENCY_FIX_GUIDE.md` for:
- Detailed explanations
- More verification queries
- Rollback procedures
- Troubleshooting

---

## Timeline

1. **Deploy migration** - 30 seconds
2. **Run rollback function** - 1 second
3. **Verify balance** - 10 seconds
4. **Clean notifications** - 1 minute

**Total: ~2 minutes**

Then refresh frontend and verify:
- Orders tab works
- Balance correct
- No errors
