# PROOF: Understanding the PostgreSQL Function Overload Issue

## The Facts

### Migration Timeline

1. **20260128054900_fix_upsert_canonical_user.sql**
   - Line 10: `CREATE OR REPLACE FUNCTION upsert_canonical_user(...)`
   - **12 parameters**: p_uid, p_canonical_user_id, p_email, p_username, p_wallet_address, p_base_wallet_address, p_eth_wallet_address, p_privy_user_id, p_first_name, p_last_name, p_telegram_handle, p_wallet_linked

2. **20260201164500_add_temp_user_placeholder_support.sql**
   - Line 198: `CREATE OR REPLACE FUNCTION upsert_canonical_user(...)`
   - **14 parameters**: Same as above PLUS p_country, p_avatar_url, p_auth_provider

3. **20260201170000_remove_util_upsert_canonical_user_collision.sql**
   - ONLY renames `util.upsert_canonical_user` to `util.upsert_canonical_user_from_auth`
   - Does NOT touch `public.upsert_canonical_user` at all

## The PostgreSQL Behavior

When you use `CREATE OR REPLACE FUNCTION`:
- If the signature is **EXACTLY the same**: Replaces the old function
- If the signature is **DIFFERENT** (different number or type of parameters): Creates a **NEW OVERLOAD**

### What Actually Happened

Because migration 20260201164500 used `CREATE OR REPLACE` with a DIFFERENT number of parameters (14 vs 12), PostgreSQL kept BOTH:

```
Database now has:
1. public.upsert_canonical_user(12 parameters) - from migration 20260128054900  
2. public.upsert_canonical_user(14 parameters) - from migration 20260201164500
```

### The Error

When the frontend calls:
```typescript
await supabase.rpc('upsert_canonical_user', {
  p_uid: tempUid,
  p_canonical_user_id: tempCanonicalUserId,
  p_email: profileData.email.toLowerCase(),
  p_username: profileData.username.toLowerCase(),
  p_first_name: profileData.firstName || null,
  p_last_name: profileData.lastName || null,
  p_telegram_handle: profileData.telegram || null,
  p_country: profileData.country || null,  // ← This parameter doesn't exist in 12-param version!
});
```

It passes 8 named parameters. PostgreSQL tries to match this to a function signature using DEFAULT values for missing parameters.

But PostgreSQL gets confused because:
- The 12-param version doesn't have `p_country`
- The 14-param version DOES have `p_country`
- Both functions exist in the database

PostgreSQL error: **"Could not find the function... in the schema cache"**

## Why Migration 20260201164500 Failed

It used `CREATE OR REPLACE FUNCTION` which:
1. ✅ Successfully created the 14-parameter version
2. ❌ Did NOT remove the 12-parameter version
3. ❌ Created function overload ambiguity

## The Correct Fix

Migration **20260202044500_fix_upsert_canonical_user_overload.sql** does:

1. **DROP** all existing versions explicitly:
   ```sql
   DROP FUNCTION IF EXISTS public.upsert_canonical_user(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) CASCADE;
   DROP FUNCTION IF EXISTS public.upsert_canonical_user(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) CASCADE;
   ```

2. **CREATE** (not REPLACE) the single correct 14-parameter version:
   ```sql
   CREATE FUNCTION public.upsert_canonical_user(
     p_uid TEXT,
     -- ... 14 parameters total
   )
   ```

This ensures:
- ✅ Only ONE function signature exists
- ✅ No ambiguity for PostgreSQL
- ✅ Frontend calls work correctly

## Proof of Understanding

You're absolutely right - migration 20260201170000 ONLY renamed the util function. It did NOT fix the public function issue.

The NEW migration 20260202044500 is necessary because:
1. Migration 20260201164500 created the problem (function overload)
2. Migration 20260201170000 fixed a DIFFERENT problem (util namespace collision)  
3. Migration 20260202044500 fixes the ACTUAL problem (removes overload, keeps only 14-param version)

## Summary

- **You were right**: Migration 20260201170000 only renamed util function
- **I was wrong**: I initially misunderstood what that migration did
- **The real issue**: `CREATE OR REPLACE` with different signatures creates overloads, not replacements
- **The fix**: Explicitly DROP all versions, then CREATE the correct one

This is why your authentication is broken - the database has multiple function signatures and PostgreSQL can't determine which to use.
