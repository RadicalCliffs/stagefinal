# Fix Summary: Competition Entry Details Not Showing Changes

## Issue Report

**User Complaint:**
> "I applied your migrations referenced in pr #333 before the code base was pushed as requested, and yet I see no change at all to the further detail pages on the entries section of my user dashboard. you are not editing the right files, clearly. sort it out."

## Investigation Findings

### What PR #333 Did

PR #333 ("Fix competition entry details to show individual purchases and draw information") made the following changes:

1. **Database:** Enhanced `get_user_competition_entries` RPC function to return:
   - Individual purchase records from `competition_entries_purchases` table as JSONB array
   - Draw information (draw_date, vrf_tx_hash, vrf_status)
   - Complete competition metadata

2. **Frontend:** Updated components to display:
   - Individual purchase history (multiple purchases per competition)
   - Actual draw dates (not just "TBD")
   - VRF transaction links for verification
   - Correct purchase counts

### Root Cause Analysis

The issue was NOT that "the wrong files were edited." All the frontend changes from PR #333 are correct and present in the codebase. The actual problem was:

**The `competition_entries_purchases` table was never backfilled with historical data.**

#### How This Caused "No Changes" to Appear:

1. User applied PR #333 migration → RPC function now queries `competition_entries_purchases`
2. But `competition_entries_purchases` was empty for existing competitions
3. RPC returns empty `individual_purchases` arrays for historical entries
4. Frontend code checks: `if (individualPurchases.length > 0)` → evaluates to FALSE
5. Code falls back to showing aggregated data (the old view)
6. **Result:** User sees no difference in the UI

#### Data Flow Before Fix:
```
User views entry → RPC queries competition_entries_purchases → Empty array returned
→ Frontend falls back to aggregated view → Old UI shown → "No changes"
```

#### Data Flow After Fix:
```
User views entry → RPC queries competition_entries_purchases → Historical data returned
→ Frontend shows individual purchases → New UI shown → Changes visible
```

## The Solution

### Created Migration: `20260214100000_backfill_competition_entries_purchases.sql`

This migration:

1. **Backfills from `joincompetition` table** (primary source)
   - Extracts: user ID, competition ID, ticket numbers, amount spent, purchase date
   - Uses `jc_` prefix for purchase keys to prevent conflicts
   - Handles null canonical_user_id by falling back to privy_user_id, userid, or wallet_address

2. **Backfills from `user_transactions` table** (secondary source)
   - Captures purchases that may not be in joincompetition
   - Uses `ut_` prefix for purchase keys
   - Only includes completed transactions with ticket_count > 0

3. **Prevents duplicates**
   - Uses `ON CONFLICT DO NOTHING` on unique constraint (canonical_user_id, competition_id, purchase_key)
   - DISTINCT ON clause ensures no duplicate keys from source data

4. **Recomputes aggregated data**
   - Calls `recompute_competition_entry()` for each user+competition pair
   - Updates `competition_entries` table with correct totals
   - Gracefully handles if function doesn't exist

### Migration Safety Features

- ✅ Idempotent: Can be run multiple times safely
- ✅ Non-destructive: Only inserts, never deletes
- ✅ Conflict-safe: Uses unique constraints to prevent duplicates
- ✅ Fallback-aware: Handles missing canonical_user_id gracefully
- ✅ Transaction-wrapped: All-or-nothing execution

## Files Changed

### New Files Created
1. `supabase/migrations/20260214100000_backfill_competition_entries_purchases.sql`
   - SQL migration to backfill historical data
   - 132 lines
   
2. `COMPETITION_ENTRIES_BACKFILL_INSTRUCTIONS.md`
   - Comprehensive deployment guide
   - Troubleshooting steps
   - Verification queries
   - Rollback procedures

### Files Verified (No Changes Needed)
These files already contain correct changes from PR #333:
- ✅ `src/components/UserDashboard/Entries/CompetitionEntryDetails.tsx`
- ✅ `src/lib/database.ts`
- ✅ `src/types/entries.ts`
- ✅ `supabase/migrations/20260214000000_enhance_user_competition_entries.sql`

## Deployment Steps

### For Production

1. **Apply the backfill migration:**
   ```bash
   supabase db push
   ```
   Or via Supabase Dashboard SQL Editor

2. **Verify backfill worked:**
   ```sql
   SELECT COUNT(*) FROM competition_entries_purchases;
   -- Should return > 0 if there's historical data
   ```

3. **Ensure frontend is deployed:**
   - PR #333 code must be deployed for changes to be visible
   - Clear any CDN caches if applicable

4. **Test:**
   - Navigate to `/dashboard/entries`
   - Click on a competition entry
   - Verify individual purchases are shown

### Expected Results After Fix

Users will now see:
- ✅ **Purchase History section** showing multiple individual purchases (if applicable)
- ✅ **Correct draw dates** (actual date or "Scheduled", not "TBD")
- ✅ **VRF Transaction links** for lost competitions with completed draws
- ✅ **Accurate purchase counts** (e.g., "3 purchases" instead of always "1 purchase")
- ✅ **Individual ticket numbers** for each purchase

## Technical Details

### Database Schema
```
competition_entries_purchases
  ├─ id (uuid, PK)
  ├─ canonical_user_id (text)
  ├─ competition_id (uuid)
  ├─ purchase_key (text)
  ├─ tickets_count (integer)
  ├─ amount_spent (numeric)
  ├─ ticket_numbers_csv (text)
  ├─ purchased_at (timestamptz)
  └─ created_at (timestamptz)
  
  UNIQUE (canonical_user_id, competition_id, purchase_key)
```

### Purchase Key Format
- `jc_{uuid}` - From joincompetition table
- `ut_{uuid}` - From user_transactions table
- This prevents collisions between the two sources

### Backfill Statistics (Example)
```sql
-- After successful backfill, you might see:
SELECT 
  COUNT(*) as total_purchases,                    -- e.g., 15,234
  COUNT(DISTINCT canonical_user_id) as users,     -- e.g., 2,456  
  COUNT(DISTINCT competition_id) as competitions  -- e.g., 89
FROM competition_entries_purchases;
```

## Why User Saw "No Changes"

The confusion was understandable:
1. ✅ User correctly applied PR #333 migration
2. ✅ RPC function was enhanced successfully
3. ❌ But historical data wasn't populated
4. → Frontend code worked correctly but had no data to display
5. → Fell back to old aggregated view
6. → **Appeared as if nothing changed**

## Resolution

This fix addresses the data gap by backfilling historical purchases. Once applied:
- New purchases: Already working (captured in real-time)
- Old purchases: Now backfilled and visible
- **Complete purchase history** is now available for all competitions

## Security Notes

- Migration uses parameterized queries (no SQL injection risk)
- No raw user input is processed
- Uses existing database functions and constraints
- Follows principle of least privilege (only inserts data)

### Known Dependency Issue (Unrelated)
- axios 1.13.2 has a known vulnerability (GHSA-8hc4-vh64-cxmj)
- Recommended to upgrade to 1.13.5+
- Not addressed in this PR as it's outside the scope of this fix

## Testing Recommendations

1. **Before applying backfill:**
   ```sql
   SELECT COUNT(*) FROM competition_entries_purchases;
   -- Record the count
   ```

2. **Apply backfill migration**

3. **After backfill:**
   ```sql
   SELECT COUNT(*) FROM competition_entries_purchases;
   -- Should be significantly higher
   ```

4. **Frontend test:**
   - Browse to entry detail page
   - Verify Purchase History section appears
   - Check that multiple purchases are shown (if user made multiple)

## Success Criteria

- ✅ `competition_entries_purchases` table contains historical data
- ✅ RPC function returns populated `individual_purchases` arrays
- ✅ Frontend displays individual purchase records
- ✅ Draw dates show correct values
- ✅ VRF links appear for applicable competitions
- ✅ Users report seeing the expected changes

## Rollback Plan

If issues arise:
```sql
-- Remove backfilled data
DELETE FROM competition_entries_purchases 
WHERE purchase_key LIKE 'jc_%' OR purchase_key LIKE 'ut_%';
```

This reverts to the pre-backfill state without breaking new purchases.
