# Migration Summary: Fix Competition Entries Display Issue

## Issue Description
User reported that after purchasing tickets successfully:
1. **Orders table shows "Unknown Competition"** instead of actual competition names
2. Entries may not be visible in various sections of the application
3. Payment was processed and tickets were allocated (confirmed in success modal)

## Root Cause Analysis

### Primary Issue: Missing Competition Titles
The `sync_competition_entries_from_joincompetition()` trigger function was syncing data from the `joincompetition` table to the `competition_entries` table but was NOT populating the following fields:
- `competition_title` 
- `competition_description`

### Data Flow
1. User purchases tickets → `purchase_tickets_with_balance()` RPC function
2. Entry created in `joincompetition` table
3. Trigger `trg_sync_competition_entries` fires
4. Trigger function `sync_competition_entries_from_joincompetition()` executes
5. Entry created/updated in `competition_entries` table
6. **PROBLEM**: Competition title/description NOT populated (left as NULL)

### Impact
- `user_overview` view reads from `competition_entries` and returns NULL for `competition_title`
- `userOverviewService.ts` transforms this data with fallback: `entry.competition_title || 'Unknown Competition'`
- Orders table displays "Unknown Competition" for all entries
- Dashboard entries may not display correctly

## Solution

### Migration File
`supabase/migrations/20260213192500_fix_competition_title_in_entries.sql`

### Changes Made

#### 1. Updated Trigger Function
**Modified**: `sync_competition_entries_from_joincompetition()`

**New behavior**:
- Queries `competitions` table to fetch `title` and `description` when syncing entries
- Safely handles both UUID and text competition IDs with error handling
- Populates `competition_title` and `competition_description` in both INSERT and UPDATE operations
- Falls back to "Unknown Competition" if competition not found

**Key improvements**:
- Added safe UUID casting with exception handling
- Used `EXCLUDED` keyword in ON CONFLICT clause for proper variable scope
- Handles edge cases (NULL values, missing competitions)

#### 2. Backfill Existing Data
**Action**: Updates ALL existing entries with NULL or "Unknown Competition" titles

**Query**:
```sql
UPDATE public.competition_entries ce
SET 
  competition_title = COALESCE(c.title, 'Unknown Competition'),
  competition_description = COALESCE(c.description, ''),
  updated_at = NOW()
FROM public.competitions c
WHERE (ce.competition_id = c.id::text OR ce.competition_id = c.uid::text)
  AND (ce.competition_title IS NULL 
       OR ce.competition_title = '' 
       OR ce.competition_title = 'Unknown Competition');
```

#### 3. Logging
Logs the number of entries successfully updated with valid competition titles.

## Expected Results

### Immediate (After Migration)
1. ✅ All existing entries in `competition_entries` will have proper competition titles
2. ✅ Orders table will display actual competition names instead of "Unknown Competition"
3. ✅ User dashboard entries will show correct competition information

### Ongoing (For New Entries)
1. ✅ All new ticket purchases will automatically populate competition titles
2. ✅ Updates to existing entries will refresh competition titles
3. ✅ System will gracefully handle missing competitions (show "Unknown Competition")

## What This Fix Does NOT Address

This migration specifically fixes the `competition_entries` table and the Orders display. However:

1. **Live Activity on Homepage**: Uses `v_joincompetition_active` view which already joins with `competitions` table - should work correctly
2. **Competition Entries Section**: Uses direct queries from `joincompetition` table - should work correctly
3. **Missing Entries**: If entries are truly missing from `joincompetition` table (not just showing wrong names), that's a different issue requiring separate investigation

## Verification Steps

After applying this migration, verify:

1. **Check Orders Table**:
   ```sql
   SELECT id, competition_title, tickets_count, amount_spent 
   FROM competition_entries 
   WHERE canonical_user_id = '<user-canonical-id>'
   ORDER BY created_at DESC;
   ```

2. **Check user_overview View**:
   ```sql
   SELECT canonical_user_id, entries_json 
   FROM user_overview 
   WHERE canonical_user_id = '<user-canonical-id>';
   ```

3. **Test New Purchase**:
   - Purchase tickets for a competition
   - Verify entry shows correct competition name in Orders table
   - Verify entry appears in user dashboard

## Rollback Plan

If issues arise, the migration can be rolled back by:

1. Reverting the trigger function to the previous version (without competition title fetching)
2. No data loss risk - only the `competition_title` and `competition_description` fields are affected

## Security Considerations

- ✅ No new security vulnerabilities introduced
- ✅ Uses existing RLS policies on `competition_entries` table
- ✅ Safe UUID casting with exception handling
- ✅ No exposure of sensitive data

## Performance Considerations

- **Trigger overhead**: Small additional query per entry creation (SELECT from competitions)
- **Backfill impact**: One-time UPDATE query on existing entries (should complete quickly)
- **Index usage**: Leverages existing indexes on `competitions(id)` and `competitions(uid)`

## Related Files

- `supabase/migrations/20260213192500_fix_competition_title_in_entries.sql` - The migration
- `supabase/migrations/20260202062200_sync_competition_entries.sql` - Original trigger creation
- `src/services/userOverviewService.ts` - Frontend service that uses `user_overview` view
- `src/components/UserDashboard/Orders/OrdersTable.tsx` - Component displaying orders
- `src/lib/database.ts` - Database utilities (not directly affected)

## Next Steps

1. ✅ Migration created and reviewed
2. ✅ Code review completed and feedback addressed
3. ✅ Security check passed
4. ⏳ **TODO**: Apply migration to production database
5. ⏳ **TODO**: Verify entries display correctly
6. ⏳ **TODO**: Monitor for any issues after deployment

## Contact

For questions or issues with this migration, contact the development team.

---

**Migration Date**: 2026-02-13  
**Migration ID**: 20260213192500  
**Issue**: Competition entries showing "Unknown Competition"  
**Status**: Ready for deployment
