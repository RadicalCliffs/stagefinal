# Quick Start - What to Run NOW 🚀

## You Already Did 2 & 3? Here's What to Do:

### ✅ Step 1: Just Run Migration 1

```bash
psql -f supabase/migrations/20260216010000_backfill_base_account_entries.sql
```

### ✅ Step 2: Verify It Worked

```sql
SELECT COUNT(*) FROM competition_entries_purchases 
WHERE purchase_key LIKE 'ut_%';
```

**Expected**: 100+ new records

### ✅ Step 3: Check Dashboard

1. Log into your dashboard
2. Go to "My Entries"
3. See 100+ entries that were missing before

**Done!** 🎉

---

## Visual Overview

```
Your Current State:
┌─────────────────────────────────────────┐
│ ✅ Migration 2 - Already Applied        │
│    (Balance purchase tracking)          │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ ✅ Migration 3 - Already Applied        │
│    (Ongoing sync trigger)               │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ ⏳ Migration 1 - NEEDS TO RUN           │
│    (Backfill historical entries)        │
│                                         │
│    👉 RUN THIS ONE NOW! 👈             │
└─────────────────────────────────────────┘
```

---

## What Each Migration Does

```
Migration 1: Backfills PAST transactions
├─ Fixes: 100+ missing historical entries
└─ Status: 🔴 NOT APPLIED YET

Migration 2: Tracks FUTURE balance purchases  
├─ Creates trigger for balance payments
└─ Status: ✅ ALREADY APPLIED

Migration 3: Ensures ONGOING sync works
├─ Verifies entries sync automatically
└─ Status: ✅ ALREADY APPLIED
```

---

## One Command Solution

If you already have 2 & 3 applied, literally just run:

```bash
cd /path/to/repo
psql -d your_database -f supabase/migrations/20260216010000_backfill_base_account_entries.sql
```

Replace `your_database` with your actual database name.

---

## Not Sure What You've Applied?

No problem! Run all 3 - they're safe to rerun:

```bash
psql -f supabase/migrations/20260216010000_backfill_base_account_entries.sql
psql -f supabase/migrations/20260216010100_fix_balance_payment_tracking.sql
psql -f supabase/migrations/20260216020000_verify_ongoing_sync_trigger.sql
```

---

## Expected Timeline

```
┌──────────────────────────────────────────────────────────┐
│ Before Migration 1                                       │
├──────────────────────────────────────────────────────────┤
│ Dashboard: 0 entries from base_account                   │
│ Entries Tab: Empty or very few entries                   │
│ User Frustration: High 😤                                │
└──────────────────────────────────────────────────────────┘
                         ↓
                 Run Migration 1
                         ↓
┌──────────────────────────────────────────────────────────┐
│ After Migration 1                                        │
├──────────────────────────────────────────────────────────┤
│ Dashboard: 100+ entries appear! 🎉                       │
│ Entries Tab: Shows all historical purchases              │
│ User Satisfaction: High 😊                               │
└──────────────────────────────────────────────────────────┘
```

---

## Troubleshooting

### Problem: "Permission denied"

**Solution**: Run with appropriate user:
```bash
psql -U postgres -d your_db -f migration.sql
```

### Problem: "Database not found"

**Solution**: Check database name:
```bash
psql -l  # List all databases
psql -d correct_database_name -f migration.sql
```

### Problem: "Migration fails with error"

**Solution**: Check error message and see:
- `docs/MIGRATION_ERROR_FIX.md` - Common errors
- `docs/MIGRATION_STATUS_CHECK.md` - Detailed guide

---

## Summary

**If you already applied 2 & 3:**
- ✅ Skip migrations 2 & 3
- ✅ Only run migration 1
- ✅ Takes ~5 seconds
- ✅ Fixes 100+ missing entries

**One command. That's it.**

```bash
psql -f supabase/migrations/20260216010000_backfill_base_account_entries.sql
```
