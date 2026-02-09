# ⚠️ URGENT: Immediate Fix for Lucky Dip 500 Error

## Current Production Issue
**ERROR**: "Failed to allocate tickets: function public.parse_uuid(uuid) does not exist"
**IMPACT**: All Lucky Dip ticket purchases are failing with 500 error
**STATUS**: CRITICAL - Users cannot purchase tickets

## Root Cause
The `allocate_lucky_dip_tickets_batch` function has type mismatches due to mixed UUID/TEXT columns in the database schema.

## Immediate Fix (Apply Now!)

### Step 1: Apply HOTFIX SQL (5 minutes)

1. **Open Supabase Dashboard**: https://app.supabase.com
2. **Navigate to**: SQL Editor
3. **Copy the entire contents** of: `supabase/HOTFIX_allocate_lucky_dip_tickets_batch_uuid_casting.sql`
4. **Paste into SQL Editor**
5. **Click "Run"**
6. **Verify success message**: 
   ```
   ✅ allocate_lucky_dip_tickets_batch function updated successfully!
   ```

### Step 2: Test Immediately

After applying, test Lucky Dip with competition:
- **Competition ID**: `47354b08-8167-471e-959a-5fc114dcc532`
- **URL**: https://substage.theprize.io/competitions/47354b08-8167-471e-959a-5fc114dcc532
- **Action**: Try Lucky Dip with any ticket count (e.g., 5-10 tickets)
- **Expected**: Should work without 500 error

## What Was Fixed

### Schema Reality
After migration `20260202160000_fix_competitions_uuid.sql`, the database has:
- ✅ `competitions.id` → **UUID** (converted from TEXT)
- ✅ `competitions.uid` → **UUID** (converted from TEXT)
- ✅ `tickets.competition_id` → **UUID** (converted from TEXT)
- ❌ `pending_tickets.competition_id` → **TEXT** (NOT converted)
- ❌ `joincompetition.competitionid` → **TEXT** (NOT converted)

### The Fix
The function now:
1. Uses **direct UUID comparisons** for competitions and tickets tables (no casting)
2. Converts UUID to TEXT **only** for pending_tickets and joincompetition tables

### Code Changes
```sql
-- Before (WRONG - tried to cast UUID to TEXT for all tables):
v_competition_id_text := p_competition_id::TEXT;
WHERE tickets.competition_id = v_competition_id_text  -- ❌ UUID column

-- After (CORRECT - use UUID directly for UUID columns):
WHERE tickets.competition_id = p_competition_id  -- ✅ UUID = UUID
WHERE pending_tickets.competition_id = v_competition_id_text  -- ✅ TEXT = TEXT
```

## Verification Steps

### 1. Check Function Exists
```sql
SELECT 
  proname,
  pg_get_function_identity_arguments(oid) as parameters
FROM pg_proc 
WHERE proname = 'allocate_lucky_dip_tickets_batch';
```

Expected: 1 row with 7 parameters

### 2. Test Function Directly
```sql
SELECT allocate_lucky_dip_tickets_batch(
  'prize:pid:test-user',
  '47354b08-8167-471e-959a-5fc114dcc532'::UUID,
  5,
  0.25,
  15,
  NULL,
  NULL
);
```

Expected: JSON with `"success": true`

### 3. Test via UI
- Go to competition page
- Click Lucky Dip
- Select ticket count
- Click "Reserve Tickets"
- Should succeed without 500 error

## Rollback (If Needed)

If the fix causes issues:
```sql
-- Restore previous version (if you have a backup)
-- Or contact support for assistance
```

## Timeline

- **Apply HOTFIX**: NOW (5 minutes)
- **Test**: Immediately after (2 minutes)
- **Monitor**: Next 30 minutes for any issues
- **Full Migration**: Will deploy automatically with next PR merge

## Support

If you encounter issues:
1. Check Supabase logs in Dashboard → Logs
2. Look for errors mentioning `allocate_lucky_dip_tickets_batch`
3. Contact development team with log output

## Related Files

- **HOTFIX SQL**: `supabase/HOTFIX_allocate_lucky_dip_tickets_batch_uuid_casting.sql`
- **Migration**: `supabase/migrations/20260207115000_fix_allocate_lucky_dip_tickets_batch_uuid_casting.sql`
- **Documentation**: `HOTFIX_ALLOCATE_LUCKY_DIP_TICKETS_BATCH_UUID_CASTING.md`

---

**Last Updated**: 2026-02-07 11:58 UTC
**Priority**: P0 - CRITICAL
**Status**: Ready to Apply
