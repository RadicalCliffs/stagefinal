# URGENT FIX: Login and Database Errors - Deployment Guide

## Problem Summary

This fix addresses critical issues preventing user login and causing database errors:

1. **Database Query Error**: Code was selecting `prize_description` from `winners` table, but this column doesn't exist in production
2. **User Creation Failure**: Database trigger was extracting temporary email-based IDs as wallet addresses, causing constraint violations

## Error Messages Fixed

- ✅ `column winners.prize_description does not exist` 
- ✅ `new row for relation "canonical_users" violates check constraint`
- ✅ User creation now works with temporary IDs before wallet connection
- ✅ Base wallet connections now properly link to pre-Base auth data

## Changes Made

### 1. Frontend Code Fix (`src/lib/database.ts`)

**What changed:** Removed `prize_description` from winners table query (line 383)

**Why:** The column doesn't exist in production database. Prize description is still available via the joined `competitions` table.

### 2. Database Migration (`supabase/migrations/20260201095000_fix_canonical_user_id_trigger.sql`)

**What changed:** Updated two trigger functions to validate EVM addresses before extraction:
- `canonical_users_normalize_before_write()`
- `cu_normalize_and_enforce()`

**Why:** Previously, triggers extracted ANY value after `prize:pid:` as a wallet address. When NewAuthModal created users with temporary IDs like `prize:pid:maxmatthews1_gmail_c_6346d13da6bf4311`, the trigger tried to use the email-based ID as a wallet address, causing validation failures.

**Fix:** Triggers now check if extracted value is a valid EVM address (starts with `0x` and is 42 characters) before setting it as `wallet_address`.

## Deployment Steps

### Step 1: Deploy Frontend Code (Automatic)

The frontend code change is already committed and will be deployed automatically via your CI/CD pipeline.

### Step 2: Deploy Database Migration (Manual - REQUIRED)

**CRITICAL:** You must run the database migration for login to work!

#### Option A: Via Supabase Studio (Recommended)

1. Open your Supabase project at https://supabase.com/dashboard
2. Navigate to SQL Editor
3. Click "New Query"
4. Copy the entire contents of `supabase/migrations/20260201095000_fix_canonical_user_id_trigger.sql`
5. Paste into the SQL Editor
6. Click "Run" or press Ctrl+Enter
7. Verify you see success messages in the output

#### Option B: Via Supabase CLI (If Available)

```bash
# Push the new migration to production
supabase db push --db-url "YOUR_PRODUCTION_DATABASE_URL"
```

### Step 3: Verify Deployment

After deploying both changes, test the following:

1. **Test Winner Cards Load:**
   - Navigate to your homepage
   - Verify no console errors about `prize_description`
   - Winner cards should display properly

2. **Test User Registration:**
   - Open NewAuthModal
   - Enter username, email, and complete OTP verification
   - Should create user successfully without constraint violations
   - Check browser console - should see "User record created successfully"

3. **Test Wallet Connection:**
   - Complete the Base wallet connection flow
   - Wallet should link to the user created in previous step
   - No duplicate user creation errors

4. **Test Returning User Login:**
   - Existing users should be able to connect their wallets
   - Wallet addresses should be properly saved to Supabase

## Verification Queries

Run these in Supabase SQL Editor to verify the fix:

```sql
-- 1. Verify trigger functions were updated
SELECT p.proname, pg_get_functiondef(p.oid)
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
AND p.proname IN ('canonical_users_normalize_before_write', 'cu_normalize_and_enforce');

-- 2. Test creating user with temporary ID (should succeed)
INSERT INTO canonical_users (uid, canonical_user_id, email, username, country)
VALUES (
  'test_email_abc123',
  'prize:pid:test_email_abc123',
  'test@example.com',
  'testuser',
  'US'
)
RETURNING id, canonical_user_id, wallet_address;
-- Expected: wallet_address should be NULL (not extracted from temp ID)

-- 3. Clean up test data
DELETE FROM canonical_users WHERE uid = 'test_email_abc123';
```

## Rollback Plan

If issues occur after deployment:

### Rollback Frontend:
Revert to previous commit in your deployment pipeline

### Rollback Database:
Restore previous trigger functions:

```sql
-- Run this SQL to restore the old behavior (NOT RECOMMENDED)
-- This will bring back the bugs, only use if absolutely necessary
-- Copy the old function definitions from:
-- supabase/migrations/20260201063000_fix_canonical_users_triggers.sql
```

## Testing Checklist

- [ ] Migration deployed successfully in Supabase
- [ ] Frontend deployed without build errors
- [ ] Winner cards display without database errors
- [ ] New user registration completes successfully
- [ ] OTP verification creates user record
- [ ] Base wallet connection works for new users
- [ ] Returning user login works
- [ ] No duplicate user creation errors
- [ ] Balance and bonus payments work
- [ ] No console errors in browser

## Support

If you encounter issues:

1. Check browser console for specific error messages
2. Check Supabase logs for database errors
3. Verify migration was applied successfully
4. Contact support with screenshots of any errors

## Files Changed

- `src/lib/database.ts` - Removed non-existent column from query
- `supabase/migrations/20260201095000_fix_canonical_user_id_trigger.sql` - New migration file

## Expected Impact

- ✅ Login flow works end-to-end
- ✅ No more database constraint violations
- ✅ Base wallets properly link to user data
- ✅ Winner cards display without errors
- ✅ Payments via balance and bonus work
- ✅ No more HTTP 400 errors from invalid queries
