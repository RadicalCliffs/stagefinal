# Deployment Guide: upsert_canonical_user Signature Fix

## Overview

This PR fixes a critical database function ambiguity issue that broke signup on staging. The fix ensures type safety and prevents schema collision.

## Changes Summary

### 1. Database Migration Fix
**File:** `supabase/migrations/20260201164500_add_temp_user_placeholder_support.sql`

**Change:** Line 214 - Parameter type correction
```sql
-- Before (INCORRECT):
p_wallet_linked TEXT DEFAULT NULL

-- After (CORRECT):
p_wallet_linked BOOLEAN DEFAULT FALSE
```

**Why:** Matches frontend calls and earlier migration signature.

### 2. Schema Collision Prevention
**File:** `supabase/migrations/20260201170000_remove_util_upsert_canonical_user_collision.sql` (NEW)

**Purpose:** Idempotently renames `util.upsert_canonical_user` to `util.upsert_canonical_user_from_auth`

**Safety:**
- Only acts if util schema exists
- Only acts if function exists
- Won't fail if already applied
- Exception handling prevents migration failure

### 3. Test Improvements
**File:** `supabase/migrations/test_temp_user_placeholder.sql`

**Changes:**
- Line 121: Fixed to use boolean `true` instead of string `'true'`
- Added TEST 6: Explicit boolean parameter validation with both `true` and `false`

### 4. Documentation
**Files Added:**
- `docs/CANONICAL_USER_RPC_REFERENCE.md` - Complete function reference
  
**Files Updated:**
- `supabase/migrations/README.md` - Added canonical user migrations section

## Deployment Steps

### For Fresh Environments (Development/Local)
```bash
# Standard migration apply
supabase db reset
# OR
supabase db push
```

### For Existing Environments (Staging/Production)

#### Option A: Via Supabase Studio (Recommended)
1. Navigate to SQL Editor in Supabase Studio
2. Apply migrations in order:
   ```
   20260201164500_add_temp_user_placeholder_support.sql
   20260201170000_remove_util_upsert_canonical_user_collision.sql
   ```
3. Execute each migration
4. Verify no errors in output

#### Option B: Via Supabase CLI
```bash
# If using CLI with connected project
supabase db push
```

### Verification

After deployment, verify the fix:

1. **Check function signature:**
```sql
SELECT 
  p.proname,
  pg_catalog.pg_get_function_arguments(p.oid) AS arguments,
  n.nspname AS schema
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE p.proname LIKE '%upsert_canonical_user%'
ORDER BY n.nspname, p.proname;
```

Expected result:
- `public.upsert_canonical_user` with `p_wallet_linked boolean DEFAULT false`
- `util.upsert_canonical_user_from_auth` (if util function existed)

2. **Run test suite:**
```bash
# If psql available with connection
psql -f supabase/migrations/test_temp_user_placeholder.sql
```

Expected: All 6 tests pass with "PASSED" messages

3. **Test signup flow:**
- Email-first signup should work
- Wallet connection should work
- No "function name is not unique" errors

## Rollback Plan

If issues occur after deployment:

### Rollback Migration
```sql
-- Restore util function name (if it was renamed)
ALTER FUNCTION util.upsert_canonical_user_from_auth(text, text, text, text)
  RENAME TO upsert_canonical_user;

-- Revert parameter type (not recommended - breaks frontend)
-- CREATE OR REPLACE FUNCTION public.upsert_canonical_user(...
--   p_wallet_linked TEXT DEFAULT NULL
-- )
```

**Note:** Reverting parameter type will break frontend calls. Only do this if absolutely necessary and coordinate with frontend deployment.

## Impact Assessment

### ✅ Fixes
- Resolves staging "ERROR: 42725: function name is not unique"
- Fixes type mismatch between database (TEXT) and frontend (boolean)
- Prevents search_path ambiguity

### ✅ Compatibility
- All existing frontend code works unchanged (already uses boolean)
- Database defaults to FALSE if parameter omitted
- Idempotent migrations safe for all environments

### ✅ Testing
- 6 comprehensive tests including boolean type validation
- All frontend call sites verified
- Code review passed with no comments
- No security vulnerabilities detected

## Frontend Compatibility

All frontend locations verified to use boolean values:

| File | Line | Value |
|------|------|-------|
| `src/contexts/AuthContext.tsx` | 460 | `false` |
| `src/components/BaseWalletAuthModal.tsx` | 303 | `true` |
| `src/components/BaseWalletAuthModal.tsx` | 369 | `true` |
| `src/components/BaseWalletAuthModal.tsx` | 585 | `true` |

No frontend changes required.

## Post-Deployment Monitoring

Monitor for:
1. **Signup errors** - Check Supabase logs for function call failures
2. **Type errors** - Look for "invalid input syntax for type boolean"
3. **Function ambiguity** - Search logs for "function name is not unique"

## Support

If issues arise:
1. Check Supabase logs: Dashboard → Logs → Postgres Logs
2. Verify function signature: Use verification query above
3. Check frontend network tab: Look for RPC call responses
4. Review migration status: `SELECT * FROM supabase_migrations.schema_migrations ORDER BY version;`

## References

- **Problem Statement:** Original issue in problem_statement section
- **Function Reference:** `docs/CANONICAL_USER_RPC_REFERENCE.md`
- **Migration Guide:** `supabase/migrations/README.md`
- **Test Suite:** `supabase/migrations/test_temp_user_placeholder.sql`
