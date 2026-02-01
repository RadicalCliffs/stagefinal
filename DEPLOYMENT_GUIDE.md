# Deployment Guide - Fix Database Trigger Error

## Quick Summary

**Problem:** PostgreSQL error 42703 "record 'new' has no field 'updated_at'" when linking wallets

**Solution:** Create missing trigger functions that call the existing `util.normalize_evm_address()` function

**File to Deploy:** `supabase/migrations/20260201063000_fix_canonical_users_triggers.sql`

## Pre-Deployment Checklist

- [x] Migration verified to NOT recreate existing objects
- [x] Migration uses existing util.normalize_evm_address() function (15 references)
- [x] Creates 4 new trigger functions
- [x] Creates 4 new triggers
- [x] Security fix applied (SUBSTRING instead of REPLACE)
- [x] 284 lines of SQL

## What This Migration Does

### Creates These Functions (NEW)
1. `canonical_users_normalize()` - Normalizes wallet addresses
2. `canonical_users_normalize_before_write()` - Ensures canonical_user_id consistency
3. `cu_normalize_and_enforce()` - Comprehensive normalization with fallback
4. `users_normalize_before_write()` - Normalizes legacy users table (fixed version)

### Creates These Triggers (NEW)
1. `trg_canonical_users_normalize` on canonical_users (BEFORE INSERT OR UPDATE)
2. `canonical_users_normalize_before_write` on canonical_users (BEFORE INSERT OR UPDATE)
3. `cu_normalize_and_enforce_trg` on canonical_users (BEFORE INSERT OR UPDATE)
4. `users_normalize_before_write` on users (BEFORE INSERT OR UPDATE)

### Uses These Existing Functions (NO CHANGES)
- ✅ `util.normalize_evm_address(addr text)` - Already exists, migration uses it
- ✅ `util` schema - Already exists, migration does not recreate it

## Deployment Steps

### Option 1: Supabase Dashboard (Recommended)

1. Open Supabase Dashboard
2. Navigate to: SQL Editor
3. Copy the entire contents of `supabase/migrations/20260201063000_fix_canonical_users_triggers.sql`
4. Paste into the SQL Editor
5. Click "Run"
6. Verify you see these NOTICE messages:
   ```
   CANONICAL_USERS TRIGGERS FIX - VERIFICATION
   Normalization trigger functions created: 4 / 4
   Normalization triggers created: 4 / 4
   Note: Uses existing util.normalize_evm_address() function
   Fix complete! Wallet linking should now work without errors.
   ```

### Option 2: Supabase CLI

```bash
# Apply the migration
supabase db push

# Or apply specific migration
supabase migration up --version 20260201063000
```

## Post-Deployment Verification

### 1. Check that triggers were created:

```sql
-- Should return 4 rows
SELECT t.tgname, c.relname 
FROM pg_trigger t 
JOIN pg_class c ON t.tgrelid = c.oid 
WHERE t.tgname IN (
  'trg_canonical_users_normalize',
  'canonical_users_normalize_before_write',
  'cu_normalize_and_enforce_trg',
  'users_normalize_before_write'
)
AND NOT t.tgisinternal;
```

Expected output: 4 triggers

### 2. Test wallet normalization:

```sql
-- Should return lowercase address
SELECT util.normalize_evm_address('0xABCDEF1234567890ABCDEF1234567890ABCDEF12');
-- Expected: 0xabcdef1234567890abcdef1234567890abcdef12
```

### 3. Test updating canonical_users:

```sql
-- This should NOT error anymore
UPDATE canonical_users 
SET wallet_address = '0xTEST123'
WHERE id = (SELECT id FROM canonical_users LIMIT 1)
RETURNING wallet_address, canonical_user_id;
-- Should normalize to: 0xtest123
```

### 4. Test wallet linking via UI:

1. Open BaseWallet authentication modal
2. Try to link a wallet
3. Verify NO error 42703
4. Verify wallet is linked successfully

## Rollback Plan

If you need to rollback (unlikely but good to know):

```sql
BEGIN;

-- Drop triggers
DROP TRIGGER IF EXISTS trg_canonical_users_normalize ON canonical_users;
DROP TRIGGER IF EXISTS canonical_users_normalize_before_write ON canonical_users;
DROP TRIGGER IF EXISTS cu_normalize_and_enforce_trg ON canonical_users;
DROP TRIGGER IF EXISTS users_normalize_before_write ON users;

-- Drop functions
DROP FUNCTION IF EXISTS canonical_users_normalize();
DROP FUNCTION IF EXISTS canonical_users_normalize_before_write();
DROP FUNCTION IF EXISTS cu_normalize_and_enforce();
DROP FUNCTION IF EXISTS users_normalize_before_write();

COMMIT;
```

## Expected Impact

### Before Migration
- ❌ Error 42703 when linking wallets
- ❌ Wallet linking fails
- ❌ Users cannot connect wallets

### After Migration
- ✅ No error when linking wallets
- ✅ Wallet addresses normalized to lowercase
- ✅ canonical_user_id automatically set
- ✅ Users can successfully link wallets

## Support

If you encounter issues:

1. Check Supabase logs for detailed error messages
2. Verify util.normalize_evm_address exists: `SELECT util.normalize_evm_address('0xTEST');`
3. Check trigger count: Should be at least 4 new triggers
4. Review migration output for any error messages

## Files in This Fix

- `supabase/migrations/20260201063000_fix_canonical_users_triggers.sql` - The migration
- `FIX_SUMMARY_TRIGGER_ERROR.md` - Detailed technical explanation
- `DEPLOYMENT_GUIDE.md` - This file

## Timeline

- Issue Reported: 2026-02-01 06:37 UTC
- Root Cause Identified: 2026-02-01 06:45 UTC
- Initial Fix Created: 2026-02-01 06:50 UTC
- Fix Corrected (util exists): 2026-02-01 06:58 UTC
- Final Verification: 2026-02-01 07:00 UTC
- Ready for Deployment: 2026-02-01 07:05 UTC
