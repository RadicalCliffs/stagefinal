# Dashboard Payment Issues - Complete Fix Summary

## Problem Statement

User reported two critical issues:
1. **100+ base account transactions** in `user_transactions` but **NONE showing in entries tab**
2. **Balance payments not being tracked** properly in transactions/entries tabs

## Data Analysis

### user_transactions Table
Analyzed 100 real records showing:
- **Base Account**: `type='entry'`, `payment_provider='base_account'`, all have `competition_id` + `ticket_count`
- **Balance Payments**: `type='purchase'`, `payment_provider='balance_payment'`, all have `competition_id` + `ticket_count`
- **All completed**: `status='completed'` and `payment_status='completed'`

### balance_ledger Table  
Analyzed 100 real records showing:
- Separate ledger for tracking balance debits/credits
- Uses `transaction_type` (deposit, debit, credit)
- Debit entries reference competitions: `entry_{competition_id}_{timestamp}`
- **NOT displayed in dashboard** (just internal ledger)

## Root Causes

### Issue 1: Base Account Entries Not Showing
Previous backfill migration filtered by:
```sql
ut.type IN ('purchase', 'competition_entry', 'ticket_purchase')
```

**Problem**: This excluded `type='entry'` which is used by base_account transactions!
**Result**: 100+ valid base_account transactions never got into `competition_entries` table

### Issue 2: Inconsistent Balance Payment Tracking
- Some balance purchases create `user_transactions` with `type='purchase'`
- But the flow isn't consistent - some may bypass transaction creation
- No guarantee future balance purchases will create tracking records

## Solution

### Migration 1: Backfill All Historical Transactions
File: `supabase/migrations/20260216010000_backfill_base_account_entries.sql`

**Changes**:
1. Removes type restriction from backfill query
2. New filter: `type != 'topup' AND competition_id IS NOT NULL AND ticket_count > 0`
3. Backfills to `competition_entries_purchases` table
4. Aggregates to `competition_entries` for dashboard display

**Impact**:
- ✅ Includes base_account transactions (`type='entry'`)
- ✅ Includes balance_payment transactions (`type='purchase'`)
- ✅ All 100+ missing transactions will appear in entries tab

### Migration 2: Fix Future Balance Payment Tracking
File: `supabase/migrations/20260216010100_fix_balance_payment_tracking.sql`

**Changes**:
1. Creates helper function `record_balance_purchase_transaction()`
2. Adds trigger on `joincompetition` table to auto-create transactions
3. Sets `payment_provider='balance'` for proper categorization
4. Prevents duplicates using `ON CONFLICT (tx_id)`

**Impact**:
- ✅ Future balance purchases automatically tracked
- ✅ Creates `user_transactions` with proper payment_provider
- ✅ Will show in both transactions and entries tabs

## Verification Steps

### After Applying Migrations

1. **Check backfill success**:
   ```sql
   -- Should show 100+ records
   SELECT COUNT(*) FROM competition_entries_purchases 
   WHERE purchase_key LIKE 'ut_%';
   
   -- Check base_account entries
   SELECT COUNT(*) 
   FROM user_transactions ut
   JOIN competition_entries_purchases cep ON 'ut_' || ut.id::text = cep.purchase_key
   WHERE ut.payment_provider = 'base_account';
   ```

2. **Verify entries tab**:
   - Navigate to user dashboard
   - Check "Entries" tab
   - Should show all 100+ base_account transactions
   - Should show balance_payment transactions

3. **Test new balance purchase**:
   - Make a new ticket purchase using wallet balance
   - Check `user_transactions` for new record
   - Verify `payment_provider='balance'`
   - Verify appears in both tabs

## Technical Details

### Data Flow Before Fix
```
Balance Purchase → sub_account_balances (debit)
                → joincompetition (record created)
                → tickets (created)
                → user_transactions (SOMETIMES created ❌)
                → competition_entries (NEVER backfilled for type='entry' ❌)
```

### Data Flow After Fix
```
Balance Purchase → sub_account_balances (debit)
                → joincompetition (record created)
                → TRIGGER creates user_transactions ✅
                → tickets (created)
                → competition_entries (backfilled for ALL types ✅)
```

### Payment Provider Values
- `base_account` - Onchain wallet payments (Base network)
- `balance` - Internal wallet balance deductions
- `balance_payment` - Historical balance payments (legacy)
- `coinbase_onramp` - Fiat purchases via Coinbase
- `instant_wallet_topup` - Wallet top-ups

## Files Changed

1. `supabase/migrations/20260216010000_backfill_base_account_entries.sql` - Backfill historical
2. `supabase/migrations/20260216010100_fix_balance_payment_tracking.sql` - Fix future tracking

## Deployment Checklist

- [ ] Review migration SQL
- [ ] Backup production database
- [ ] Apply migration 20260216010000 (backfill)
- [ ] Verify backfill counts in logs
- [ ] Apply migration 20260216010100 (tracking fix)
- [ ] Test entries tab shows all transactions
- [ ] Test new balance purchase creates transaction
- [ ] Monitor for any errors

## Known Limitations

1. **Trigger-based solution**: Migration 2 uses a trigger on `joincompetition` rather than modifying the RPC directly. This is a workaround that should work but ideally the `purchase_tickets_with_balance` RPC should call `record_balance_purchase_transaction()` directly.

2. **Historical balance_ledger**: The `balance_ledger` table is separate and not used for dashboard display. It's just for internal ledger tracking.

3. **Duplicate prevention**: Uses `ON CONFLICT (tx_id)` which requires `tx_id` to be set. If `tx_id` is NULL, duplicates might occur (though unlikely given the transaction flow).

## Success Criteria

✅ All 100+ base_account transactions appear in entries tab
✅ Balance payments show in transactions tab  
✅ New balance purchases create tracking records
✅ Dashboard shows accurate totals
✅ No duplicate entries
✅ Performance not impacted

## Rollback Plan

If issues occur:
```sql
BEGIN;
-- Remove backfilled entries
DELETE FROM competition_entries_purchases WHERE purchase_key LIKE 'ut_%';
-- Drop trigger
DROP TRIGGER IF EXISTS trg_sync_balance_purchase_to_user_transactions ON joincompetition;
-- Drop function
DROP FUNCTION IF EXISTS record_balance_purchase_transaction;
DROP FUNCTION IF EXISTS sync_balance_purchase_to_user_transactions;
COMMIT;
```
