# Migration Guide: Fix User Dashboard Errors and Database Function Integration

## Overview

This guide documents the changes made to fix user dashboard errors and database function integration issues with Supabase. All changes have been consolidated into migration file `20260120110000_comprehensive_dashboard_entries_fix.sql`.

## Issues Fixed

### 1. **404 Errors for `get_competition_entries` RPC**
- **Problem**: Frontend was calling `get_competition_entries()` but only `get_competition_entries_bypass_rls()` existed
- **Solution**: Created `get_competition_entries()` as a wrapper function

### 2. **UUID/Text Type Mismatches**
- **Problem**: Functions had multiple overloads (uuid, text) causing HTTP 300 "Multiple Choices" errors
- **Solution**: Removed all UUID overloads, kept only TEXT parameter with internal UUID conversion logic

### 3. **Ticket Availability Showing 0 When All Tickets Available**
- **Problem**: `get_competition_ticket_availability_text()` was incorrectly calculating available tickets
- **Solution**: Fixed logic to properly handle empty sold tickets arrays

### 4. **Missing IDs in Dashboard Entries**
- **Problem**: Entries were being filtered out due to missing `id` or `competition_id` fields
- **Solution**: Updated `get_comprehensive_user_dashboard_entries()` to always generate deterministic IDs

### 5. **User Identity Resolution Issues**
- **Problem**: Entries weren't showing because user identifiers weren't properly matched
- **Solution**: Added canonical user lookup to resolve all user identifiers before querying entries

### 6. **Column Name Mismatch in Frontend**
- **Problem**: RPC returns `total_tickets` and `total_amount_spent` but frontend expected `number_of_tickets` and `amount_spent`
- **Solution**: Updated mapping in `src/lib/database.ts` to handle both naming conventions

## Database Functions Updated

### 1. `get_competition_entries(competition_identifier TEXT)`
- **Purpose**: Returns all entries for a competition
- **Parameter**: `competition_identifier` - accepts both UUID and text uid
- **Returns**: Table with columns: uid, competitionid, userid, privy_user_id, numberoftickets, ticketnumbers, amountspent, walletaddress, chain, transactionhash, purchasedate, created_at
- **Status**: ✅ Created (wrapper for bypass_rls version)

### 2. `get_competition_entries_bypass_rls(competition_identifier TEXT)`
- **Purpose**: Backend version with SECURITY DEFINER to bypass RLS
- **Parameter**: `competition_identifier` - accepts both UUID and text uid
- **Returns**: Same as `get_competition_entries`
- **Status**: ✅ Updated (removed UUID overload, fixed type handling)

### 3. `get_comprehensive_user_dashboard_entries(user_identifier TEXT)`
- **Purpose**: Returns all user entries from multiple sources
- **Parameter**: `user_identifier` - canonical user ID, wallet address, privy user ID, etc.
- **Returns**: Table with columns: id, competition_id, title, description, image, status, entry_type, is_winner, ticket_numbers, total_tickets, total_amount_spent, purchase_date, transaction_hash, is_instant_win, prize_value, competition_status, end_date
- **Data Sources**:
  1. `joincompetition` table (primary)
  2. `tickets` table (fallback)
  3. `user_transactions` table
  4. `pending_tickets` table
- **Status**: ✅ Updated (added canonical user lookup, ensured IDs always present)

### 4. `get_competition_ticket_availability_text(competition_id_text TEXT)`
- **Purpose**: Returns ticket availability data for a competition
- **Parameter**: `competition_id_text` - accepts both UUID and text uid
- **Returns**: JSON object with competition_id, total_tickets, available_tickets[], sold_count, available_count
- **Status**: ✅ Updated (fixed 0 available tickets issue)

### 5. `get_unavailable_tickets(competition_id TEXT)`
- **Purpose**: Returns array of unavailable ticket numbers
- **Parameter**: `competition_id` - accepts both UUID and text uid
- **Returns**: INTEGER[] array of unavailable ticket numbers
- **Status**: ✅ Updated (removed UUID overload)

### 6. `get_user_tickets(user_identifier TEXT)`
- **Purpose**: Returns all tickets for a user
- **Parameter**: `user_identifier` - canonical user ID or wallet address
- **Returns**: Table with columns: id, competition_id, ticket_number, user_id, canonical_user_id, purchase_price, purchased_at, is_winner, created_at
- **Status**: ✅ Created (if not exists)

## Frontend Changes

### File: `src/lib/database.ts`

**Change**: Updated column name mapping in `getUserEntries()` function

```typescript
// Before:
number_of_tickets: entry.number_of_tickets || 1,
amount_spent: entry.amount_spent,

// After:
number_of_tickets: entry.total_tickets || entry.number_of_tickets || 1,
amount_spent: entry.total_amount_spent || entry.amount_spent,
```

**Reason**: RPC function `get_comprehensive_user_dashboard_entries()` returns `total_tickets` and `total_amount_spent`, but the frontend model uses `number_of_tickets` and `amount_spent`. This mapping ensures compatibility with both naming conventions.

## How to Apply

### Step 1: Apply Database Migration

**Option A: Using Supabase CLI**
```bash
cd /home/runner/work/theprize.io/theprize.io
supabase db push
```

**Option B: Using Supabase Dashboard**
1. Go to your Supabase project dashboard
2. Navigate to SQL Editor
3. Open the migration file: `supabase/migrations/20260120110000_comprehensive_dashboard_entries_fix.sql`
4. Copy the entire contents
5. Paste into SQL Editor
6. Click "Run"

### Step 2: Verify Migration Success

Run this verification query in Supabase SQL Editor:

```sql
-- Check if all functions exist
SELECT 
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname IN (
    'get_competition_entries',
    'get_competition_entries_bypass_rls',
    'get_comprehensive_user_dashboard_entries',
    'get_competition_ticket_availability_text',
    'get_unavailable_tickets',
    'get_user_tickets'
  )
ORDER BY p.proname;
```

**Expected Result**: Should return 6 rows, one for each function, all with `TEXT` parameter (no UUID parameters)

### Step 3: Verify Permissions

```sql
-- Check EXECUTE permissions
SELECT 
  routine_name,
  grantee,
  privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name IN (
    'get_competition_entries',
    'get_competition_entries_bypass_rls',
    'get_comprehensive_user_dashboard_entries',
    'get_competition_ticket_availability_text',
    'get_unavailable_tickets',
    'get_user_tickets'
  )
ORDER BY routine_name, grantee;
```

**Expected Result**: Each function should have EXECUTE granted to: `authenticated`, `anon`, `service_role`

### Step 4: Test RPC Calls

Test each RPC function with a real competition ID and user ID:

```sql
-- Test get_competition_entries
SELECT * FROM get_competition_entries('YOUR-COMPETITION-UUID-OR-UID');

-- Test get_comprehensive_user_dashboard_entries
SELECT * FROM get_comprehensive_user_dashboard_entries('YOUR-USER-CANONICAL-ID');

-- Test get_user_tickets
SELECT * FROM get_user_tickets('YOUR-USER-CANONICAL-ID');

-- Test get_competition_ticket_availability_text
SELECT * FROM get_competition_ticket_availability_text('YOUR-COMPETITION-UUID-OR-UID');

-- Test get_unavailable_tickets
SELECT * FROM get_unavailable_tickets('YOUR-COMPETITION-UUID-OR-UID');
```

### Step 5: Deploy Frontend Changes

The frontend changes are already committed in this PR. After merging:

1. Deploy the updated `src/lib/database.ts` to production
2. Verify that dashboard entries are displaying correctly
3. Check browser console for any RPC errors

## Testing Checklist

After applying the migration and deploying frontend changes:

- [ ] Competition entries page shows all entries
- [ ] User dashboard "Entries" tab shows all user entries
- [ ] No 404 errors for `get_competition_entries` in browser console
- [ ] No HTTP 300 errors from function overloads
- [ ] Ticket availability shows correct count (not 0 when all available)
- [ ] Dashboard entries show correct ticket count and amount spent
- [ ] Pending entries display with "Pending" status
- [ ] Completed entries show with "Live" or "Completed" status
- [ ] Winning entries show winner indicator
- [ ] No phantom entries with "Unknown Competition"
- [ ] All entries have valid IDs (no filtering due to missing IDs)

## Rollback Procedure

If issues occur after applying the migration:

### Option 1: Restore Previous Migration State
```sql
-- Rollback to previous versions (if you have backups of the functions)
-- This would require re-running the previous migration files
```

### Option 2: Quick Fix
```sql
-- If only specific functions are causing issues, you can drop and recreate them
DROP FUNCTION IF EXISTS <function_name>(TEXT) CASCADE;
-- Then re-run the specific function creation from a previous migration
```

**Note**: It's recommended to test in a staging environment before applying to production.

## Reference Documentation

This migration consolidates fixes from:
- `ENTRIES_FIX_SOLUTION.md` - Solution for entries not showing
- `SUPABASE_ENTRIES_SETUP.md` - Comprehensive setup guide
- `APPLY_TO_SUPABASE_NOW.sql` - Critical fixes for availability and overloads
- Migration `20260120100000_fix_missing_entries_rpcs.sql` - Original entries RPC fix

## Troubleshooting

### Issue: "Function not found" Error
**Solution**: Migration not applied yet. Run the migration as described in Step 1.

### Issue: "Permission denied" Error
**Solution**: GRANT statements didn't execute. Re-run the migration or manually grant permissions:
```sql
GRANT EXECUTE ON FUNCTION get_competition_entries(TEXT) TO authenticated, anon, service_role;
-- Repeat for all 6 functions
```

### Issue: Entries Still Not Showing
**Checklist**:
1. Verify user exists in `canonical_users` table
2. Verify entries exist in `joincompetition` or `tickets` table
3. Check that competition IDs match between tables
4. Verify RLS policies aren't blocking access

### Issue: HTTP 300 Errors Still Occurring
**Solution**: Check if old UUID overloads still exist:
```sql
-- Should return 0 rows (all UUID overloads should be dropped)
SELECT proname, pg_get_function_identity_arguments(oid)
FROM pg_proc
WHERE proname LIKE '%competition_entries%'
  AND pg_get_function_identity_arguments(oid) LIKE '%uuid%';
```

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review the reference documentation files
3. Check Supabase logs for detailed error messages
4. Contact the development team with specific error details

---

**Migration Created**: 2026-01-20  
**Migration File**: `supabase/migrations/20260120110000_comprehensive_dashboard_entries_fix.sql`  
**Frontend Changes**: `src/lib/database.ts`  
**Documentation References**: ENTRIES_FIX_SOLUTION.md, SUPABASE_ENTRIES_SETUP.md
