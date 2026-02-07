# 🚨 EMERGENCY: Add Missing updated_at Column to sub_account_balances

## The Error

```
"Failed to update balance: column \"updated_at\" of relation \"sub_account_balances\" does not exist"
```

**Status**: BLOCKING ALL PURCHASES

## The Problem

### What's Wrong:
1. Schema migration defines `updated_at` column ✅
2. Application code references `updated_at` column ✅
3. But production database DOESN'T have the column ❌

### Where It's Used:
The edge function `purchase-tickets-with-bonus` tries to update `updated_at` in multiple places:
- Line 1247: Direct sub_account_balances update
- Line 1282: Sync from wallet_balances
- Line 1299: Another sync operation
- Line 1324: Upsert operation
- Line 1420: Final update

### Why This Happened:
- Initial migration created the table with updated_at
- But production database was created before migration
- Or migration was never applied
- Column definition got skipped

## The Fix

**File**: `HOTFIX_add_updated_at_to_sub_account_balances.sql`

### What It Does:
1. Checks if `updated_at` column exists
2. If missing, adds it: `ALTER TABLE sub_account_balances ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL`
3. Creates trigger to auto-update the timestamp
4. Verifies the fix worked

### SQL to Run:
```sql
-- Check if column exists and add if missing
ALTER TABLE sub_account_balances 
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

-- Create trigger to auto-update
CREATE TRIGGER update_sub_account_balances_updated_at
  BEFORE UPDATE ON sub_account_balances
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

## Apply the Fix NOW

### Step 1: Open Supabase Dashboard
Navigate to SQL Editor

### Step 2: Run the HOTFIX
Copy and paste: `HOTFIX_add_updated_at_to_sub_account_balances.sql`

### Step 3: Verify
Look for:
```
✅ Column updated_at exists
✅ Trigger update_sub_account_balances_updated_at exists
Purchases should now work without updated_at error!
```

### Time: 2 minutes

## After Fix

### Test Purchase:
1. Try purchasing tickets with balance
2. Should work without 500 error
3. Check updated_at is set on the record

### Verify Column Exists:
```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'sub_account_balances'
  AND column_name = 'updated_at';
```

Expected: 1 row showing column definition

### Test Update:
```sql
-- Update a balance and check updated_at changes
UPDATE sub_account_balances
SET available_balance = available_balance + 0.01
WHERE canonical_user_id = 'prize:pid:0x123...'
  AND currency = 'USD'
RETURNING id, available_balance, updated_at;
```

Expected: updated_at should show current timestamp

## What Gets Fixed

### Before Fix:
- ❌ Purchases fail with 500 error
- ❌ Column updated_at doesn't exist
- ❌ Application code can't update timestamps
- ❌ No audit trail of when balances changed

### After Fix:
- ✅ Purchases work
- ✅ Column updated_at exists
- ✅ Application code can update timestamps
- ✅ Audit trail of balance changes

## Related Fixes

This is in addition to previous fixes:
1. **Balance sync trigger** - Syncs canonical_users → sub_account_balances
2. **Drop broken triggers** - Removed balance_usd references
3. **Add updated_at column** - This fix (NEW)

All three fixes need to be applied for complete functionality.

---

**Priority**: P0 - CRITICAL
**Time**: 2 minutes
**Risk**: Low (just adds missing column)
**Status**: READY TO DEPLOY NOW
