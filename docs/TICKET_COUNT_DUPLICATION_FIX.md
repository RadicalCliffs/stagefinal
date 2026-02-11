# Ticket Count Duplication Fix

## Problem Statement

Users reported seeing incorrect ticket counts in their dashboard:
- **Reported Issue**: User purchased 250 tickets but dashboard showed 1000 tickets (4x multiplication)
- **Another Case**: User purchased 500 tickets which displayed correctly as 500

## Root Cause Analysis

### Database Architecture

The application stores ticket purchases in multiple tables for backward compatibility:

1. **competition_entries** - New unified system
2. **user_transactions** - Transaction records
3. **joincompetition** - Legacy system (preserved for historical data)

### The Bug

Two RPC functions fetch user dashboard data by combining these tables:
- `get_user_competition_entries`
- `get_comprehensive_user_dashboard_entries`

**Problem Code Pattern:**
```sql
SELECT tickets_count FROM competition_entries
UNION ALL  -- ← KEEPS ALL DUPLICATES
SELECT tickets_count FROM user_transactions
UNION ALL  -- ← KEEPS ALL DUPLICATES
SELECT tickets_count FROM joincompetition
-- Then GROUP BY with SUM adds them all up!
```

When a purchase exists in multiple tables (e.g., synced from legacy to new system), `UNION ALL` keeps all copies. The subsequent `GROUP BY` with `SUM(tickets_count)` adds these duplicates together:

**Example:**
- Purchase: 250 tickets for BTC competition
- Stored in `competition_entries`: 250
- Duplicated in `user_transactions`: 250  
- Duplicated in `joincompetition`: 250
- May appear again if multiple sync operations occurred
- **Result: SUM = 250 + 250 + 250 + 250 = 1000** ❌

## Solution

Replace `UNION ALL` with `UNION` to deduplicate identical rows **before** aggregation.

### Fixed Code Pattern:
```sql
SELECT tickets_count FROM competition_entries
UNION  -- ← DEDUPLICATES IDENTICAL ROWS
SELECT tickets_count FROM user_transactions
UNION  -- ← DEDUPLICATES IDENTICAL ROWS
SELECT tickets_count FROM joincompetition
-- Now GROUP BY SUM only adds unique purchases
```

**Same Example After Fix:**
- Purchase: 250 tickets for BTC competition
- Row from `competition_entries`: 250
- Duplicate row from `user_transactions`: 250 (removed by UNION)
- Duplicate row from `joincompetition`: 250 (removed by UNION)
- **Result: SUM = 250** ✓

### Why This Works

1. **UNION** performs an implicit `DISTINCT`, removing exact duplicate rows
2. Multiple **distinct** purchases (different amounts, dates, tickets) are preserved
3. Cross-table duplicates (same purchase in multiple tables) are eliminated
4. Minimal performance impact - tables already indexed on user_id and competition_id

## Implementation

### Migration File
**Location**: `supabase/migrations/20260211120000_fix_ticket_count_duplication.sql`

**Changes Made:**

1. **get_user_competition_entries** (Line 82)
   - Changed: `UNION ALL` → `UNION`
   - Effect: Deduplicates competition_entries + joincompetition data

2. **get_comprehensive_user_dashboard_entries** (Lines 206, 232)
   - Changed: Both `UNION ALL` → `UNION`
   - Effect: Deduplicates competition_entries + user_transactions + joincompetition data

### Test Script
**Location**: `supabase/migrations/test_20260211120000_ticket_count_fix.sql`

Verifies:
- Functions exist with correct signatures
- Functions use UNION (not UNION ALL)
- Return columns match expected schema
- SECURITY DEFINER permission set correctly

## Verification Steps

### 1. Apply Migration
```bash
# Apply to Supabase project
supabase db push

# Or apply manually via Supabase Dashboard → SQL Editor
# Run: supabase/migrations/20260211120000_fix_ticket_count_duplication.sql
```

### 2. Run Test Script
```bash
# Via Supabase Dashboard → SQL Editor
# Run: supabase/migrations/test_20260211120000_ticket_count_fix.sql

# Expected output:
# - Both functions exist with SECURITY DEFINER
# - uses_union_not_union_all = true for both
```

### 3. Verify User Dashboard
1. Log in as affected user
2. Navigate to Dashboard → My Entries
3. Check ticket counts match actual purchases
4. Verify amounts spent are correct

## Edge Cases Handled

### ✅ Multiple Distinct Purchases
**Scenario**: User buys 100 tickets, then later buys 150 more tickets for same competition
```sql
-- Row 1: 100 tickets @ $50 on 2026-02-10
-- Row 2: 150 tickets @ $75 on 2026-02-11
-- Result: 250 total tickets, $125 total spent ✓
```
Works correctly because rows are different (different dates/amounts).

### ✅ Same Purchase, Multiple Tables
**Scenario**: 250 tickets appear in all 3 tables (competition_entries, user_transactions, joincompetition)
```sql
-- Before fix: 250 + 250 + 250 = 750 ❌
-- After fix: 250 (duplicates removed) ✓
```

### ✅ Legitimate Multi-Purchase Aggregation
**Scenario**: User makes 3 separate purchases over time
```sql
-- Purchase 1: 50 tickets @ $25
-- Purchase 2: 100 tickets @ $50  
-- Purchase 3: 75 tickets @ $37.50
-- Result: 225 total tickets, $112.50 total spent ✓
```
Works because each purchase has unique characteristics.

## Performance Impact

**Before**: `UNION ALL` (no deduplication)
- Faster union operation (no distinct check)
- More rows to aggregate in GROUP BY
- Net: Similar performance

**After**: `UNION` (with deduplication)
- Slight overhead for distinct check
- Fewer rows to aggregate in GROUP BY
- Net: Similar performance

**Indexes Already Exist:**
- `canonical_users(canonical_user_id)`
- `competition_entries(canonical_user_id, competition_id)`
- `user_transactions(canonical_user_id, competition_id)`
- `joincompetition(canonical_user_id, competitionid)`

Expected impact: **Negligible** - operations are already indexed, and deduplication happens on small result sets.

## Rollback Plan

If issues arise, rollback by reverting to `UNION ALL`:

```sql
-- Restore previous version
-- Run: supabase/migrations/20260205000000_fix_dashboard_aggregate_tickets_amounts.sql
```

Or apply this quick fix:
```sql
-- Replace UNION with UNION ALL in both functions
-- Lines 82, 206, 232 in the migration file
```

## Related Files

- **Migration**: `supabase/migrations/20260211120000_fix_ticket_count_duplication.sql`
- **Test**: `supabase/migrations/test_20260211120000_ticket_count_fix.sql`
- **Frontend Code**: `src/lib/database.ts` (getUserEntriesFromCompetitionEntries)
- **RPC Helpers**: `src/lib/supabase-rpc-helpers.ts` (getUserCompetitionEntries)
- **UI Component**: `src/components/UserDashboard/Entries/EntriesList.tsx`

## Author

- **Date**: 2026-02-11
- **Issue**: Ticket count doubling in user dashboard
- **Fix Type**: SQL RPC function update (UNION ALL → UNION)
