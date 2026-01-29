# Balance Payment Fix - Implementation Summary

## Problem Statement

The "pay with balance" feature was failing with a 422 HTTP error. The error logs showed:

```
POST https://mthwfldcjvpxjtmrqkqm.supabase.co/functions/v1/purchase-tickets-with-bonus 422 (Unprocessable Content)
Error: "competition_id could not be resolved from reservation_id"
Details: {
  "reservation_found": false,
  "reservation_has_competition_id": false
}
```

The root cause was that the frontend was only sending `reservation_id` to the backend, and the backend couldn't find the reservation in the database to look up the required `competition_id` and other fields.

## Solution - Best Practice Approach

Instead of relying on backend database lookups (which can fail), we now pass **all required data directly** in the purchase request. This is the "best practice" approach recommended by the user.

### Changes Made

#### 1. Updated `PurchaseRequest` Interface (balance-payment-service.ts)

```typescript
export interface PurchaseRequest {
  reservation_id: string;
  idempotency_key: string;
  // Best practice: include all required data directly, don't rely on lookups
  competition_id?: string;
  canonical_user_id?: string;
  ticket_numbers?: number[];
  ticket_count?: number;
  ticket_price?: number;
}
```

#### 2. Updated `purchaseWithBalance()` Method (balance-payment-service.ts)

The method now:
- Accepts optional parameters: `competitionId`, `userId`, `ticketNumbers`, `ticketCount`, `ticketPrice`
- Converts `userId` to canonical format if provided
- Conditionally adds all fields to the request body
- Provides enhanced logging for debugging

```typescript
static async purchaseWithBalance(params: {
  reservationId: string;
  competitionId?: string;
  userId?: string;
  ticketNumbers?: number[];
  ticketCount?: number;
  ticketPrice?: number;
}): Promise<...>
```

#### 3. Updated PaymentModal Call (PaymentModal.tsx)

The purchase call now passes all available data:

```typescript
const purchaseResult = await BalancePaymentService.purchaseWithBalance({
  reservationId: currentReservationId,
  competitionId: competitionId,
  userId: canonicalUserId,
  ticketNumbers: selectedTickets.length > 0 ? selectedTickets : undefined,
  ticketCount: selectedTickets.length > 0 ? selectedTickets.length : ticketCount,
  ticketPrice: ticketPrice
});
```

## How It Works

### Before (Failing Approach)
1. Frontend creates reservation → gets `reservation_id`
2. Frontend sends only `reservation_id` to purchase endpoint
3. Backend tries to look up reservation in database
4. **FAILURE**: Reservation not found or missing data
5. Backend returns 422 error

### After (Best Practice Approach)
1. Frontend creates reservation → gets `reservation_id`
2. Frontend has all data: `competition_id`, `user_id`, `ticket_numbers`, `ticket_count`, `ticket_price`
3. Frontend sends **all data directly** to purchase endpoint
4. Backend uses provided data immediately (no lookup needed)
5. **SUCCESS**: Purchase completes instantly

## Backend Compatibility

The backend (`purchase-tickets-with-bonus/index.ts`) already supports this approach! The function has "tolerant parameter parsing" that accepts:
- `competition_id` or `competitionId`
- `canonical_user_id` or `userId`
- `ticket_numbers` or `selected_tickets`
- `ticket_count` or `numberOfTickets`
- `ticket_price` or `price`

The backend logic (lines 661-690) shows:
```typescript
if (!competitionId) {
  competitionId = reservation.competition_id;  // Only lookup if not provided
}
if (!numberOfTickets) {
  numberOfTickets = reservation.ticket_count;  // Only lookup if not provided
}
// etc...
```

This means:
- ✅ When we provide the fields → Backend uses them directly
- ✅ When we don't provide fields → Backend falls back to reservation lookup
- ✅ Backward compatible with existing code

## Benefits

1. **Reliability**: No dependency on database state or reservation lookups
2. **Performance**: Immediate processing without additional database queries
3. **Clarity**: All required data is explicit in the request
4. **Debugging**: Enhanced logging shows exactly what data is being sent
5. **Best Practice**: Follows the principle of explicit over implicit

## Testing

- ✅ TypeScript syntax verified
- ✅ Code review passed
- ✅ Security scan passed (0 vulnerabilities)
- ✅ Logic tests passed
- ✅ No modifications to reservation methods (as requested)
- ✅ No modifications to crypto payment methods (as requested)

## Files Modified

1. `src/lib/balance-payment-service.ts` - Updated interface and purchase method
2. `src/components/PaymentModal.tsx` - Updated purchase call to pass all data

## Migration Path

This change is **100% backward compatible**. The backend already handles both approaches:
- Old code that only sends `reservation_id` → Still works (if reservation exists)
- New code that sends all fields → Works immediately without lookups

No database migrations or backend deployments are required for this change to work.
