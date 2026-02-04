# Ticket Availability Architecture

## Overview

This document describes the authoritative ticket availability system that ensures consistent, reliable ticket counts across all competition pages.

## Problem Statement

Previously, competition pages could show "bouncing" availability values:
- RPC would return `available_count=1`
- Fallback logic would compute `available_count=2` from `competition.tickets_sold`
- UI would alternate between these values during refetches

This caused:
1. Confusing user experience (availability changing unexpectedly)
2. Potential overselling when users selected based on stale computed values
3. Race conditions when concurrent requests returned out-of-order responses

## Solution: Single Source of Truth

### Core Principle

**Once RPC succeeds, never fall back to computed values.**

The system enforces a single, authoritative source of truth for ticket availability:
- **Primary**: `get_competition_ticket_availability_text` RPC function
- **Fallbacks**: Only used if RPC has never succeeded for the current competition
- **Real-time updates**: Broadcast events update availability without refetch

### Implementation

#### 1. Authoritative Availability Hook

`src/hooks/useAuthoritativeAvailability.ts`

Key features:
- **Request ID tracking**: Prevents stale responses from overwriting fresher data
- **Authoritative flag**: `isAuthoritative=true` once RPC succeeds, never reverts to false
- **Stale response guard**: Discards responses from earlier requests
- **Broadcast integration**: Real-time updates also marked as authoritative

```typescript
const { availability, refresh } = useAuthoritativeAvailability({
  competitionId: 'uuid-here',
  debug: true, // Enable debug logging
});

// availability.isAuthoritative === true means data is from RPC
// Once true, computed fallbacks are never used
```

#### 2. Request ID Pattern

Prevents out-of-order responses:

```typescript
const requestIdRef = useRef(0);

// Before fetch
const thisRequestId = ++requestIdRef.current;

// After fetch
if (thisRequestId !== requestIdRef.current) {
  // Discard stale response
  return;
}
```

If Request A starts, then Request B starts, and Request A finishes after B, Request A's response is discarded because it's stale.

#### 3. Component Integration

`src/components/IndividualCompetition/IndividualCompetitionHeroSection.tsx`

Before:
```typescript
const soldCount = ticketAvailability?.sold_count ?? (competition.tickets_sold || 0);
const availableCount = ticketAvailability?.available_count ?? (totalTickets - soldCount);
```

After:
```typescript
const soldCount = availability.sold_count;
const availableCount = availability.available_count;
// NO fallbacks - authoritative or bust
```

## Availability Data Flow

```
┌─────────────────────────────────────────────────────┐
│ Competition Page Load                                │
└─────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────┐
│ useAuthoritativeAvailability Hook                    │
│ - Increments requestId (e.g., requestId = 1)        │
│ - Calls get_competition_ticket_availability_text    │
└─────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────┐
│ RPC Response Received                                │
│ - Checks if requestId still matches (guard against  │
│   stale responses)                                   │
│ - Sets availability.isAuthoritative = true           │
│ - Updates UI with RPC data                           │
└─────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────┐
│ Broadcast Events (Real-time Updates)                 │
│ - Someone buys/reserves tickets                      │
│ - Broadcast event received                           │
│ - Updates availability (still authoritative)         │
└─────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────┐
│ Payment Success                                      │
│ - Calls refreshAvailability() explicitly             │
│ - New RPC fetch ensures immediate UI update          │
│ - No page reload required                            │
└─────────────────────────────────────────────────────┘
```

## Payment Flow Integration

### Idempotent Confirmation

`supabase/functions/confirm-pending-tickets/index.ts`

The confirmation endpoint now supports safe retries:

**Returns 200 OK (success) for:**
- Already confirmed (returns existing ticket numbers)
- Confirmation in progress by another request
- Any non-terminal state (to avoid breaking retry logic)

**Returns 409 Conflict only for:**
- Expired reservations
- Canceled reservations
- Released reservations

### Frontend Handling

`src/components/PaymentModal.tsx`

Handles idempotent responses:

```typescript
if (confirmResult.success) {
  if (confirmResult.alreadyConfirmed) {
    console.log('Tickets already confirmed (idempotent)');
  } else if (confirmResult.confirmationInProgress) {
    console.log('Confirmation in progress (idempotent)');
  }
  // Proceed with success flow
}
```

### Immediate Refresh After Payment

After successful payment (base_account or balance):

```typescript
onPaymentSuccess={() => {
  // Clear reservation state
  setReservationId(null);
  setReservedTickets([]);
  
  // Refresh availability immediately - no page reload needed
  refreshAvailability();
  
  // Refresh user's entry list
  onEntriesRefresh?.();
}}
```

This ensures:
1. Availability updates to reflect sold tickets
2. User sees their new ticket numbers
3. No confusing stale data

## Best Practices

### DO ✅

1. **Use `useAuthoritativeAvailability`** for all competition pages
2. **Call `refresh()`** after payment success
3. **Trust `isAuthoritative` flag** - don't mix in computed values
4. **Log request IDs** during debugging
5. **Handle idempotent responses** gracefully (alreadyConfirmed, confirmationInProgress)

### DON'T ❌

1. **Don't use fallback logic** after RPC succeeds (`availability.isAuthoritative === true`)
2. **Don't mix RPC data with `competition.tickets_sold`** for display
3. **Don't cache availability** without request ID tracking
4. **Don't return 409** for non-terminal states in confirmation
5. **Don't forget to refresh** after successful payments

## Debugging

Enable debug logging:

```typescript
const { availability } = useAuthoritativeAvailability({
  competitionId,
  debug: true, // Enables console.log statements
});
```

Look for:
- `[AuthoritativeAvailability] Fetching availability (request #N)`
- `[AuthoritativeAvailability] RPC success (request #N)`
- `[AuthoritativeAvailability] Discarding stale response #N`
- `[HeroSection] Authoritative ticket availability`

## Testing Checklist

- [ ] Load competition page - verify RPC is called
- [ ] Check `availability.isAuthoritative === true` after load
- [ ] Simulate slow RPC - verify fast subsequent request isn't overwritten
- [ ] Purchase tickets - verify availability refreshes immediately
- [ ] Retry failed payment - verify no 409 errors on already-confirmed
- [ ] Open multiple tabs - verify broadcast events sync availability
- [ ] Check console for stale response discards

## Related Files

- `src/hooks/useAuthoritativeAvailability.ts` - Core hook
- `src/components/IndividualCompetition/IndividualCompetitionHeroSection.tsx` - Main usage
- `src/components/PaymentModal.tsx` - Idempotent handling
- `supabase/functions/confirm-pending-tickets/index.ts` - Backend idempotency
- `src/lib/supabase-rpc-helpers.ts` - RPC wrappers
- `src/hooks/useTicketBroadcast.ts` - Real-time events

## Migration Notes

### Existing Components

If updating an existing component to use authoritative availability:

1. Replace custom fetch logic with `useAuthoritativeAvailability`
2. Remove all fallback logic (e.g., `?? competition.tickets_sold`)
3. Update to use `availability.sold_count`, `availability.available_count` directly
4. Add `refreshAvailability()` call to payment success handlers
5. Test thoroughly with debug logging enabled

### Database/RPC Requirements

Requires:
- `get_competition_ticket_availability_text` RPC function (existing)
- Broadcast channel for ticket events (existing via triggers)
- No schema changes required

## Future Improvements

Potential enhancements:
1. Add availability cache with TTL for offline resilience
2. Implement optimistic UI updates during reservation
3. Add telemetry for tracking stale response frequency
4. Extend to other competition types (InstantWin, etc.)
