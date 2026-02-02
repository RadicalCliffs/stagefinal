# Deployment Guide: Fix upsert_canonical_user Function Overload Issue

## Problem Summary

The `upsert_canonical_user` function has multiple overloaded signatures in the database, causing Postgrest schema cache errors:

```
ERROR: PGRST202 - Could not find the function public.upsert_canonical_user(...) in the schema cache
```

**Root Cause**: Migration `20260201164500` used `CREATE OR REPLACE FUNCTION` without first dropping existing function overloads, resulting in multiple function signatures coexisting.

**Impact**: Users cannot sign up or update their profiles through the UI.

## Solution

This PR adds migration `20260202044500_fix_upsert_canonical_user_overload.sql` which:
1. Explicitly drops ALL existing function overloads (12-parameter, 14-parameter, and legacy versions)
2. Recreates the function with the correct 14-parameter signature
3. Ensures only ONE function signature exists in the database

## Deployment Steps

### Prerequisites

Ensure you have:
- Supabase CLI installed (`npm install -g supabase`)
- Access to the Supabase project
- Database connection credentials

### Option 1: Automated Deployment via Supabase CLI (Recommended)

```bash
# 1. Navigate to project directory
cd /path/to/theprize.io

# 2. Ensure you're linked to the correct project
supabase link --project-ref YOUR_PROJECT_REF

# 3. Apply the migration
supabase db push

# 4. Verify the fix (optional)
supabase db reset  # only for local testing
```

### Option 2: Manual SQL Execution via Supabase Studio

1. Log in to [Supabase Studio](https://app.supabase.com)
2. Navigate to your project → SQL Editor
3. Copy the contents of `supabase/migrations/20260202044500_fix_upsert_canonical_user_overload.sql`
4. Paste into the SQL Editor
5. Click "Run" to execute
6. Verify no errors in the output

### Option 3: Direct Database Connection

```bash
# 1. Connect to your database
psql "postgresql://postgres:[YOUR-PASSWORD]@[YOUR-HOST]:5432/postgres"

# 2. Run the migration
\i supabase/migrations/20260202044500_fix_upsert_canonical_user_overload.sql

# 3. Verify
\df public.upsert_canonical_user
```

## Verification

After deployment, verify the fix:

### 1. Check Function Signature

Run this SQL query:

```sql
SELECT 
  p.proname,
  pg_catalog.pg_get_function_arguments(p.oid) AS arguments,
  pg_catalog.pg_get_function_result(p.oid) AS result_type,
  n.nspname AS schema
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE p.proname = 'upsert_canonical_user'
  AND n.nspname = 'public'
ORDER BY n.nspname, p.proname;
```

**Expected Result**: Exactly ONE row with 14 parameters:
- p_uid, p_canonical_user_id, p_email, p_username, p_wallet_address, p_base_wallet_address, p_eth_wallet_address, p_privy_user_id, p_first_name, p_last_name, p_telegram_handle, p_country, p_avatar_url, p_auth_provider, p_wallet_linked

### 2. Test RPC Call

Test the function via Supabase client:

```typescript
const { data, error } = await supabase.rpc('upsert_canonical_user', {
  p_uid: 'test-uid-' + Date.now(),
  p_canonical_user_id: 'prize:pid:temp123',
  p_email: 'test@example.com',
  p_username: 'testuser',
  p_first_name: 'Test',
  p_last_name: 'User',
  p_country: 'US',
});

console.log('Result:', data);
console.log('Error:', error);
```

**Expected**: `data` contains `{ id: '...', canonical_user_id: '...' }`, `error` is `null`

### 3. Test Frontend Signup Flow

1. Open the application in a browser
2. Click "Sign Up" or "Create Account"
3. Enter email, username, and other profile details
4. Submit the form
5. Verify no console errors
6. Verify user record is created in `canonical_users` table

## Rollback Plan

If issues occur, you can rollback by restoring the previous function signature:

```sql
-- Rollback to 12-parameter version (NOT RECOMMENDED - breaks frontend)
-- Only use if absolutely necessary
DROP FUNCTION IF EXISTS public.upsert_canonical_user(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) CASCADE;

-- Recreate with 12 parameters (from migration 20260128054900)
-- See: supabase/migrations/20260128054900_fix_upsert_canonical_user.sql
```

**Warning**: Rolling back will break the frontend calls that include `p_country`, `p_avatar_url`, or `p_auth_provider` parameters.

## Impact Assessment

### ✅ Fixes
- Resolves PGRST202 "function not found in schema cache" errors
- Eliminates function overload ambiguity
- Enables signup and profile update flows
- Ensures Postgrest schema cache consistency

### ✅ Compatibility
- Frontend code requires NO changes (already passing 8-14 parameters with defaults)
- All parameters have DEFAULT values, so partial calls work
- Existing user records remain intact
- No data migration required

### ⚠️ Considerations
- Migration drops and recreates the function (brief downtime during apply)
- Active transactions calling the function during migration may fail
- Recommend applying during low-traffic period
- Postgrest schema cache will auto-refresh after migration

## Troubleshooting

### Issue: "function does not exist" error after deployment

**Cause**: Postgrest schema cache hasn't refreshed

**Solution**: 
1. Wait 60 seconds for auto-refresh
2. Or manually restart Postgrest: `supabase functions restart`
3. Or reload schema cache via Studio: Settings → API → "Reload Schema Cache"

### Issue: Frontend still shows error after deployment

**Cause**: Browser cache or frontend build cache

**Solution**:
1. Hard refresh browser: Ctrl+Shift+R (Windows/Linux) or Cmd+Shift+R (Mac)
2. Clear browser cache
3. Redeploy frontend if using cached builds

### Issue: "permission denied" when applying migration

**Cause**: Insufficient database privileges

**Solution**: Ensure you're connected as `postgres` user or have SUPERUSER privileges

## Post-Deployment Monitoring

Monitor these metrics after deployment:

1. **Signup Success Rate**: Should increase to >95%
2. **Profile Update Errors**: Should decrease to near 0
3. **PGRST202 Errors in Logs**: Should stop appearing
4. **Database Function Call Latency**: Should remain <100ms

## Support

If issues persist after deployment:
1. Check Supabase logs: Dashboard → Logs → Postgres Logs
2. Verify function signature: Run verification query above
3. Check frontend network tab: Look for RPC call responses
4. Review migration status: 
   ```sql
   SELECT * FROM supabase_migrations.schema_migrations 
   WHERE version = '20260202044500' 
   ORDER BY version;
   ```

## References

- Original Issue: PR #261
- Related PR: #260 (first attempted fix)
- Migration File: `supabase/migrations/20260202044500_fix_upsert_canonical_user_overload.sql`
- Function Documentation: `docs/CANONICAL_USER_RPC_REFERENCE.md`
