# Payment Status Filtering Fix

**Date**: 2026-02-16  
**Migration**: `20260216000000_fix_payment_status_filtering.sql`  
**Issue**: Dashboard not showing balance payments and base payments

## Problem

The user dashboard had two critical issues:

1. **Transactions Tab**: Not pulling in balance payments
2. **Entries Tab**: Not pulling in base (Base network) payments

Both tabs were showing ticket counts and entries, but missing payment information for certain transaction types.

## Root Cause

The `get_comprehensive_user_dashboard_entries` RPC function was filtering transactions by:

```sql
AND ut.payment_status IN ('completed', 'confirmed')
```

However, many balance and base_account payments use `status='success'` which was **not included** in the filter. This caused these payments to be excluded from the dashboard.

## Payment Status Values Used

Based on codebase analysis, the following payment statuses are used:

- **`completed`**: Standard completion status
- **`confirmed`**: Confirmed transactions
- **`success`**: Used by balance payments, base_account payments, and various other payment providers
- `pending`: In-progress payments (excluded)
- `failed`: Failed payments (excluded)
- `cancelled`: Cancelled payments (excluded)

## Solution

Updated two database functions to include `'success'` in the payment status filter:

### 1. get_comprehensive_user_dashboard_entries

**Before**:
```sql
WHERE (ut.user_id = v_canonical_user_id OR ut.canonical_user_id = v_canonical_user_id)
  AND ut.payment_status IN ('completed', 'confirmed')
  AND ut.competition_id IS NOT NULL
```

**After**:
```sql
WHERE (ut.user_id = v_canonical_user_id OR ut.canonical_user_id = v_canonical_user_id)
  -- FIXED: Include ALL successful payment statuses
  AND ut.payment_status IN ('completed', 'confirmed', 'success')
  AND ut.competition_id IS NOT NULL
```

### 2. sync_competition_entries_from_user_transactions (Trigger)

**Before**:
```sql
IF NEW.type != 'topup' 
   AND NEW.competition_id IS NOT NULL 
   AND NEW.status IN ('completed', 'confirmed')
   AND NEW.ticket_count > 0
THEN
```

**After**:
```sql
IF NEW.type != 'topup' 
   AND NEW.competition_id IS NOT NULL 
   -- FIXED: Include ALL successful statuses
   AND NEW.status IN ('completed', 'confirmed', 'success')
   AND NEW.ticket_count > 0
THEN
```

## Testing

Added comprehensive tests in `src/lib/__tests__/dashboard-entries.test.ts`:

- ✅ Payment status filtering test suite (3 tests)
- ✅ Validates all successful statuses are included
- ✅ Validates excluded statuses (pending, failed) are not included
- ✅ Validates different payment providers work correctly

**Test Results**: 13/13 tests passing

## Payment Providers Affected

This fix enables the dashboard to show entries from ALL payment providers:

- **base_account**: Base Account SDK payments (uses `status='success'`)
- **balance**: Wallet balance deductions (uses `status='success'`)
- **coinbase_commerce**: Coinbase Commerce payments
- **coinbase_onramp**: Coinbase Onramp payments
- **privy_base_wallet**: Privy Base wallet payments
- And all other payment providers

## Deployment Steps

1. ✅ Create migration file
2. ✅ Add unit tests
3. ✅ Verify tests pass
4. 🔄 Apply migration to production database:
   ```bash
   # Using Supabase CLI
   supabase db push
   ```
5. 🔄 Verify in production dashboard
6. 🔄 Monitor for any errors

## Verification Checklist

After deployment, verify:

- [ ] Transactions tab shows balance payment entries
- [ ] Entries tab shows base payment entries
- [ ] Ticket counts are accurate
- [ ] Payment amounts are accurate
- [ ] No duplicate entries appear
- [ ] Historical payments are visible

## Related Files

- **Migration**: `supabase/migrations/20260216000000_fix_payment_status_filtering.sql`
- **Tests**: `src/lib/__tests__/dashboard-entries.test.ts`
- **Frontend Components**:
  - `src/components/UserDashboard/Orders/OrdersList.tsx` (Transactions tab)
  - `src/components/UserDashboard/Entries/EntriesList.tsx` (Entries tab)
- **Services**:
  - `src/services/dashboardEntriesService.ts`
  - `src/lib/database.ts`

## Notes

- The `get_user_transactions` RPC **does not** filter by payment_status, so it should already show all transactions. The issue was specific to the entries tab.
- The trigger ensures future transactions are automatically synced to competition_entries with the correct filtering
- This fix is backward-compatible and does not require any frontend changes
