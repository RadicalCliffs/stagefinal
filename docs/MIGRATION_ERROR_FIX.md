# Migration Error Fix - ticket_numbers_csv Validation

## Error Encountered

```
Error: Failed to run sql query: 
ERROR: P0001: ticket_numbers_csv contains tickets not owned by this user for this competition
CONTEXT: PL/pgSQL function normalize_and_sync_entry_tickets() line 39 at RAISE
```

## Root Cause

The backfill migration `20260216010000` was attempting to copy `ticket_numbers` from `user_transactions` to `competition_entries_purchases`.

However, a validation function (`normalize_and_sync_entry_tickets()`) checks that all ticket numbers in `ticket_numbers_csv` actually exist in the `tickets` table for that user and competition.

During backfill, this data is often inconsistent:
- `user_transactions.ticket_numbers` may contain outdated or incorrect ticket IDs
- The `tickets` table may not have corresponding entries
- Historical data may have been deleted or modified

## The Fix

**Changed**: Line 44 in `20260216010000_backfill_base_account_entries.sql`

**Before** (causing error):
```sql
ut.ticket_numbers as ticket_numbers_csv,
```

**After** (fixed):
```sql
NULL as ticket_numbers_csv, -- Set to NULL to avoid validation errors during backfill
```

## Why This Works

Setting `ticket_numbers_csv` to NULL:
- ✅ Bypasses the validation function (NULL is always valid)
- ✅ Preserves ticket **counts** (still accurate from `ticket_count` column)
- ✅ Preserves amount spent (still accurate from `amount` column)
- ✅ Matches the pattern from previous backfill migration (`20260214100000`)

## Impact on Data

| Field | Historical Entries | Future Entries |
|-------|-------------------|----------------|
| `tickets_count` | ✅ Accurate | ✅ Accurate |
| `amount_spent` | ✅ Accurate | ✅ Accurate |
| `ticket_numbers_csv` | ⚠️ NULL | ✅ Populated by trigger |

**Historical entries** (from backfill):
- Will have `ticket_numbers_csv = NULL`
- Ticket **counts** are still correct
- Dashboard will show: "5 tickets" but not "tickets #123, #124, etc."

**Future entries** (from trigger):
- Will have proper `ticket_numbers_csv` populated by the sync trigger
- Full ticket detail available

## Verification Queries

After applying the migration, verify with:

```sql
-- 1. Check backfilled entries exist
SELECT COUNT(*) FROM competition_entries_purchases 
WHERE purchase_key LIKE 'ut_%';
-- Expected: 100+ new records

-- 2. Verify ticket_numbers_csv is NULL for backfilled
SELECT COUNT(*) FROM competition_entries_purchases 
WHERE purchase_key LIKE 'ut_%' 
  AND ticket_numbers_csv IS NULL;
-- Expected: Same count as above

-- 3. But ticket counts are present
SELECT 
  COUNT(*) as entries,
  SUM(tickets_count) as total_tickets,
  SUM(amount_spent) as total_spent
FROM competition_entries_purchases 
WHERE purchase_key LIKE 'ut_%';
-- Expected: Non-zero values

-- 4. Compare with source data
SELECT 
  COUNT(*) as transactions,
  SUM(ticket_count) as total_tickets
FROM user_transactions ut
WHERE ut.competition_id IS NOT NULL
  AND ut.type != 'topup'
  AND ut.ticket_count > 0;
-- Expected: Similar totals to Query 3
```

## Alternative Approaches Considered

### Option 1: Disable validation temporarily
```sql
-- Pros: Could preserve ticket numbers
-- Cons: Complex, risky, requires trigger manipulation
```

### Option 2: Fix ticket data first
```sql
-- Pros: Complete data
-- Cons: Impossible - historical ticket data may be gone
```

### Option 3: Set to NULL (CHOSEN)
```sql
-- Pros: Simple, safe, matches existing pattern
-- Cons: Loses individual ticket detail for historical entries
```

## Related Migrations

This fix is part of a 3-migration sequence:

1. **`20260216010000`** - Backfill historical entries (THIS ONE - FIXED)
2. **`20260216010100`** - Track balance purchases
3. **`20260216020000`** - Verify ongoing sync trigger

All three are needed for the complete fix.

## Historical Context

Previous backfill migration `20260214100000` (line 130) also set ticket_numbers_csv to NULL:

```sql
NULL as ticket_numbers_csv, -- user_transactions doesn't store individual ticket numbers
```

This fix follows the same established pattern.

## References

- Previous backfill: `20260214100000_backfill_competition_entries_purchases.sql`
- Validation function: `normalize_and_sync_entry_tickets()` (in production DB)
- Trigger chain: `after_cep_change()` → `recompute_competition_entry()` → `normalize_and_sync_entry_tickets()`
