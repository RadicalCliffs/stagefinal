# Deployment Instructions for Competition Entry Details Fix

## Overview
This PR fixes issues with the competition entry details page showing incorrect/incomplete data. The fix requires deploying a database migration to Supabase before the frontend changes will work correctly.

## Required Steps

### 1. Deploy Database Migration to Supabase

**IMPORTANT:** The database migration **MUST** be deployed first, before deploying the frontend code.

#### Option A: Using Supabase CLI (Recommended)

```bash
# Navigate to the project directory
cd /home/runner/work/theprize.io/theprize.io

# Link to your Supabase project (if not already linked)
supabase link --project-ref YOUR_PROJECT_REF

# Push the migration to Supabase
supabase db push
```

#### Option B: Using Supabase Dashboard

1. Go to your Supabase Dashboard
2. Navigate to SQL Editor
3. Open the migration file: `supabase/migrations/20260214000000_enhance_user_competition_entries.sql`
4. Copy the entire contents of the file
5. Paste into the SQL Editor
6. Click "Run" to execute the migration

### 2. Verify Migration Success

After deploying the migration, verify it worked:

```sql
-- Check if the function exists and has the correct signature
SELECT 
  p.proname as function_name,
  pg_get_function_arguments(p.oid) as arguments,
  pg_get_function_result(p.oid) as return_type
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' 
  AND p.proname = 'get_user_competition_entries';
```

Expected output should show:
- Function name: `get_user_competition_entries`
- Arguments: `p_user_identifier text`
- Return type: A table with multiple columns including `draw_date`, `vrf_tx_hash`, and `individual_purchases`

### 3. Deploy Frontend Code

After the migration is successfully deployed, deploy the frontend code:

```bash
# Build the frontend
npm run build

# Deploy to your hosting platform (e.g., Netlify)
# This depends on your deployment setup
```

### 4. Test the Changes

After deployment, test the following:

1. **Navigate to a competition entry details page**: `/dashboard/entries/competition/{competition_id}`
2. **Verify all purchase records are shown**: Check that the "Purchase History" section shows the correct number of purchases (not just 1)
3. **Verify draw date**: For completed competitions, verify the draw date shows the actual date (not "TBD")
4. **Verify VRF link**: For lost competitions with a draw, verify the VRF Transaction field appears
5. **Verify status display**: 
   - Active competitions should show "Active"
   - Competitions that ended but haven't been drawn should show "Drawing" (orange)
   - Competitions that have been drawn should show "Completed"

## What Changed

### Database Changes (Migration)
- Enhanced `get_user_competition_entries` RPC function to:
  - Return individual purchase records from `competition_entries_purchases` table
  - Include draw information: `draw_date`, `vrf_tx_hash`, `vrf_status`, `vrf_draw_completed_at`
  - Include all competition metadata needed for the detailed view
  - Return individual purchases as a JSONB array

### Frontend Changes
1. **Types** (`src/types/entries.ts`):
   - Added `IndividualPurchase` interface
   - Enhanced `UserCompetitionEntry` with new fields

2. **Data Layer** (`src/lib/database.ts`):
   - Updated `getUserEntriesFromCompetitionEntries` to expand individual purchases
   - Enhanced status logic to distinguish "Drawing" vs "Completed"
   - Pass through draw_date and VRF fields

3. **UI Components** (`src/components/UserDashboard/Entries/CompetitionEntryDetails.tsx`):
   - Updated interfaces to include draw_date, vrf_tx_hash, vrf_status
   - Updated status display logic
   - Updated Draw Date field to show actual draw_date or fallback to end_date
   - Added VRF Transaction field for lost competitions
   - Fixed Purchase History count
   - Simplified deduplication logic to use unique IDs

## Rollback Plan

If issues occur after deployment:

1. **Rollback the migration**:
   ```sql
   -- Restore the old function (this is a simplified version)
   CREATE OR REPLACE FUNCTION get_user_competition_entries(p_user_identifier TEXT)
   RETURNS TABLE (
     competition_id TEXT,
     competition_title TEXT,
     tickets_count INTEGER,
     amount_spent NUMERIC,
     is_winner BOOLEAN,
     latest_purchase_at TIMESTAMPTZ
   )
   -- ... rest of old implementation
   ```

2. **Rollback the frontend code**: Revert to the previous commit before this PR

## Support

If you encounter any issues during deployment:
1. Check Supabase logs for database errors
2. Check browser console for frontend errors
3. Review the test steps above to identify which component is failing
