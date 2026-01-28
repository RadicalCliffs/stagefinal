# Balance Payment Migration - New 3-Endpoint Flow

## Overview

This migration replaces all previous balance payment logic with a new, simplified 3-endpoint flow. The new system eliminates redundant RPC calls, realtime checks on the omnipotent data service, and complex fallback logic.

## Changes Made

### 1. New Balance Payment Service (`src/lib/balance-payment-service.ts`)

A clean, focused service that implements the exact flow specified:

#### Endpoints Used:
- **POST /functions/v1/reserve-tickets** - Reserve tickets via pending_tickets
- **POST /functions/v1/purchase-tickets-with-bonus** - Purchase with balance and materialize tickets
- **POST /functions/v1/process-balance-payments** - Optional status verification (read-only)

#### Key Features:
- Automatic idempotency key generation
- Proper error parsing and user-friendly messages
- Error type detection (validation, conflict, expired, insufficient_balance, etc.)
- Balance-updated event dispatching for UI refresh
- Convenience method `reserveAndPurchase()` for single-call flow

### 2. Updated Components

#### `src/lib/ticketPurchaseService.ts`
- Replaced `purchaseTicketsWithBalance()` with new implementation
- Now uses `BalancePaymentService` for all balance operations
- Simplified flow: reserve (if needed) → purchase → success
- Maintains backward-compatible response format

#### `src/hooks/useOmnipotentData.ts`
- Updated `useTicketReservation()` hook to use new reserve endpoint
- Removed dependency on omnipotent data service reservation logic
- Maintains all existing hook features (storage, recovery, etc.)

#### `src/components/PaymentModal.tsx`
- Simplified `handleBalancePayment()` by removing:
  - `finalize_purchase2` RPC fallback
  - `execute_balance_payment` RPC fallback
  - Complex multi-layer error handling
- Now follows clean linear flow: validate → reserve → purchase → success
- Better error messaging based on error types

### 3. Removed Dependencies

- No longer uses `executeBalancePaymentRPC` from ticketPurchaseService
- No longer uses `finalizeBalancePayment` from ticketPurchaseService
- Removed omnipotent data service realtime checks for balance payments

## What Wasn't Changed

### Still Working:
- All non-balance payment methods (Base USDC, Coinbase Commerce, etc.)
- Reservation storage and recovery
- Balance display and refresh
- Entry notifications
- Competition sold-out checks
- All UI states and animations

### Intentionally Preserved:
- Old RPC functions still exist in ticketPurchaseService.ts but are not called
- Omnipotent data service structure (only reservation method updated)
- All existing hooks and contexts

## Testing Checklist

### Functional Tests:
- [ ] Reserve tickets with specific ticket numbers
- [ ] Reserve tickets with ticket count (auto-select)
- [ ] Purchase with balance (with existing reservation)
- [ ] Purchase with balance (without reservation - auto-create)
- [ ] Handle insufficient balance error
- [ ] Handle expired reservation error
- [ ] Handle ticket conflict (already sold)
- [ ] Network retry with same idempotency key
- [ ] Balance updates correctly in UI after purchase
- [ ] Entries appear immediately after purchase
- [ ] Notifications sent after successful purchase

### Edge Cases:
- [ ] Reservation expires during purchase flow
- [ ] Network failure during reserve step
- [ ] Network failure during purchase step
- [ ] Multiple rapid purchases (idempotency)
- [ ] Page refresh with active reservation
- [ ] Browser back/forward with reservation

### Integration Tests:
- [ ] Works with Base wallet authentication
- [ ] Works with Privy authentication
- [ ] Works with CDP wallet
- [ ] Top-up wallet still works
- [ ] Other payment methods unchanged

## Deployment Notes

### Prerequisites:
The following Edge Functions must be deployed:
- `/functions/v1/reserve-tickets`
- `/functions/v1/purchase-tickets-with-bonus`
- `/functions/v1/process-balance-payments`

### Database Indexes (Recommended):
```sql
CREATE INDEX IF NOT EXISTS idx_sub_balances_cuid_currency ON public.sub_account_balances(canonical_user_id, currency);
CREATE INDEX IF NOT EXISTS idx_payments_reservation ON public.payments(reservation_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_idem ON public.payments(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_pending_tickets_reservation ON public.pending_tickets(reservation_id);
CREATE INDEX IF NOT EXISTS idx_pending_items_pending ON public.pending_ticket_items(pending_ticket_id);
CREATE INDEX IF NOT EXISTS idx_tickets_comp_ticket ON public.tickets(competition_id, ticket_number);
```

### Monitoring:
Watch for these log patterns:
- `[BalancePayment]` - All balance payment service logs
- `[PaymentModal]` - Payment modal flow logs
- `[useTicketReservation]` - Hook-level reservation logs

## Rollback Plan

If issues arise, rollback involves:
1. Revert the three commits that implemented this change
2. The old RPC functions are still in place and can be re-wired
3. Edge Functions remain backward compatible

## Future Improvements

### Potential Optimizations:
1. Add reservation countdown timer in UI
2. Pre-validate balance before showing payment options
3. Cache unavailable tickets more aggressively
4. Add retry queue for failed network requests
5. Implement optimistic UI updates during reservation

### Cleanup:
1. Remove unused RPC functions after confidence period
2. Deprecate old omnipotent data reservation logic
3. Consolidate error handling utilities
