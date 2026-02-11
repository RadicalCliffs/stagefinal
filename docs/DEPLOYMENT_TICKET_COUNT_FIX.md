# DEPLOYMENT INSTRUCTIONS - Ticket Count Duplication Fix

## ⚠️ CRITICAL FIX - Deploy Immediately

### What This Fixes
Users seeing **incorrect ticket counts** in their dashboard:
- Example: Purchased 250 tickets → Dashboard shows 1000 tickets (4x multiplication)
- Root cause: Database functions using `UNION ALL` duplicate purchases across multiple tables

### Files to Deploy

#### 1. Primary Migration (REQUIRED)
**File**: `supabase/migrations/20260211120000_fix_ticket_count_duplication.sql`

**What it does:**
- Updates `get_user_competition_entries` function
- Updates `get_comprehensive_user_dashboard_entries` function  
- Replaces `UNION ALL` with `UNION` to deduplicate rows

**Deployment Method:**

**Option A - Supabase Dashboard (Recommended)**
1. Log into Supabase Dashboard
2. Navigate to SQL Editor
3. Copy contents of `20260211120000_fix_ticket_count_duplication.sql`
4. Execute the SQL
5. Verify success message appears

**Option B - Supabase CLI**
```bash
# From project root
supabase db push
```

#### 2. Verification Script (RECOMMENDED)
**File**: `supabase/migrations/test_20260211120000_ticket_count_fix.sql`

**What it does:**
- Verifies both functions exist
- Confirms they use UNION (not UNION ALL)
- Checks return column signatures

**Run After Deployment:**
```bash
# Via Supabase Dashboard → SQL Editor
# Copy and run: test_20260211120000_ticket_count_fix.sql
```

**Expected Output:**
```
Test 1: get_user_competition_entries - FOUND ✓
        uses_union_not_union_all = true

Test 2: get_comprehensive_user_dashboard_entries - FOUND ✓
        uses_union_not_union_all = true

Test 3: Return columns for get_user_competition_entries
        - competition_id (text)
        - competition_title (text)
        - tickets_count (integer)
        - amount_spent (numeric)
        ... (12 columns total)

Test 4: Return columns for get_comprehensive_user_dashboard_entries
        - id (text)
        - competition_id (text)
        - title (text)
        ... (17 columns total)
```

### Pre-Deployment Checklist

- [ ] Read `docs/TICKET_COUNT_DUPLICATION_FIX.md` for full context
- [ ] Backup current functions (if needed for rollback):
  ```sql
  -- Run this before deploying fix
  SELECT routine_definition 
  FROM information_schema.routines 
  WHERE routine_name = 'get_user_competition_entries';
  
  SELECT routine_definition 
  FROM information_schema.routines 
  WHERE routine_name = 'get_comprehensive_user_dashboard_entries';
  ```
- [ ] Notify team about deployment
- [ ] Identify affected users for post-deployment verification

### Post-Deployment Verification

#### 1. Database Level
```sql
-- Check functions updated correctly
SELECT routine_name, 
       routine_definition LIKE '%UNION%' as has_union,
       routine_definition LIKE '%UNION ALL%' as has_union_all
FROM information_schema.routines
WHERE routine_name IN (
  'get_user_competition_entries',
  'get_comprehensive_user_dashboard_entries'
);

-- Expected: has_union = true, has_union_all = false
```

#### 2. User Dashboard Level
1. Log in as affected user (or use test account)
2. Navigate to Dashboard → My Entries tab
3. Verify ticket counts match actual purchases
4. Check multiple competitions if applicable

**Example Verification:**
- User purchased: 250 tickets for "WIN 1 BTC" @ $125
- Dashboard should show: **250 tickets** (not 1000)
- Amount spent: **$125.00** (correct)

### Rollback Plan (If Needed)

If issues arise, rollback by restoring previous version:

**Option 1 - Restore from Backup**
```sql
-- Use the backed-up routine_definition from pre-deployment checklist
CREATE OR REPLACE FUNCTION get_user_competition_entries(...)
AS $$ 
  -- paste backed up definition here
$$;
```

**Option 2 - Apply Previous Migration**
```bash
# Run previous migration that had UNION ALL
# File: supabase/migrations/20260205000000_fix_dashboard_aggregate_tickets_amounts.sql
```

### Expected Impact

**Positive:**
- ✅ Correct ticket counts in user dashboards
- ✅ Correct amount spent calculations
- ✅ Eliminates confusion from multiplied counts

**Performance:**
- Negligible impact (UNION vs UNION ALL on indexed tables)
- May be slightly faster due to fewer rows in GROUP BY

**User Experience:**
- Immediate fix - no cache clearing required
- No frontend changes needed
- Works retroactively for all historical data

### Monitoring

After deployment, monitor for:
1. **Error logs** in Supabase Dashboard → Logs
2. **User reports** of ticket counts
3. **Database performance** metrics (should be unchanged)

Check these queries for correctness:
```sql
-- Sample check: verify aggregation logic
SELECT 
  competition_id,
  COUNT(*) as entry_count,
  SUM(tickets_count) as total_tickets,
  SUM(amount_spent) as total_spent
FROM (
  -- Your get_user_competition_entries call here
) AS entries
GROUP BY competition_id;
```

### Support

**Documentation**: `docs/TICKET_COUNT_DUPLICATION_FIX.md`

**Key Files:**
- Migration: `supabase/migrations/20260211120000_fix_ticket_count_duplication.sql`
- Test: `supabase/migrations/test_20260211120000_ticket_count_fix.sql`
- Frontend: `src/lib/database.ts` (no changes needed)
- RPC Helper: `src/lib/supabase-rpc-helpers.ts` (no changes needed)

**Questions?** Reference the comprehensive documentation in `docs/TICKET_COUNT_DUPLICATION_FIX.md`

---

## Quick Reference

**Problem**: Ticket counts multiplied (250 → 1000)
**Cause**: `UNION ALL` keeps duplicate rows from multiple tables
**Fix**: Replace with `UNION` to deduplicate before aggregation
**Deploy**: Run `20260211120000_fix_ticket_count_duplication.sql` in Supabase
**Verify**: Run `test_20260211120000_ticket_count_fix.sql` and check user dashboards
**Impact**: Immediate fix, no frontend changes, negligible performance impact

---

**Deployment Date**: _____________
**Deployed By**: _____________
**Verification Complete**: ☐ Yes ☐ No
**Issues Found**: _____________
