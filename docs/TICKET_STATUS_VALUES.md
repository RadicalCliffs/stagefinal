# Ticket Status Values - Critical Reference

## ⚠️ IMPORTANT: Valid Ticket Status Values

The `tickets` table has a CHECK constraint that **ONLY** allows these status values:

```sql
status CHECK (status = ANY (ARRAY[
  'available',
  'reserved',
  'confirmed',
  'sold',
  'refunded'
]))
```

## Common Mistakes to Avoid

### ❌ INVALID Status Values (DO NOT USE):
- `'active'` - NOT a valid ticket status
- `'purchased'` - NOT a valid ticket status
- `'pending'` - NOT a valid ticket status
- `'completed'` - NOT a valid ticket status

### ✅ CORRECT Usage by Purpose:

#### For Owned/Sold Tickets (user has purchased):
```sql
WHERE t.status IN ('sold', 'confirmed')
```

#### For Available Tickets (can be purchased):
```sql
WHERE t.status = 'available'
```

#### For Reserved Tickets (temporarily held):
```sql
WHERE t.status = 'reserved'
```

#### For Refunded Tickets (was purchased but refunded):
```sql
WHERE t.status = 'refunded'
```

## Known Issues Fixed

### Issue: Owned Tickets Not Showing Green
**Date**: 2026-02-11
**Migration**: `20260211100000_fix_owned_tickets_status_filter.sql`

**Problem**: Multiple database functions were using invalid status values:
- `get_user_active_tickets` RPC used `'active'` (invalid)
- `v_competition_ticket_stats` view used `'purchased'` (invalid)

**Impact**: Queries returned 0 results because invalid status values never match any rows.

**Fix**: Updated all queries to use only valid status values:
```sql
-- Before (BROKEN):
WHERE t.status IN ('sold', 'active')      -- 'active' is invalid!
WHERE t.status IN ('sold', 'purchased')   -- 'purchased' is invalid!

-- After (FIXED):
WHERE t.status IN ('sold', 'confirmed')   -- Both are valid ✓
```

## Validation Checklist

Before deploying any SQL that filters tickets by status:

1. ✅ Check that ALL status values are in the valid list above
2. ✅ Test the query returns expected results
3. ✅ Verify the query doesn't use `'active'` or `'purchased'`
4. ✅ Consider if `'reserved'` tickets should be included
5. ✅ Document why specific statuses are included/excluded

## When to Include Reserved Tickets

**Include `'reserved'`** in these scenarios:
- User overview (showing all user activity including pending)
- Availability calculations (reserved tickets are temporarily unavailable)

**Exclude `'reserved'`** in these scenarios:
- Owned tickets display (user hasn't paid yet)
- Final ticket counts (not yet sold)
- Competition winners (only confirmed purchases)

## References

- Schema definition: `/supabase/migrations/00000000000000_new_baseline.sql` line 383
- Fixed RPC: `/supabase/migrations/20260211100000_fix_owned_tickets_status_filter.sql`
- Frontend usage: `/src/lib/getOwnedTicketsForCompetition.ts`

## Related Issues

- [Issue #2: Owned tickets not showing in green](https://github.com/teamstack-xyz/theprize.io/issues/XXX)
- Root cause: Invalid ticket status values in SQL queries
- Solution: Database migration correcting all affected queries
