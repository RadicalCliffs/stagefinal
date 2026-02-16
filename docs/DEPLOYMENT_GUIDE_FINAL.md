# DEPLOYMENT GUIDE - Dashboard Entries Fix

## Quick Summary

**Problem**: Base account transactions (`payment_provider='base_account'`, `type='entry'`) aren't showing up in entries tab, even though they shouldn't credit balance.

**Solution**: 3 migrations that work together.

---

## The Confusion Explained

### Previous Fix (CORRECT)
Migrations `20260202110900` and `20260202142500` made balance triggers skip `base_account`:
- ✅ **CORRECT**: Don't credit balance when user pays with base_account
- ✅ **CORRECT**: Already paid on-chain, don't double-credit

### Current Issue (SEPARATE)
Even though balance triggers correctly skip `base_account`, the **entries sync trigger** should STILL show these transactions:
- ❌ **BROKEN**: Base account entries not appearing in entries tab
- ✅ **CORRECT**: Topups (`type='topup'`) should NOT appear in entries

---

## Data Types & Expected Behavior

| Transaction | type | payment_provider | Should Show in Entries? | Should Touch Balance? |
|-------------|------|------------------|------------------------|----------------------|
| Topup | `topup` | `instant_wallet_topup` | ❌ NO | ✅ YES (credit) |
| Base Entry | `entry` | `base_account` | ✅ YES | ❌ NO (already paid) |
| Balance Entry | `purchase` | `balance_payment` | ✅ YES | ✅ YES (debit) |

---

## The 3 Migrations

### Migration 1: `20260216010000_backfill_base_account_entries.sql`
**What**: Backfills historical base_account entries
**Why**: Past transactions never got synced to competition_entries
**Impact**: 100+ missing base_account entries will appear

### Migration 2: `20260216010100_fix_balance_payment_tracking.sql`
**What**: Adds trigger to create user_transactions for balance purchases
**Why**: Balance purchases weren't creating transaction records
**Impact**: Future balance purchases will be tracked

### Migration 3: `20260216020000_verify_ongoing_sync_trigger.sql` ⚡ CRITICAL
**What**: Verifies/recreates the entries sync trigger with error handling
**Why**: Makes base_account entries sync automatically going forward
**Impact**: NEW base_account entries will appear immediately

---

## How The Triggers Work

### Balance Triggers (DON'T TOUCH - Already Correct)
```sql
-- From 20260202110900 and 20260202142500
IF NEW.payment_provider IN ('base_account', 'instant_wallet_topup', ...) THEN
  -- Skip - don't touch balance
  NEW.posted_to_balance := true;
  RETURN NEW;
END IF;
```
✅ This is CORRECT - base_account shouldn't credit balance

### Entries Sync Trigger (Fixed by Migration 3)
```sql
-- From 20260216020000
IF NEW.type != 'topup'              -- ✅ Excludes topups
   AND NEW.competition_id IS NOT NULL 
   AND NEW.status = 'completed'
   AND NEW.ticket_count > 0
THEN
  -- Sync to competition_entries
END IF;
```
✅ This is CORRECT - base_account with type='entry' DOES sync

**Key Point**: These are SEPARATE triggers! 
- Balance triggers = skip base_account (correct)
- Entries trigger = include base_account entries (correct)

---

## Deployment Steps

### 1. Backup Database
```sql
-- Backup key tables
pg_dump -t user_transactions > backup_user_transactions.sql
pg_dump -t competition_entries > backup_competition_entries.sql
pg_dump -t competition_entries_purchases > backup_competition_entries_purchases.sql
```

### 2. Apply Migrations in Order
```bash
# Apply all 3 migrations
psql -f supabase/migrations/20260216010000_backfill_base_account_entries.sql
psql -f supabase/migrations/20260216010100_fix_balance_payment_tracking.sql
psql -f supabase/migrations/20260216020000_verify_ongoing_sync_trigger.sql
```

### 3. Verify Migration 1 (Backfill)
```sql
-- Check that historical base_account entries were backfilled
SELECT COUNT(*) FROM competition_entries_purchases 
WHERE purchase_key LIKE 'ut_%';
-- Should see 100+ new records

SELECT canonical_user_id, competition_id, tickets_count, amount_spent
FROM competition_entries
ORDER BY updated_at DESC
LIMIT 20;
-- Should see entries with recent updated_at
```

### 4. Verify Migration 2 (Balance Tracking)
```sql
-- Check trigger exists
SELECT tgname, tgenabled FROM pg_trigger 
WHERE tgname = 'trg_record_balance_purchase';
-- Should return 1 row with tgenabled='O'
```

### 5. Verify Migration 3 (Ongoing Sync) ⚡
```sql
-- Check trigger exists with error handling
SELECT tgname, tgenabled FROM pg_trigger 
WHERE tgname = 'trg_sync_competition_entries_from_ut';
-- Should return 1 row with tgenabled='O'

-- Check unique constraint exists
SELECT conname FROM pg_constraint 
WHERE conname = 'ux_competition_entries_canonical_user_comp';
-- Should return 1 row
```

### 6. Test with Real Data
```sql
-- Insert a test base_account transaction
INSERT INTO user_transactions (
  canonical_user_id,
  type,
  amount,
  competition_id,
  payment_provider,
  status,
  ticket_count
) VALUES (
  'prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363',
  'entry',
  0.50,
  (SELECT id FROM competitions WHERE status='active' LIMIT 1),
  'base_account',
  'completed',
  2
);

-- Verify it appears in competition_entries
SELECT * FROM competition_entries 
WHERE canonical_user_id = 'prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363'
ORDER BY updated_at DESC LIMIT 1;
-- Should see new/updated entry

-- Verify it appears in competition_entries_purchases
SELECT * FROM competition_entries_purchases 
WHERE canonical_user_id = 'prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363'
ORDER BY purchased_at DESC LIMIT 1;
-- Should see new purchase record
```

---

## Expected Results After Deployment

### In Dashboard Entries Tab
✅ Historical base_account entries appear (100+)
✅ Historical balance_payment entries appear
✅ New base_account entries appear automatically
✅ New balance purchases appear automatically
❌ Topups do NOT appear (correct!)

### In Transactions Tab
✅ All transaction types appear (topups, entries, etc.)

### Balance Behavior
✅ Base_account entries DON'T credit balance (correct!)
✅ Balance purchases debit balance (correct!)
✅ Topups credit balance (correct!)

---

## Troubleshooting

### Base Account Entries Still Not Showing

**Check trigger is enabled:**
```sql
SELECT tgname, tgenabled FROM pg_trigger 
WHERE tgname = 'trg_sync_competition_entries_from_ut';
```

**Check for errors:**
```sql
-- Look at recent user_transactions
SELECT id, type, payment_provider, status, ticket_count, competition_id
FROM user_transactions 
WHERE payment_provider = 'base_account'
ORDER BY created_at DESC LIMIT 10;

-- Check if they're in competition_entries_purchases
SELECT COUNT(*) FROM competition_entries_purchases cep
WHERE cep.canonical_user_id IN (
  SELECT canonical_user_id FROM user_transactions 
  WHERE payment_provider = 'base_account' 
  AND type = 'entry'
  LIMIT 10
);
```

### Topups Appearing in Entries

**This should NOT happen** - check:
```sql
-- Verify topups have type='topup'
SELECT type, payment_provider, competition_id 
FROM user_transactions 
WHERE payment_provider = 'instant_wallet_topup'
LIMIT 10;

-- Should all have type='topup' and competition_id=NULL
```

---

## Rollback Plan

If something goes wrong:

```sql
-- 1. Disable triggers
ALTER TABLE user_transactions DISABLE TRIGGER trg_sync_competition_entries_from_ut;
ALTER TABLE joincompetition DISABLE TRIGGER trg_record_balance_purchase;

-- 2. Restore from backup
psql < backup_user_transactions.sql
psql < backup_competition_entries.sql
psql < backup_competition_entries_purchases.sql

-- 3. Re-enable original triggers if needed
```

---

## Key Takeaways

1. **Balance triggers** (skip base_account) = CORRECT, don't touch them
2. **Entries sync trigger** (include base_account entries) = Was broken, now fixed
3. These are SEPARATE concerns - both can be correct simultaneously
4. Migration 3 is the key to ongoing operation
5. The filter `type != 'topup'` is CORRECT - it excludes topups while including entries

---

## Summary

| Issue | Root Cause | Fix |
|-------|-----------|-----|
| Historical entries missing | Never synced | Migration 1 backfills |
| Balance purchases not tracked | No trigger | Migration 2 adds trigger |
| **New entries not appearing** | **Trigger broken/missing** | **Migration 3 fixes ongoing sync** |

All 3 migrations work together for complete fix.
