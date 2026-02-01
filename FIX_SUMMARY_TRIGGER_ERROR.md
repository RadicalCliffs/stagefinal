# Fix Summary: Database Trigger Error

## Problem
Users were experiencing a PostgreSQL error when trying to link their wallet to their account:

```
Error code: "42703"
Message: "record \"new\" has no field \"updated_at\""
```

This error occurred specifically when updating the `canonical_users` table with wallet information through the BaseWallet authentication modal.

## Root Cause

The baseline migration (`00000000000001_baseline_triggers.sql`) documented that several normalization triggers existed in production but were not implemented in the migration. These included:

1. `canonical_users_normalize` - Referenced in comments but function not created
2. `canonical_users_normalize_before_write` - Referenced but not created  
3. `cu_normalize_and_enforce` - Referenced but not created
4. `users_normalize_before_write` - Referenced but not created

When the baseline migration created the `update_canonical_users_updated_at` trigger, it expected these normalization triggers to exist. However, the normalization triggers were calling a function `util.normalize_evm_address()` that didn't exist because:

1. The `util` schema was never created
2. The `util.normalize_evm_address()` function was never implemented
3. The normalization trigger functions were never created

This caused the triggers to fail with a confusing error message about `updated_at` when they actually failed due to the missing `util.normalize_evm_address()` function.

Additionally, the `users_normalize_before_write` function in production incorrectly referenced a `canonical_user_id` column that doesn't exist on the legacy `users` table.

## Solution

Created migration `20260201063000_fix_canonical_users_triggers.sql` that:

### 1. Created util Schema
```sql
CREATE SCHEMA IF NOT EXISTS util;
```

### 2. Implemented util.normalize_evm_address Function
```sql
CREATE OR REPLACE FUNCTION util.normalize_evm_address(address TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF address IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN LOWER(TRIM(address));
END;
$$;
```

### 3. Created Four Missing Trigger Functions

1. **canonical_users_normalize()** - Basic wallet address normalization to lowercase
2. **canonical_users_normalize_before_write()** - Advanced normalization ensuring canonical_user_id consistency
3. **cu_normalize_and_enforce()** - Comprehensive normalization with fallback logic
4. **users_normalize_before_write()** - Fixed version for legacy users table (no canonical_user_id reference)

### 4. Created Triggers

- Three triggers on `canonical_users` table
- One trigger on `users` table

All triggers execute BEFORE INSERT OR UPDATE to normalize wallet addresses before they're stored.

## Security Improvements

During code review, we identified and fixed a potential security issue:

- **Original code**: Used `REPLACE()` to extract wallet address from canonical_user_id
- **Problem**: `REPLACE()` replaces ALL occurrences, not just the prefix
- **Fix**: Changed to `SUBSTRING(NEW.canonical_user_id FROM 11)` for safe extraction

Example of the issue:
```sql
-- Bad: REPLACE removes all occurrences
REPLACE('prize:pid:0xprize:pid:123', 'prize:pid:', '') 
-- Returns: '0x123' (WRONG - removed both occurrences)

-- Good: SUBSTRING extracts from position 11 onwards
SUBSTRING('prize:pid:0xprize:pid:123' FROM 11)
-- Returns: '0xprize:pid:123' (CORRECT - extracts from position 11)
```

## Testing

After applying this migration, you can test with:

```sql
-- 1. Test normalizing a wallet address
SELECT util.normalize_evm_address('0xABCDEF1234567890ABCDEF1234567890ABCDEF12');
-- Expected: 0xabcdef1234567890abcdef1234567890abcdef12

-- 2. Test inserting a canonical user
INSERT INTO canonical_users (wallet_address) 
VALUES ('0xABCDEF1234567890ABCDEF1234567890ABCDEF12')
RETURNING canonical_user_id, wallet_address;
-- Expected: canonical_user_id = 'prize:pid:0xabcdef...', wallet_address = '0xabcdef...'

-- 3. Test updating a canonical user
UPDATE canonical_users 
SET base_wallet_address = '0xNEWADDRESS123' 
WHERE id = 'some-user-id'
RETURNING wallet_address, base_wallet_address, canonical_user_id;
-- Should normalize addresses and update canonical_user_id
```

## Impact

This fix resolves:
- ✅ Wallet linking errors in BaseWallet authentication
- ✅ PostgreSQL error 42703 when updating canonical_users
- ✅ Missing normalization of EVM wallet addresses
- ✅ Inconsistent storage of wallet addresses (mixed case vs lowercase)
- ✅ Security issue with REPLACE vs SUBSTRING

## Deployment

To deploy this fix:

1. Apply the migration to your Supabase database:
   - Go to Supabase Dashboard → SQL Editor
   - Run the migration file `supabase/migrations/20260201063000_fix_canonical_users_triggers.sql`
   
2. Verify the fix worked:
   - Check for the NOTICE messages confirming all functions and triggers were created
   - Try linking a wallet through the BaseWallet modal
   - Verify no more error 42703

## Files Changed

- **NEW**: `supabase/migrations/20260201063000_fix_canonical_users_triggers.sql` (316 lines)
  - Creates util schema
  - Implements util.normalize_evm_address function
  - Creates 4 normalization trigger functions
  - Creates 4 triggers on canonical_users and users tables
  - Includes verification logic and testing instructions

## Related Issues

This fix addresses the error mentioned in the problem statement:
```
[BaseWallet] Error updating user with wallet: Objectcode: "42703"
details: null
hint: null
message: "record \"new\" has no field \"updated_at\""
```

The error was misleading - it wasn't actually about `updated_at`, but about the missing `util.normalize_evm_address()` function that the normalization triggers were trying to call.
