# Fix for Lucky Dip Reserve UUID Casting Error

## Problem

The lucky-dip-reserve edge function was failing with the following error:

```
Error: "Failed to allocate tickets: function public.parse_uuid(uuid) does not exist"
HTTP Status: 500 (Internal Server Error)
```

This occurred when users tried to reserve tickets using the Lucky Dip feature on competition pages.

## Root Cause

The actual error is NOT about `parse_uuid` not existing - that's a misleading error message from PostgreSQL. The real issue is **UUID to TEXT type mismatch** in the `allocate_lucky_dip_tickets_batch` function.

The function accepts `p_competition_id UUID` but was directly comparing it to TEXT columns without proper type casting:

**Problem locations in `allocate_lucky_dip_tickets_batch`:**
- Line 303: `WHERE competition_id = p_competition_id` (tickets table, competition_id is TEXT)
- Line 312: `WHERE competition_id = p_competition_id` (pending_tickets table, competition_id is TEXT)
- Line 363: `AND competition_id = p_competition_id` (pending_tickets table, competition_id is TEXT)
- Line 388: INSERT using `p_competition_id` directly (should be TEXT)

**Database schema:**
```sql
-- All these columns are TEXT, not UUID
tickets.competition_id         -> TEXT
pending_tickets.competition_id -> TEXT
competitions.id                -> UUID (stored as TEXT via gen_random_uuid()::text)
```

The function signature uses UUID but all table columns use TEXT, causing PostgreSQL to fail when comparing them directly.

## Solution

Created migration `20260207115000_fix_allocate_lucky_dip_tickets_batch_uuid_casting.sql` that:

1. **Adds explicit UUID to TEXT conversion** at the start of the function:
   ```sql
   v_competition_id_text := p_competition_id::TEXT;
   ```

2. **Updates all comparisons** to use the TEXT version:
   ```sql
   -- Before (BROKEN):
   WHERE competition_id = p_competition_id  -- TEXT = UUID ❌
   
   -- After (FIXED):
   WHERE competition_id = v_competition_id_text  -- TEXT = TEXT ✅
   ```

3. **Updates INSERT statement** to use TEXT version for competition_id

## Files Changed

1. **Migration**: `supabase/migrations/20260207115000_fix_allocate_lucky_dip_tickets_batch_uuid_casting.sql`
   - Production migration file

2. **HOTFIX**: `supabase/HOTFIX_allocate_lucky_dip_tickets_batch_uuid_casting.sql`
   - Can be applied manually via Supabase SQL Editor for immediate fix

3. **Documentation**: `HOTFIX_ALLOCATE_LUCKY_DIP_TICKETS_BATCH_UUID_CASTING.md`
   - This file

## How to Apply

### Option 1: Automatic (via Supabase migrations)
The migration will be applied automatically when the PR is merged and deployed.

### Option 2: Manual (via Supabase Dashboard) - IMMEDIATE
1. Open [Supabase Dashboard](https://app.supabase.com) → SQL Editor
2. Copy contents of `supabase/HOTFIX_allocate_lucky_dip_tickets_batch_uuid_casting.sql`
3. Paste into SQL Editor
4. Click "Run"
5. Verify success message: "✅ allocate_lucky_dip_tickets_batch function created successfully!"

### Option 3: Via Supabase CLI
```bash
supabase db execute -f supabase/HOTFIX_allocate_lucky_dip_tickets_batch_uuid_casting.sql
```

## Testing

After applying the fix, test with the competition from the error logs:

```sql
-- Should return success with allocated tickets
SELECT allocate_lucky_dip_tickets_batch(
  'prize:pid:test-user-id',
  '47354b08-8167-471e-959a-5fc114dcc532'::UUID,
  5,
  0.25,
  15,
  NULL,
  NULL
);
```

Expected result: JSON object with `"success": true` and ticket details.

## Verification

Verify the function exists with correct signature:

```sql
SELECT 
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as parameters
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' 
  AND p.proname = 'allocate_lucky_dip_tickets_batch';
```

Expected result: One row showing the function with 7 parameters including `p_competition_id uuid`.

## Impact

Once applied, this fix will:
- ✅ Resolve the 500 error in lucky-dip-reserve edge function
- ✅ Enable Lucky Dip ticket reservation (both small <100 and large >100 batches)
- ✅ Fix ticket allocation for all Lucky Dip purchases
- ✅ Unblock users from purchasing tickets via Lucky Dip feature

## Related Issues

This error was preventing:
- Lucky Dip ticket reservations from completing
- Users from purchasing tickets via Lucky Dip slider
- Batch ticket allocation for large orders (>100 tickets)
- Console showing: `Failed to allocate tickets: function public.parse_uuid(uuid) does not exist`

## Previous Related Fix

This is the second UUID casting fix in this repository:
1. **First fix**: `get_unavailable_tickets` and `get_competition_unavailable_tickets` functions (migration `20260207113700`)
2. **This fix**: `allocate_lucky_dip_tickets_batch` function (migration `20260207115000`)

Both fixes address the same root cause: UUID parameters being compared directly to TEXT columns without explicit type casting.

## Technical Details

**Function Signature:**
```sql
allocate_lucky_dip_tickets_batch(
  p_user_id TEXT,
  p_competition_id UUID,  -- Parameter is UUID
  p_count INTEGER,
  p_ticket_price NUMERIC DEFAULT 1,
  p_hold_minutes INTEGER DEFAULT 15,
  p_session_id TEXT DEFAULT NULL,
  p_excluded_tickets INTEGER[] DEFAULT NULL
)
```

**Key Changes:**
- Added: `v_competition_id_text TEXT` variable
- Added: `v_competition_id_text := p_competition_id::TEXT;` at function start
- Changed 4 locations from `p_competition_id` to `v_competition_id_text`

**No Breaking Changes:**
- Function signature remains the same
- All callers continue to work without modification
- Only internal implementation changed
