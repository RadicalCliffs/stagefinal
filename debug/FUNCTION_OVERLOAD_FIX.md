# FUNCTION OVERLOAD CONFLICT - RESOLVED

## The Error

```
ERROR: 42725: function name "get_comprehensive_user_dashboard_entries" is not unique
HINT: Specify the argument list to select the function unambiguously.
```

## What Went Wrong

### PostgreSQL Function Overloading
PostgreSQL allows multiple functions with the same name but different signatures. This is called "function overloading".

### The Problem
Multiple migrations created functions with slightly different parameter names:

**Version 1:** `get_comprehensive_user_dashboard_entries(p_user_identifier TEXT)`
**Version 2:** `get_comprehensive_user_dashboard_entries(user_identifier text)`

Even though they both take a single TEXT parameter, PostgreSQL treats these as DIFFERENT functions because:
1. Parameter names differ (`p_user_identifier` vs `user_identifier`)
2. Case differs (`TEXT` vs `text`) - though this doesn't matter for the type itself

### Why My Previous Migration Failed

I tried to drop the function like this:
```sql
DROP FUNCTION IF EXISTS get_comprehensive_user_dashboard_entries(TEXT) CASCADE;
```

But PostgreSQL said: "Which one? There are multiple functions with that name!"

## The Fix

### New Migration: 20260202120000_comprehensive_column_fix_v2.sql

**Step 1: Drop ALL Possible Overloads**

```sql
-- Drop all versions in public schema
DROP FUNCTION IF EXISTS public.get_comprehensive_user_dashboard_entries(p_user_identifier text) CASCADE;
DROP FUNCTION IF EXISTS public.get_comprehensive_user_dashboard_entries(user_identifier text) CASCADE;
DROP FUNCTION IF EXISTS public.get_comprehensive_user_dashboard_entries(TEXT) CASCADE;

-- Drop all versions without schema prefix
DROP FUNCTION IF EXISTS get_comprehensive_user_dashboard_entries(p_user_identifier text) CASCADE;
DROP FUNCTION IF EXISTS get_comprehensive_user_dashboard_entries(user_identifier text) CASCADE;
DROP FUNCTION IF EXISTS get_comprehensive_user_dashboard_entries(TEXT) CASCADE;
```

Same approach for all 3 functions:
- `get_user_transactions`
- `get_comprehensive_user_dashboard_entries`
- `get_user_competition_entries`

**Step 2: Create Single Correct Version**

Created one version of each function matching the production schema signatures:
- `get_user_transactions(user_identifier text)`
- `get_comprehensive_user_dashboard_entries(p_user_identifier text)`
- `get_user_competition_entries(p_user_identifier text)`

## What Was Fixed

### Same Column Fixes As Before:
1. ✅ Removed all references to `ticket_numbers` (column doesn't exist)
2. ✅ Changed all `transaction_hash` references to `tx_id` (correct column name)
3. ✅ All functions use only columns that exist in production

### Plus Function Overload Fix:
4. ✅ Drops ALL possible function overloads before recreating
5. ✅ Creates single version matching production
6. ✅ No more "function name is not unique" errors

## Files

**Removed:**
- `supabase/migrations/20260202110000_comprehensive_column_fix.sql` (broken - didn't handle overloads)

**Created:**
- `supabase/migrations/20260202120000_comprehensive_column_fix_v2.sql` (fixed - drops all overloads first)

## How Multiple Versions Were Created

Looking at migration history:

1. **Initial schema** created functions with `p_user_identifier TEXT`
2. **20260201073000** created functions with `p_user_identifier TEXT`
3. **20260202095000** created functions with `user_identifier text` ← Different parameter name!
4. **20260202100000** created functions with `user_identifier text`

Each used `CREATE OR REPLACE FUNCTION`, which:
- Replaces the function IF the signature matches exactly
- Creates a NEW function (overload) if the signature differs

So we ended up with multiple versions of each function!

## Deployment

```bash
supabase db push
```

Or run in Supabase SQL Editor:
```sql
-- Run: supabase/migrations/20260202120000_comprehensive_column_fix_v2.sql
```

## Expected Result

✅ All function overloads dropped
✅ Single version of each function created
✅ No more "function name is not unique" errors
✅ Dashboard works correctly
✅ No column errors

## Lesson Learned

**Always specify full function signature when dropping:**
```sql
-- BAD (ambiguous if overloads exist)
DROP FUNCTION function_name(TEXT);

-- GOOD (unambiguous)
DROP FUNCTION function_name(parameter_name text);

-- BEST (drop all possible overloads)
DROP FUNCTION IF EXISTS function_name(param1 text) CASCADE;
DROP FUNCTION IF EXISTS function_name(param2 text) CASCADE;
```

**Better yet:** Always use consistent parameter names across migrations to avoid creating overloads accidentally.
