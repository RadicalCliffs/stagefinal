# URGENT FIX: Frontend 404/400 Errors

## Problem

Your frontend is getting these errors:
- ❌ `POST /rpc/get_comprehensive_user_dashboard_entries` - **404 (Not Found)**
- ❌ `GET /tickets?select=...` - **404 (Not Found)**
- ❌ `GET /user_transactions?select=...` - **400 (Bad Request)**

Even though data exists in Supabase (tickets and competitions), the frontend can't access it.

## Root Cause

The RPC functions and Row Level Security (RLS) policies are not properly configured in your Supabase instance. Specifically:

1. **Missing RPC**: `get_comprehensive_user_dashboard_entries` doesn't exist (causing 404)
2. **Missing RLS policies**: Tables `tickets` and `user_transactions` block anonymous access (causing 404/400)
3. **Missing wrapper RPC**: `get_competition_entries` doesn't exist (only bypass version exists)

## Solution

Apply the fix script **IMMEDIATELY** to your Supabase instance.

### Step 1: Open Supabase SQL Editor

1. Go to your Supabase Dashboard: https://supabase.com/dashboard
2. Select your project: `mthwfldcjvpxjtmrqkqm`
3. Click on **SQL Editor** in the left sidebar
4. Click **New Query**

### Step 2: Apply the Fix

1. Open the file: `supabase/APPLY_THIS_FIX_NOW.sql`
2. Copy the **ENTIRE** contents of the file
3. Paste it into the SQL Editor
4. Click **Run** (or press Ctrl+Enter)

### Step 3: Verify the Fix

You should see output like this:

```
=====================================================
CRITICAL FIX APPLIED - VERIFICATION RESULTS
=====================================================
competitions.uid column exists: true
RPC Functions created: 3 (expected: 3)
tickets RLS enabled: true
user_transactions RLS enabled: true

Fixed functions:
  ✓ get_comprehensive_user_dashboard_entries (404 fix)
  ✓ get_competition_entries (wrapper)
  ✓ get_competition_entries_bypass_rls (uuid/text handling)

Fixed tables:
  ✓ tickets (RLS policies allow anon/authenticated read)
  ✓ user_transactions (RLS policies allow anon/authenticated read)

Issues fixed:
  ✓ POST /rpc/get_comprehensive_user_dashboard_entries - 404
  ✓ GET /tickets?select=... - 404
  ✓ GET /user_transactions?select=... - 400
=====================================================
Now refresh your frontend and the errors should be gone!
=====================================================
```

### Step 4: Test the Frontend

1. **Hard refresh** your frontend (Ctrl+Shift+R or Cmd+Shift+R)
2. Navigate to the **User Dashboard** page
3. Navigate to a **Competition page**
4. Check the browser console - the 404/400 errors should be **GONE**

## What This Fix Does

### 1. Creates Missing RPC Functions

- **`get_comprehensive_user_dashboard_entries(user_identifier TEXT)`**
  - Returns all entries for a user from multiple tables
  - Used by the User Dashboard "Entries" tab
  - Resolves user identity from `canonical_users` table
  - Combines data from: `joincompetition`, `tickets`, `user_transactions`, `pending_tickets`

- **`get_competition_entries(competition_identifier TEXT)`**
  - Returns all entries for a specific competition
  - Used by Competition detail pages
  - Wrapper for `get_competition_entries_bypass_rls`

- **`get_competition_entries_bypass_rls(competition_identifier TEXT)`**
  - Backend version with SECURITY DEFINER
  - Bypasses RLS to aggregate data

### 2. Fixes RLS Policies

- **Enables RLS** on `tickets` and `user_transactions` tables
- **Creates policies** to allow anonymous and authenticated read access
- **Preserves service_role** full access for admin operations

### 3. Ensures Schema Compatibility

- Adds `uid` column to `competitions` table if missing
- Creates indexes for performance
- Handles both UUID and text identifiers

## Why Did This Happen?

Supabase migrations were not applied correctly or were reset. The migration files exist in the repository but weren't executed in the Supabase instance.

## After Applying the Fix

✅ **User Dashboard** will show entries  
✅ **Competition pages** will display entries table  
✅ **Tickets** and **transactions** will be accessible  
✅ **No more 404/400 errors** in browser console  

## If You Still See Errors

1. Check the Supabase SQL Editor for error messages
2. Ensure you copied the **entire** script (including BEGIN and COMMIT)
3. Check if there are column mismatches in your tables (the script handles most cases)
4. Verify your Supabase project URL matches: `https://mthwfldcjvpxjtmrqkqm.supabase.co`

## Migration Management

To prevent this from happening again:

1. **Always test migrations** in a staging environment first
2. **Use Supabase CLI** to manage migrations: `supabase db push`
3. **Keep track** of which migrations have been applied
4. **Don't reset Supabase** without re-applying all migrations

## Questions?

If the fix doesn't work or you encounter new errors, check:
- Browser console for error details
- Supabase Dashboard > Logs for backend errors
- Network tab to see which requests are failing
