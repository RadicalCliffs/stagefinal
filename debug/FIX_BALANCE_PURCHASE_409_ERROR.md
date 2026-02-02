# Fix: Balance Purchase 409 Error

## Problem Statement

Users experienced HTTP 409 (Conflict) errors when attempting to purchase tickets with their balance, even when they had a valid reservation. The error message indicated:

```
Some selected tickets are no longer available
```

## Error Trace

From the browser console:
```
[PaymentModal] Using existing reservation with selected tickets: Array(1)
[PaymentModal] Purchasing with balance, reservation: 4fa65642-701a-4e16-84f0-a1b5e7da3fd6
[BalancePayment] Purchasing with balance (simplified system): Object
mthwfldcjvpxjtmrqkqm.supabase.co/functions/v1/purchase-tickets-with-bonus:1   
  Failed to load resource: the server responded with a status of 409 ()
[BalancePayment] Purchase error: Object
[PaymentModal] Purchase failed: Edge Function returned a non-2xx status code
```

## Root Cause

The `balance-payment-service.ts` file's `purchaseWithBalance()` method was receiving `reservationId` as a parameter from the PaymentModal component but **was not including it** in the request body sent to the `purchase-tickets-with-bonus` edge function.

### Flow Before Fix

1. User reserves tickets → creates reservation with ID
2. PaymentModal calls `BalancePaymentService.purchaseWithBalance({ reservationId, ... })`
3. Service receives `reservationId` but doesn't include it in request body
4. Edge function receives request **without** `reservation_id`
5. Edge function validates tickets against **global unavailable set** (includes reserved tickets)
6. Edge function returns 409: "Some selected tickets are no longer available"

### Why This Caused 409 Errors

Without the `reservation_id`, the edge function didn't know that:
- The user had a valid reservation for these specific tickets
- These tickets should be treated as "held" for this user
- The reservation is the authoritative source of truth

Instead, the edge function checked if the tickets were available globally, which they were NOT because they were already marked as reserved (in `pending_tickets` table).

## Solution

### Changes Made

**File: `src/lib/balance-payment-service.ts`**

1. **Extract `reservationId` from params** (line 297):
   ```typescript
   const { competitionId, ticketNumbers, userId, ticketPrice, reservationId } = params;
   ```

2. **Created type-safe interface** (lines 53-64):
   ```typescript
   export interface EdgeFunctionPurchaseRequest {
     userId: string;
     competition_id: string;
     numberOfTickets: number;
     ticketPrice: number;
     tickets: Array<{ ticket_number: number }>;
     idempotent: boolean;
     reservation_id?: string;  // Optional: enables reservation-based flow
   }
   ```

3. **Include `reservation_id` in request body** (lines 344-347):
   ```typescript
   // Include reservation_id if provided - critical for bypassing availability checks
   if (reservationId) {
     requestBody.reservation_id = reservationId;
   }
   ```

4. **Added debug logging** (line 355):
   ```typescript
   reservationId: reservationId || 'none'
   ```

### Flow After Fix

1. User reserves tickets → creates reservation with ID
2. PaymentModal calls `BalancePaymentService.purchaseWithBalance({ reservationId, ... })`
3. Service includes `reservation_id` in request body
4. Edge function receives request **with** `reservation_id`
5. Edge function looks up reservation and uses its tickets as **authoritative source**
6. Edge function **bypasses** global availability validation
7. Edge function completes purchase successfully ✅

## Edge Function Behavior

The `purchase-tickets-with-bonus` edge function has built-in logic to handle reservations:

```typescript
if (reservationRecord && reservedTicketNumbers && reservedTicketNumbers.length > 0) {
  // RESERVATION MODE: Use reservation tickets as the ONLY source of truth
  // Do NOT revalidate against global unavailable sets - the reservation already holds these tickets
  userSelectedTickets = reservedTicketNumbers;
  console.log('[purchase-tickets-with-bonus] Using reservation tickets (bypassing global availability check)');
} else {
  // NO RESERVATION: Use client-supplied selectedTickets and validate against global unavailable
  userSelectedTickets = Array.isArray(selectedTickets) && selectedTickets.length > 0
    ? selectedTickets.map(n => Number(n)).filter(n => Number.isFinite(n) && n > 0)
    : [];
  
  // Only validate against unavailable tickets when NOT using a reservation
  if (userSelectedTickets.length > 0) {
    const unavailableSelected = userSelectedTickets.filter(t => unavailableTickets.has(t));
    if (unavailableSelected.length > 0) {
      return new Response(/* 409 error */, { status: 409 });
    }
  }
}
```

This logic was being bypassed because `reservationId` was missing.

## Impact

### Before Fix
- ❌ Balance purchases with reservations failed with 409 errors
- ❌ Users couldn't complete ticket purchases even with valid reservations
- ❌ Poor user experience with confusing error messages

### After Fix
- ✅ Balance purchases with reservations succeed
- ✅ Edge function correctly identifies and uses reservations
- ✅ Tickets are purchased without availability conflicts
- ✅ Better debugging with reservation ID in logs

## Testing Recommendations

1. **Manual Test Flow**:
   - User logs in and tops up balance
   - User selects specific tickets in a competition
   - User clicks "Purchase with Balance"
   - System creates reservation
   - System purchases tickets using reservation
   - Verify: Purchase succeeds without 409 error
   - Verify: Tickets appear in user's dashboard
   - Verify: Balance is correctly debited

2. **Check Logs**:
   - Confirm `reservationId` appears in console logs:
     ```
     [BalancePayment] Purchasing with balance (simplified system): {
       userId: "prize:pid:0xf6a7...",
       competitionId: "6f6eb8f6-b...",
       ticketCount: 1,
       ticketPrice: 1,
       tickets: [42],
       reservationId: "4fa65642-701a-4e16-84f0-a1b5e7da3fd6"  // ✅ Now present
     }
     ```
   - Confirm edge function uses reservation:
     ```
     [purchase-tickets-with-bonus] Using reservation tickets (bypassing global availability check): [42]
     ```

3. **Edge Cases**:
   - Purchase without reservation (lucky dip) should still work
   - Expired reservations should return 410 error
   - Invalid reservations should return 404 error
   - Ticket count mismatch should return 400 error

## Security Considerations

- No security vulnerabilities introduced
- Type safety improved with `EdgeFunctionPurchaseRequest` interface
- No changes to authorization or authentication logic
- CodeQL scan: 0 alerts

## Files Changed

1. `src/lib/balance-payment-service.ts`:
   - Added `EdgeFunctionPurchaseRequest` interface (+13 lines)
   - Modified `purchaseWithBalance()` method (+7 lines)
   - Total: 20 lines changed

## Related Documentation

- `BALANCE_PAYMENT_MIGRATION.md` - Overall balance payment system documentation
- `FIX_PURCHASE_TICKETS_BONUS_SUMMARY.md` - Previous fix for schema mismatches
- `supabase/functions/purchase-tickets-with-bonus/index.ts` - Edge function implementation

## Conclusion

This was a simple but critical bug where a parameter was received but not forwarded to the downstream service. The fix ensures that reservation-based purchases work correctly by allowing the edge function to recognize and honor existing reservations, bypassing unnecessary availability checks that would otherwise cause false 409 conflicts.
