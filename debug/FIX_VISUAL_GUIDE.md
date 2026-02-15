# Competition Entries Display Fix - Visual Guide

## Problem: "Unknown Competition" Display Issue

### Before Fix
```
Orders Table Display:
┌─────────────────────────┬──────┬──────────────┬──────────┬────────┐
│ Competition Name        │ Type │ Provider     │ Date     │ Cost   │
├─────────────────────────┼──────┼──────────────┼──────────┼────────┤
│ Unknown Competition ❌  │ entry│ base_account │ 2/13/26  │ $0.50  │
│ Unknown Competition ❌  │ entry│ base_account │ 2/13/26  │ $0.25  │
└─────────────────────────┴──────┴──────────────┴──────────┴────────┘
```

### After Fix
```
Orders Table Display:
┌─────────────────────────┬──────┬──────────────┬──────────┬────────┐
│ Competition Name        │ Type │ Provider     │ Date     │ Cost   │
├─────────────────────────┼──────┼──────────────┼──────────┼────────┤
│ Win a Tesla Model 3 ✅  │ entry│ base_account │ 2/13/26  │ $0.50  │
│ $1000 USDC Prize    ✅  │ entry│ base_account │ 2/13/26  │ $0.25  │
└─────────────────────────┴──────┴──────────────┴──────────┴────────┘
```

## What Was Fixed

### Database Level
```
┌─────────────────────────────────────────────────────────────────┐
│                    joincompetition table                        │
│  - Contains ALL ticket purchases                                │
│  - Has: competition_id, ticket_numbers, amount, etc.            │
│  - Does NOT have competition title/description                  │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     │ Trigger fires on INSERT/UPDATE
                     ↓
┌─────────────────────────────────────────────────────────────────┐
│              sync_competition_entries_from_joincompetition()    │
│                        TRIGGER FUNCTION                          │
│                                                                  │
│  BEFORE (❌ Bug):                                                │
│    - Copied data from joincompetition                           │
│    - Did NOT fetch competition title                            │
│    - Left competition_title = NULL                              │
│                                                                  │
│  AFTER (✅ Fixed):                                               │
│    - Copies data from joincompetition                           │
│    - QUERIES competitions table for title/description           │
│    - Populates competition_title and competition_description    │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     │ Creates/updates entry
                     ↓
┌─────────────────────────────────────────────────────────────────┐
│                  competition_entries table                       │
│  - Aggregated view of user's entries per competition            │
│  - BEFORE: competition_title = NULL → Shows "Unknown"           │
│  - AFTER:  competition_title = "Win a Tesla Model 3"            │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     │ user_overview view reads this table
                     ↓
┌─────────────────────────────────────────────────────────────────┐
│                      user_overview VIEW                          │
│  - Returns aggregated JSON of user's entries                    │
│  - Frontend reads entries_json field                            │
│  - Displays in Orders table and dashboard                       │
└─────────────────────────────────────────────────────────────────┘
```

### Code Flow
```
User Purchases Tickets
         ↓
purchase_tickets_with_balance() RPC
         ↓
INSERT into joincompetition
         ↓
Trigger: sync_competition_entries_from_joincompetition() fires
         ↓
    ┌────────────────────────────────────┐
    │ NEW CODE ADDED:                    │
    │ SELECT title, description          │
    │ FROM competitions                  │
    │ WHERE id = competition_id          │
    └────────────────────────────────────┘
         ↓
INSERT/UPDATE competition_entries
  WITH competition_title populated ✅
         ↓
user_overview view returns correct data
         ↓
Frontend displays actual competition name ✅
```

## Migration Details

### What the Migration Does

**File**: `supabase/migrations/20260213192500_fix_competition_title_in_entries.sql`

**Step 1**: Updates trigger function
- Adds competition title/description fetching logic
- Safely handles UUID and text IDs
- Graceful error handling

**Step 2**: Backfills existing data
```sql
UPDATE competition_entries
SET competition_title = competitions.title
WHERE competition_title IS NULL
```
- Fixes ALL existing entries with NULL titles
- One-time operation

**Step 3**: Logs results
- Reports number of entries updated
- Confirms migration success

### Safety Features

✅ **Safe UUID Casting**
```sql
BEGIN
  SELECT title FROM competitions 
  WHERE id::text = NEW.competitionid
EXCEPTION WHEN OTHERS THEN
  -- Graceful fallback
  v_competition_title := 'Unknown Competition';
END;
```

✅ **Idempotent**
- Can be run multiple times safely
- Won't break if titles already populated

✅ **Performance**
- Small overhead per entry creation (one SELECT)
- Uses existing indexes on competitions table
- Backfill completes quickly

## Expected Results

### For Existing Entries
1. Orders table will show actual competition names
2. Dashboard entries will display correctly
3. User can see what competitions they entered

### For New Entries
1. Automatic title population on purchase
2. No more "Unknown Competition" display
3. Consistent experience across all features

## What This Does NOT Fix

This migration specifically addresses the `competition_entries` table and Orders display. 

**Out of Scope**:
- If entries are truly missing from database (not just showing wrong names)
- Issues with Live Activity (already working - uses different query path)
- Issues with competition entries display (already working - uses joincompetition directly)

The user's issue about entries not showing in "entries section" may require additional investigation if the problem persists after this fix.

## Deployment

**To Apply**:
1. Apply migration: `supabase db push`
2. Verify orders display correctly
3. Test new ticket purchase
4. Monitor logs for any issues

**Rollback** (if needed):
- Revert trigger function to previous version
- No data loss - only title fields affected

---

**Status**: ✅ Ready for Production  
**Risk Level**: Low  
**Estimated Impact**: Immediate improvement in UX  
**Testing Required**: Manual verification of orders display
