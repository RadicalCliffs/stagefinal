# Competition Entries Individual Purchases Fix

## Problem Summary

After applying the migration from PR #333 (`20260214000000_enhance_user_competition_entries.sql`), users reported seeing **no changes** to the competition entry detail pages. 

### Root Cause

PR #333 enhanced the `get_user_competition_entries` RPC function to return individual purchase records from the `competition_entries_purchases` table. However, this table was **not backfilled with historical data**. 

The result:
- ✅ New purchases are being recorded in `competition_entries_purchases`
- ❌ Old/existing competition entries have no records in `competition_entries_purchases`
- ❌ When the enhanced RPC queries the table, it returns empty `individual_purchases` arrays for existing entries
- ❌ The frontend falls back to showing aggregated data (the old view), so users see "no change"

### The Fix

A new migration `20260214100000_backfill_competition_entries_purchases.sql` has been created to:
1. Backfill historical purchase data from `joincompetition` table (primary source)
2. Backfill additional data from `user_transactions` table (secondary source)
3. Recompute the aggregated `competition_entries` table to ensure consistency

## Deployment Instructions

### Step 1: Apply the Backfill Migration

**IMPORTANT:** This migration MUST be applied AFTER the PR #333 migration has been applied.

#### Option A: Using Supabase CLI (Recommended)

```bash
# Navigate to the project directory
cd /path/to/theprize.io

# Ensure you're linked to your Supabase project
supabase link --project-ref YOUR_PROJECT_REF

# Push the new migration
supabase db push
```

#### Option B: Using Supabase Dashboard

1. Go to your Supabase Dashboard
2. Navigate to SQL Editor
3. Open the migration file: `supabase/migrations/20260214100000_backfill_competition_entries_purchases.sql`
4. Copy the entire contents
5. Paste into the SQL Editor
6. Click "Run"

### Step 2: Verify the Backfill Worked

After running the migration, verify that historical data was backfilled:

```sql
-- Check how many records were backfilled
SELECT 
  COUNT(*) as total_purchases,
  COUNT(DISTINCT canonical_user_id) as unique_users,
  COUNT(DISTINCT competition_id) as unique_competitions
FROM competition_entries_purchases;

-- Should return significant numbers if backfill worked

-- Check a specific user's purchases
SELECT 
  competition_id,
  purchase_key,
  tickets_count,
  amount_spent,
  purchased_at
FROM competition_entries_purchases
WHERE canonical_user_id = 'prize:pid:0x...' -- Replace with actual user ID
ORDER BY purchased_at DESC
LIMIT 20;
```

Expected results:
- `total_purchases` should be > 0 (likely thousands if you have historical data)
- Individual user queries should show multiple purchase records per competition

### Step 3: Test the Frontend

After the migration is applied, test the competition entry detail pages:

1. Navigate to `/dashboard/entries`
2. Click on any competition entry
3. Verify you see:
   - ✅ **Purchase History** section showing multiple individual purchases (if user made multiple purchases)
   - ✅ Correct draw date (not "TBD")
   - ✅ VRF Transaction link (for lost competitions with completed draws)
   - ✅ Correct purchase count (e.g., "3 purchases" instead of "1 purchase")

### Step 4: Frontend Redeployment

**IMPORTANT:** The frontend code from PR #333 must be deployed for users to see the changes.

If you applied the migration but haven't deployed the frontend code:
1. Ensure the latest main branch (with PR #333 merged) is deployed
2. Or deploy the current code if PR #333 changes are already in your codebase
3. Clear any CDN caches if applicable
4. Verify users can see the updated UI

```bash
# Build and deploy (example for Netlify)
npm run build
netlify deploy --prod

# Or if using CI/CD, merge to main and let it auto-deploy
```

## Data Model Reference

### Before (PR #333 Not Applied)
```
competitions
    ↓
competition_entries (aggregated: total tickets, total amount)
    ↑
joincompetition + user_transactions (raw purchase data)
```

**Problem:** Raw purchase data was aggregated, individual purchase history was lost.

### After (PR #333 + Backfill)
```
competitions
    ↓
competition_entries (aggregated: total tickets, total amount)
    ↑
competition_entries_purchases (individual purchases: tickets, amounts, dates)
    ↑
joincompetition + user_transactions (backfilled from these)
```

**Solution:** Individual purchases are preserved in `competition_entries_purchases`, and the enhanced RPC returns them to the frontend.

## Troubleshooting

### Issue: Migration fails with "relation already exists"

This is safe to ignore. The migration uses `CREATE TABLE IF NOT EXISTS` and will skip table creation if it already exists.

### Issue: No data after backfill

Check the source tables:

```sql
-- Check if joincompetition has data
SELECT COUNT(*) FROM joincompetition WHERE competitionid IS NOT NULL;

-- Check if user_transactions has data
SELECT COUNT(*) FROM user_transactions WHERE competition_id IS NOT NULL AND type IN ('purchase', 'competition_entry', 'ticket_purchase');
```

If these return 0, there's no historical data to backfill.

### Issue: Still seeing "no changes" after migration

1. **Verify migration was applied:**
   ```sql
   SELECT * FROM competition_entries_purchases LIMIT 10;
   ```
   Should return rows with data.

2. **Verify RPC function exists:**
   ```sql
   SELECT proname, prosrc 
   FROM pg_proc 
   WHERE proname = 'get_user_competition_entries';
   ```
   Should show the enhanced function with `individual_purchases JSONB` in the return type.

3. **Check browser cache:** Hard refresh (Ctrl+Shift+R) or clear browser cache.

4. **Check frontend deployment:** Verify the latest code is deployed with:
   ```bash
   # Check if CompetitionEntryDetails.tsx has the Purchase History section
   grep -A10 "Purchase History" src/components/UserDashboard/Entries/CompetitionEntryDetails.tsx
   ```

### Issue: Duplicate entries showing

The migration includes `ON CONFLICT DO NOTHING` to prevent duplicates. If you see duplicates, they may be legitimate separate purchases. The frontend deduplicates by ID, so genuine duplicates should be filtered out.

## Rollback Plan

If issues occur after applying the backfill:

```sql
-- Option 1: Truncate the backfilled data (keeps new purchases)
DELETE FROM competition_entries_purchases 
WHERE purchase_key LIKE 'jc_%' OR purchase_key LIKE 'ut_%';

-- Option 2: Drop and recreate (removes all data including new purchases)
DROP TABLE competition_entries_purchases CASCADE;
-- Then re-run the baseline migration to recreate the table structure
```

**Note:** Rolling back will make the UI show the old aggregated view again (same as before PR #333).

## Summary

- ✅ PR #333 migration creates enhanced RPC function
- ✅ Backfill migration populates historical data
- ✅ Frontend code displays individual purchases
- ✅ Users now see detailed purchase history, correct draw dates, and VRF links

This is a **two-part deployment**:
1. Database migrations (PR #333 + backfill)
2. Frontend code deployment (PR #333 changes)

Both must be completed for users to see the improvements.
