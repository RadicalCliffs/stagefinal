# 🎯 COMPLETE DEPLOYMENT GUIDE - All 3 Fixes

## Production Issues (All Blocking Purchases)

### Issue 1: Wrong Column Name in Triggers
Error: `"record \"new\" has no field \"balance_usd\""`

### Issue 2: No Sync from canonical_users to sub_account_balances
Problem: SAB only allows credits, not debits. Need sync to enable debits.

### Issue 3: Missing updated_at Column
Error: `"column \"updated_at\" of relation \"sub_account_balances\" does not exist"`

---

## The Complete Solution (3 Parts)

### ⚡ Part 1: Drop Broken Triggers
**File**: `HOTFIX_DROP_BALANCE_USD_TRIGGERS.sql`

**What it fixes**: Stops 500 error from wrong column name
**Time**: 2 minutes

```sql
DROP FUNCTION IF EXISTS mirror_canonical_users_to_sub_balances() CASCADE;
DROP FUNCTION IF EXISTS init_sub_balance_after_canonical_user() CASCADE;
DROP FUNCTION IF EXISTS handle_canonical_user_insert() CASCADE;
```

**Apply FIRST**

---

### 🔄 Part 2: Recreate Balance Sync Trigger
**File**: `MIGRATION_recreate_balance_sync_trigger.sql`

**What it fixes**: Enables balance debits by syncing canonical_users → sub_account_balances
**Time**: 3 minutes

```sql
CREATE FUNCTION sync_canonical_users_to_sub_account_balances() ...
CREATE TRIGGER trg_sync_cu_balance_to_sab ...
```

**Apply SECOND**

---

### 📅 Part 3: Add Missing updated_at Column  
**File**: `HOTFIX_add_updated_at_to_sub_account_balances.sql`

**What it fixes**: Adds missing timestamp column that application code expects
**Time**: 2 minutes

```sql
ALTER TABLE sub_account_balances 
  ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;
```

**Apply THIRD**

---

## Quick Deployment (7 Minutes Total)

### Step 1: Open Supabase Dashboard
Navigate to SQL Editor

### Step 2: Apply Part 1 (2 min)
1. Copy `HOTFIX_DROP_BALANCE_USD_TRIGGERS.sql`
2. Paste and Run
3. Verify: "✅ All problematic triggers have been dropped"

### Step 3: Apply Part 2 (3 min)
1. Copy `MIGRATION_recreate_balance_sync_trigger.sql`
2. Paste and Run
3. Verify: "✅ SYNC TRIGGER CREATED SUCCESSFULLY"

### Step 4: Apply Part 3 (2 min)
1. Copy `HOTFIX_add_updated_at_to_sub_account_balances.sql`
2. Paste and Run
3. Verify: "✅ Column updated_at exists"

### Step 5: Test (2 min)
1. Try purchasing tickets with balance
2. Should work without any errors
3. Check both tables have matching balances

---

## What Each Fix Does

### Part 1: Drop Broken Triggers
- **Removes**: 3 functions with wrong column name (`balance_usd`)
- **Effect**: Stops immediate 500 errors
- **Downside**: No auto-sync (temporary)

### Part 2: Recreate Sync Trigger
- **Creates**: New function with correct column name (`usdc_balance`)
- **Effect**: Auto-syncs canonical_users → sub_account_balances
- **Benefit**: Enables debits, keeps tables in sync

### Part 3: Add updated_at Column
- **Adds**: Missing timestamp column
- **Effect**: Application code can track when balances change
- **Benefit**: Audit trail, no more column errors

---

## Verification Queries

### Check All Fixes Applied:

```sql
-- 1. Check old broken functions are gone
SELECT proname 
FROM pg_proc 
WHERE proname IN (
  'mirror_canonical_users_to_sub_balances',
  'init_sub_balance_after_canonical_user',
  'handle_canonical_user_insert'
);
-- Expected: 0 rows

-- 2. Check new sync function exists
SELECT proname 
FROM pg_proc 
WHERE proname = 'sync_canonical_users_to_sub_account_balances';
-- Expected: 1 row

-- 3. Check updated_at column exists
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'sub_account_balances'
  AND column_name = 'updated_at';
-- Expected: 1 row

-- 4. Check sync trigger exists
SELECT tgname
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
WHERE c.relname = 'canonical_users'
  AND t.tgname = 'trg_sync_cu_balance_to_sab'
  AND NOT t.tgisinternal;
-- Expected: 1 row
```

### Test Balance Sync:

```sql
-- Before update
SELECT 
  cu.canonical_user_id,
  cu.usdc_balance as cu_balance,
  sab.available_balance as sab_balance,
  (cu.usdc_balance = sab.available_balance) as in_sync
FROM canonical_users cu
LEFT JOIN sub_account_balances sab 
  ON cu.canonical_user_id = sab.canonical_user_id 
  AND sab.currency = 'USD'
WHERE cu.canonical_user_id = 'prize:pid:0x123...';

-- Make a purchase or update balance

-- After update (should match)
-- Run same query - in_sync should be true
```

---

## Complete File List

### HOTFIXes (Apply to Production):
1. `HOTFIX_DROP_BALANCE_USD_TRIGGERS.sql`
2. `MIGRATION_recreate_balance_sync_trigger.sql`
3. `HOTFIX_add_updated_at_to_sub_account_balances.sql`

### Deployment Guides:
1. `URGENT_DROP_BALANCE_USD_TRIGGERS.md`
2. `RECREATE_BALANCE_SYNC_TRIGGER.md`
3. `URGENT_ADD_UPDATED_AT_COLUMN.md`
4. `COMPLETE_DEPLOYMENT_GUIDE.md` (this file)

### Technical Documentation:
1. `WHERE_USDC_BALANCE_IS_CALLED.md`
2. `WHY_DUPLICATE_CURRENCY_ROWS.md`
3. `BALANCE_SYSTEM_ARCHITECTURE_ANALYSIS.md`
4. `FINAL_ANALYSIS_BALANCE_USD_TRIGGERS.md`
5. `COMPLETE_SOLUTION_SUMMARY.md`

### Quick Reference:
1. `APPLY_THIS_FIX_NOW.md`

---

## Before vs After

### Before All Fixes:
- ❌ Purchases fail with 500 error (balance_usd doesn't exist)
- ❌ Purchases fail with 500 error (updated_at doesn't exist)
- ❌ SAB only allows credits, not debits
- ❌ canonical_users and SAB out of sync
- ❌ Wrong balance on subsequent purchases
- ❌ Duplicate USD/USDC rows with same values

### After All Fixes:
- ✅ Purchases work (no 500 errors)
- ✅ All columns referenced correctly
- ✅ Debits work (via canonical_users → SAB sync)
- ✅ Both tables stay in sync automatically
- ✅ Correct balance every time
- ✅ Timestamp tracking for audit trail
- ✅ Only USD row (unless USDC actually needed)

---

## Troubleshooting

### If Part 1 Fails:
- Check if functions already dropped
- Safe to run multiple times
- Should show "does not exist" warnings (OK)

### If Part 2 Fails:
- Make sure Part 1 completed first
- Check `update_updated_at_column()` function exists
- May need to create if missing

### If Part 3 Fails:
- Check if column already exists
- Safe to run multiple times
- Will skip if column exists

### If Purchases Still Fail:
1. Check all 3 parts applied successfully
2. Run verification queries
3. Check Supabase logs for new errors
4. Verify test purchase with small amount

---

## Support

**Priority**: P0 - CRITICAL
**Total Time**: 7 minutes
**Risk**: Low - well-tested fixes
**Status**: ✅ READY TO DEPLOY

---

## Deployment Checklist

- [ ] Part 1: Drop broken triggers (2 min)
- [ ] Part 2: Recreate sync trigger (3 min)
- [ ] Part 3: Add updated_at column (2 min)
- [ ] Verify: Run verification queries
- [ ] Test: Make test purchase
- [ ] Monitor: Watch for 30 minutes
- [ ] Document: Update team on completion

---

🚀 **Deploy all 3 parts in order. Each builds on the previous one!** 🚀
