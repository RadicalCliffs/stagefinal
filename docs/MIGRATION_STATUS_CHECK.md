# Migration Status Check Guide

## Quick Answer

**If you already applied migrations 2 and 3, you do NOT need to run them again.**

Only apply **Migration 1** (the one that was just fixed).

---

## The 3 Migrations

| # | File | Purpose | Rerun Needed? |
|---|------|---------|---------------|
| 1 | `20260216010000_backfill_base_account_entries.sql` | Backfills historical entries | ✅ **YES** (just fixed) |
| 2 | `20260216010100_fix_balance_payment_tracking.sql` | Balance purchase tracking | ❌ NO (if already applied) |
| 3 | `20260216020000_verify_ongoing_sync_trigger.sql` | Ongoing sync verification | ❌ NO (if already applied) |

---

## How to Check What's Applied

### Method 1: Check Migration History

```sql
-- See all applied migrations from Feb 2026
SELECT version, name 
FROM supabase_migrations.schema_migrations 
WHERE version LIKE '202602%'
ORDER BY version DESC;
```

Look for these versions:
- `20260216010000` - Migration 1
- `20260216010100` - Migration 2
- `20260216020000` - Migration 3

### Method 2: Check if Triggers Exist

```sql
-- Check migration 2 trigger (balance purchases)
SELECT tgname, tgenabled 
FROM pg_trigger 
WHERE tgname = 'trg_record_balance_purchase';
-- If exists: Migration 2 was applied

-- Check migration 3 trigger (entries sync)
SELECT tgname, tgenabled 
FROM pg_trigger 
WHERE tgname = 'trg_sync_competition_entries_from_ut';
-- If exists: Migration 3 was applied
```

### Method 3: Check Function Exists

```sql
-- Check if migration 2 function exists
SELECT proname 
FROM pg_proc 
WHERE proname = 'record_balance_purchase_transaction';
-- If exists: Migration 2 was applied

-- Check if migration 3 function exists
SELECT proname 
FROM pg_proc 
WHERE proname = 'sync_competition_entries_from_user_transactions';
-- If exists: Migration 3 was applied
```

---

## Decision Matrix

### Scenario 1: Already Applied 2 & 3

**What to do:**
```bash
# Only apply migration 1
psql -f supabase/migrations/20260216010000_backfill_base_account_entries.sql
```

**Why:** Migrations 2 and 3 are already in place. Migration 1 was just fixed to resolve the validation error.

### Scenario 2: Not Sure What's Applied

**What to do:**
```bash
# Safe to run all 3 in order
psql -f supabase/migrations/20260216010000_backfill_base_account_entries.sql
psql -f supabase/migrations/20260216010100_fix_balance_payment_tracking.sql
psql -f supabase/migrations/20260216020000_verify_ongoing_sync_trigger.sql
```

**Why:** Migrations 2 and 3 use `CREATE OR REPLACE` so they're safe to rerun. They won't break anything.

### Scenario 3: Want to Start Fresh

**What to do:**
```bash
# Apply all 3 in order
psql -f supabase/migrations/20260216010000_backfill_base_account_entries.sql
psql -f supabase/migrations/20260216010100_fix_balance_payment_tracking.sql
psql -f supabase/migrations/20260216020000_verify_ongoing_sync_trigger.sql
```

**Why:** Complete fresh application of all fixes.

---

## Verification After Running Migration 1

### Check Backfilled Entries

```sql
-- Should see 100+ new entries
SELECT COUNT(*) FROM competition_entries_purchases 
WHERE purchase_key LIKE 'ut_%';

-- Check they have NULL ticket_numbers_csv (expected)
SELECT COUNT(*) FROM competition_entries_purchases 
WHERE purchase_key LIKE 'ut_%' 
  AND ticket_numbers_csv IS NULL;

-- Verify aggregation worked
SELECT 
  canonical_user_id,
  competition_id,
  tickets_count,
  amount_spent
FROM competition_entries
WHERE canonical_user_id IN (
  SELECT DISTINCT canonical_user_id 
  FROM competition_entries_purchases 
  WHERE purchase_key LIKE 'ut_%'
  LIMIT 5
);
```

### Check Dashboard Display

1. Log into dashboard as a user who had missing entries
2. Navigate to "My Entries" or equivalent
3. Verify 100+ entries now appear
4. Check ticket counts are accurate

---

## Common Questions

### Q: Will running migrations 2 & 3 again break anything?

**A:** No, they're safe to rerun. They use:
- `CREATE OR REPLACE FUNCTION` - Replaces if exists
- `DROP TRIGGER IF EXISTS` - Safe removal
- `CREATE TRIGGER` - Fresh creation

### Q: What if migration 1 fails again?

**A:** Check the error message. The validation error should be fixed now. If you see:
- `ticket_numbers_csv contains tickets not owned` - Should NOT happen anymore
- Other errors - Share the full error message

### Q: Do I need to restart services?

**A:** No, database changes take effect immediately. No service restart needed.

### Q: How long does migration 1 take?

**A:** Depends on data volume:
- 100 transactions: ~1-2 seconds
- 1,000 transactions: ~5-10 seconds
- 10,000 transactions: ~30-60 seconds

---

## Summary

**Most Common Case:**
- Already ran 2 & 3? ✅ Just run migration 1
- Result: Historical entries backfilled, dashboard fixed

**Safe Approach:**
- Run all 3 migrations in order
- Migrations 2 & 3 are idempotent (safe to rerun)
- Result: Everything up to date

**Verification:**
- Check `competition_entries_purchases` count
- Check dashboard displays entries
- Check no errors in logs
