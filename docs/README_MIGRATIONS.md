# Dashboard Entries Fix - README

## You Already Did Migrations 2 & 3?

**Just run this:**

```bash
psql -f supabase/migrations/20260216010000_backfill_base_account_entries.sql
```

**Done.** Check your dashboard - 100+ entries should appear.

---

## Documentation Quick Links

| Need | See |
|------|-----|
| 🚀 **Quick command** | [`QUICK_START.md`](./QUICK_START.md) |
| 📊 Check status | [`MIGRATION_STATUS_CHECK.md`](./MIGRATION_STATUS_CHECK.md) |
| 📖 Full guide | [`DEPLOYMENT_GUIDE_FINAL.md`](./DEPLOYMENT_GUIDE_FINAL.md) |
| 🔧 Fix errors | [`MIGRATION_ERROR_FIX.md`](./MIGRATION_ERROR_FIX.md) |
| 🎨 Understand | [`VISUAL_EXPLANATION.md`](./VISUAL_EXPLANATION.md) |

---

## The Fix in 3 Migrations

```
1️⃣ Backfill historical entries     ← Run this if you did 2 & 3
2️⃣ Track balance purchases         ← Already done? Skip
3️⃣ Verify ongoing sync             ← Already done? Skip
```

---

## Quick Verification

After running migration 1:

```sql
-- See backfilled entries
SELECT COUNT(*) FROM competition_entries_purchases 
WHERE purchase_key LIKE 'ut_%';

-- See them in competition_entries
SELECT canonical_user_id, tickets_count, amount_spent
FROM competition_entries
WHERE updated_at > NOW() - INTERVAL '1 hour'
LIMIT 10;
```

---

## What This Fixes

**Before**: Base account entries not showing in dashboard
**After**: 100+ historical entries appear + ongoing sync works

**Preserves**: 
- ✅ Balance trigger logic (no double crediting)
- ✅ Topup exclusion (topups stay hidden)
- ✅ All existing functionality

---

## Need Help?

1. **Quick start**: See [`QUICK_START.md`](./QUICK_START.md)
2. **Not sure what's applied**: See [`MIGRATION_STATUS_CHECK.md`](./MIGRATION_STATUS_CHECK.md)
3. **Full walkthrough**: See [`DEPLOYMENT_GUIDE_FINAL.md`](./DEPLOYMENT_GUIDE_FINAL.md)
4. **Error troubleshooting**: See [`MIGRATION_ERROR_FIX.md`](./MIGRATION_ERROR_FIX.md)

---

## Summary

If you already ran migrations 2 and 3, you're almost done!

**Just run migration 1 and you're set.** 🎉
