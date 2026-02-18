# Lucky Dip Function Overload Fix - Deployment Guide

## Issue Summary

**Error:** HTTP 500 - "Could not choose the best candidate function between: public.allocate_lucky_dip_tickets_batch..."

**Root Cause:** Two overloaded versions of `allocate_lucky_dip_tickets_batch` exist in the database:
1. **Old 3-parameter version** (from baseline): `allocate_lucky_dip_tickets_batch(TEXT, TEXT, INTEGER)`
2. **New 7-parameter version** (from UUID fix): `allocate_lucky_dip_tickets_batch(TEXT, UUID, INTEGER, NUMERIC, INTEGER, TEXT, INTEGER[])`

When PostgreSQL receives a call to this function, it cannot determine which version to use, resulting in the error.

## Solution

Deploy migration `20260218101900_remove_duplicate_allocate_lucky_dip_tickets_batch.sql` which:
- Drops the old 3-parameter version
- Verifies the correct 7-parameter version exists
- Confirms only ONE version remains

## Prerequisites

The following migration MUST be applied first (should already be deployed):
- `20260207115000_fix_allocate_lucky_dip_tickets_batch_uuid_casting.sql` - Creates the correct 7-parameter version

## Deployment Steps

### Option 1: Using Supabase CLI (Recommended)

```bash
# Navigate to project directory
cd /path/to/theprize.io

# Link to Supabase project (if not already linked)
supabase link --project-ref YOUR_PROJECT_REF

# Push the migration
supabase db push
```

### Option 2: Using Supabase Dashboard SQL Editor

1. Open [Supabase Dashboard](https://app.supabase.com) → Your Project → SQL Editor
2. Open the migration file:
   ```
   supabase/migrations/20260218101900_remove_duplicate_allocate_lucky_dip_tickets_batch.sql
   ```
3. Copy the entire contents
4. Paste into SQL Editor
5. Click "Run"
6. Verify success messages:
   - `✓ Verified: 7-parameter allocate_lucky_dip_tickets_batch exists`
   - `✓ Verified: Exactly 1 allocate_lucky_dip_tickets_batch function exists`

### Option 3: Direct SQL Execution

If you have direct database access:

```bash
psql $DATABASE_URL -f supabase/migrations/20260218101900_remove_duplicate_allocate_lucky_dip_tickets_batch.sql
```

## Verification

After deployment, verify the fix with these SQL queries:

### 1. Check function count
```sql
SELECT COUNT(*) as function_count
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname = 'allocate_lucky_dip_tickets_batch';
```
**Expected Result:** `function_count = 1`

### 2. Check function signature
```sql
SELECT 
  p.proname as function_name,
  p.pronargs as parameter_count,
  pg_get_function_arguments(p.oid) as parameters,
  pg_get_function_result(p.oid) as return_type
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname = 'allocate_lucky_dip_tickets_batch';
```
**Expected Result:**
- `function_name`: allocate_lucky_dip_tickets_batch
- `parameter_count`: 7
- `parameters`: p_user_id text, p_competition_id uuid, p_count integer, p_ticket_price numeric DEFAULT 1, p_hold_minutes integer DEFAULT 15, p_session_id text DEFAULT NULL::text, p_excluded_tickets integer[] DEFAULT NULL::integer[]
- `return_type`: jsonb

### 3. Test function call (safe - read-only verification)
```sql
-- This will fail if the function doesn't exist or has the wrong signature
SELECT 
  proname,
  pronargs,
  proargnames
FROM pg_proc 
WHERE proname = 'allocate_lucky_dip_tickets_batch'
  AND pronargs = 7;
```
**Expected Result:** Should return exactly 1 row

## Testing the Fix

After deployment, test Lucky Dip reservation:

1. Navigate to a competition page on the frontend
2. Select "Lucky Dip" mode
3. Choose a ticket count (e.g., 5 tickets)
4. Click "Reserve Tickets"
5. Verify:
   - No HTTP 500 error
   - Tickets are successfully reserved
   - Reservation ID is returned
   - Frontend shows reserved tickets

## Rollback (If Needed)

If issues occur, you can restore the old 3-parameter function:

```sql
BEGIN;

-- Restore old 3-parameter function
CREATE OR REPLACE FUNCTION allocate_lucky_dip_tickets_batch(
  p_competition_id TEXT,
  p_user_id TEXT,
  p_ticket_count INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN allocate_lucky_dip_tickets(p_competition_id, p_user_id, p_ticket_count);
END;
$$;

COMMIT;
```

**Note:** This will bring back the overload error but may allow old code to work if the new function has issues.

## Related Files

- **Migration:** `supabase/migrations/20260218101900_remove_duplicate_allocate_lucky_dip_tickets_batch.sql`
- **Prerequisite:** `supabase/migrations/20260207115000_fix_allocate_lucky_dip_tickets_batch_uuid_casting.sql`
- **Baseline Function:** `supabase/migrations/00000000000002_baseline_rpc_functions.sql` (lines 661-675)
- **Edge Function:** `supabase/functions/lucky-dip-reserve/index.ts`
- **Frontend Usage:** `src/components/IndividualCompetition/IndividualCompetitionHeroSection.tsx`

## Additional Notes

### Why This Happened

1. The baseline migration created a simple 3-parameter wrapper function
2. Later, a UUID type migration created a new 7-parameter version with better functionality
3. Both functions coexisted, causing PostgreSQL overload resolution errors
4. The solution is to keep only the newer, better version

### Function Call Path

```
Frontend (IndividualCompetitionHeroSection.tsx)
  ↓ calls
Edge Function (lucky-dip-reserve)
  ↓ calls
RPC Function (allocate_lucky_dip_tickets_batch)
  ↓ executes
Database Operations (ticket allocation, reservation)
```

**Update (2026-02-18):** The edge function has been updated to correctly call `allocate_lucky_dip_tickets_batch` RPC. The previous code was attempting to call a non-existent `reserve_lucky_dip` RPC, which was causing 500 errors.

### Post-Deployment

After successful deployment:
1. Monitor error logs for any new issues
2. Test Lucky Dip reservations across different competitions
3. Verify no performance degradation
4. Check that reservations expire correctly after 15 minutes

## Support

If issues persist after deployment:
1. Check database logs for detailed error messages
2. Verify all migrations are applied in order
3. Ensure edge function is deployed with latest code
4. Check that `reserve_lucky_dip` function exists in database
