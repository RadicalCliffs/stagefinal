# Quick Reference Card: Reliability Rules

## Import Statements

```typescript
// Enhanced reservation with guards
import { useEnhancedReservation } from '@/hooks/useEnhancedReservation';

// Direct guard usage
import { useRealtimeWithGuards } from '@/hooks/useSupabaseRealtime';

// Reconnection handling
import { useConnectionState, useReconnectRefetch } from '@/hooks/useReconnectResilience';

// State machine
import { ReservationStateMachineManager } from '@/lib/reservation-state-machine';

// Idempotency
import { idempotencyKeyManager } from '@/lib/idempotency-keys';
```

## Basic Usage Pattern

```typescript
function MyComponent({ competitionId, ticketPrice }) {
  const {
    state,              // Current state machine state
    isReady,            // { balances: bool, purchases: bool }
    canReserve,         // Can user reserve now?
    canPay,             // Can user pay now?
    reserveTickets,     // Reserve function
    initiatePayment,    // Payment function
    error,              // Current error message
  } = useEnhancedReservation({
    competitionId,
    ticketPrice,
    enableGuards: true,  // Turn on reliability rules
  });

  // Block UI until channels ready
  if (!isReady.balances || !isReady.purchases) {
    return <Loading />;
  }

  // Render based on state
  return (
    <div>
      {state.state === 'idle' && (
        <button onClick={() => reserveTickets([1,2,3])} disabled={!canReserve}>
          Reserve Tickets
        </button>
      )}
      
      {state.state === 'reserved' && (
        <button onClick={initiatePayment} disabled={!canPay}>
          Pay Now
        </button>
      )}
      
      {error && <div className="error">{error}</div>}
    </div>
  );
}
```

## State Machine States

| State | Description | Actions Available |
|-------|-------------|-------------------|
| `idle` | No active reservation | Can reserve |
| `reserving` | Creating reservation | None (processing) |
| `reserved` | Reservation confirmed | Can pay |
| `paying` | Payment in progress | None (processing) |
| `finalizing` | Confirming purchase | None (processing) |
| `confirmed` | Purchase complete | Can reset |
| `failed` | Operation failed | Can retry |
| `expired` | Reservation expired | Can reset |

## Guard Methods

```typescript
const { guards } = useRealtimeWithGuards(userId);

// Before reserve: check available balance
try {
  guards.requireAvailable(100);
  // Proceed with reserve
} catch (err) {
  // Show error: "Insufficient available balance"
}

// Before finalize: check pending balance
try {
  await guards.requirePending(100, reservationId);
  // Proceed with finalize
} catch (err) {
  // Show error: "Pending balance not locked"
}
```

## Channel Ready States

```typescript
const { isReady } = useRealtimeWithGuards(userId);

isReady.balances    // true when balance channel subscribed
isReady.purchases   // true when purchases channel subscribed
isReady.entries     // true when entries channel subscribed
isReady.tickets     // true when tickets channel subscribed
```

## Idempotency Keys

```typescript
import { idempotencyKeyManager } from '@/lib/idempotency-keys';

// Get or create key for a reservation
const key = idempotencyKeyManager.getOrCreateKey(reservationId);

// Use key in payment request
await processPayment({ reservationId, idempotencyKey: key });

// On success or permanent failure
idempotencyKeyManager.markTerminal(reservationId);
idempotencyKeyManager.clearKey(reservationId);
```

## Reconnection Handling

```typescript
import { useConnectionState } from '@/hooks/useReconnectResilience';

const { connectionState, reconnecting } = useConnectionState({
  onReconnect: async () => {
    // Refetch data after reconnect
    await refetchBalance();
    await verifyReservation();
  }
});

// Show reconnection UI
if (connectionState !== 'connected') {
  return <div>Reconnecting...</div>;
}
```

## Single-Flight Mutex Pattern

```typescript
const [isLocked, setIsLocked] = useState(false);

const handleAction = async () => {
  if (isLocked) return; // Prevent double-click
  
  setIsLocked(true);
  try {
    await performAction();
  } finally {
    setIsLocked(false);
  }
};
```

## Event Versioning

Automatically handled by `subscribeToTableWithState`:

```typescript
subscribeToTableWithState(
  'sub_account_balances',
  handlers,
  undefined,
  { enableVersioning: true }  // Rejects out-of-order events
);
```

## Common Patterns

### Reserve → Pay → Confirm

```typescript
// 1. Reserve
const result = await reserveTickets([1, 2, 3]);
// State: idle → reserving → reserved

// 2. Pay
const payment = await initiatePayment();
// State: reserved → paying → finalizing

// 3. Confirmed
// State: finalizing → confirmed
// (automatic on purchase_confirmed event)
```

### Retry on Failure

```typescript
const { retryPayment } = useEnhancedReservation({ ... });

// First attempt failed
if (state.state === 'failed') {
  // Retry with same idempotency key
  await retryPayment();
}
```

### Clear and Reset

```typescript
const { clearReservation } = useEnhancedReservation({ ... });

// Clear reservation and reset to idle
clearReservation();
```

## Error Handling

```typescript
// Guard errors
try {
  guards.requireAvailable(amount);
} catch (err) {
  // err.message: "Insufficient available balance. Need 100, have 50."
  showError(err.message);
}

// State machine errors
if (state.state === 'failed') {
  // state.error contains the error message
  showError(state.error);
}
```

## Debug Mode

```typescript
{process.env.NODE_ENV === 'development' && (
  <div className="debug">
    <pre>{JSON.stringify(state, null, 2)}</pre>
    <p>Ready: {isReady.balances ? '✓' : '✗'}</p>
  </div>
)}
```

## Performance Tips

1. **Memoize handlers** - Wrap callbacks in `useCallback`
2. **Check ready states** - Don't show UI until channels ready
3. **Use single-flight mutex** - Prevent concurrent operations
4. **Enable versioning** - Reject stale events automatically
5. **Cleanup on unmount** - Hooks handle this automatically

## Common Pitfalls

❌ **Don't**: Call actions without checking state
```typescript
// Bad - might be in wrong state
await initiatePayment();
```

✅ **Do**: Check state machine first
```typescript
// Good
if (canPay && state.state === 'reserved') {
  await initiatePayment();
}
```

❌ **Don't**: Ignore ready states
```typescript
// Bad - channels might not be ready
<button onClick={reserve}>Reserve</button>
```

✅ **Do**: Check ready states
```typescript
// Good
if (!isReady.balances) return <Loading />;
<button onClick={reserve}>Reserve</button>
```

❌ **Don't**: Create new idempotency keys on retry
```typescript
// Bad - creates duplicate reservations
const key = nanoid();
await processPayment({ key });
```

✅ **Do**: Reuse existing keys
```typescript
// Good - safe retry
const key = idempotencyKeyManager.getOrCreateKey(reservationId);
await processPayment({ key });
```

## Testing Checklist

- [ ] Reserve with insufficient balance → Blocked by guard
- [ ] Reserve with sufficient balance → State: reserved
- [ ] Double-click "Pay" → Only one payment initiated
- [ ] Network disconnect during reserve → Handles gracefully
- [ ] Page refresh with active reservation → Recovers from storage
- [ ] Reservation expires → State: expired
- [ ] Payment fails → Can retry with same key
- [ ] Reconnect after disconnect → Refetches and reconciles

## Files Reference

| File | Purpose |
|------|---------|
| `RELIABILITY_RULES_README.md` | Complete guide |
| `INTEGRATION_EXAMPLES.md` | Migration examples |
| `ARCHITECTURE_DIAGRAM.md` | Visual diagrams |
| `IMPLEMENTATION_SUMMARY.md` | Task summary |

## Support

For issues, check:
1. Console logs (prefixed with `[BalanceGuard]`, `[ReservationGuard]`, etc.)
2. State machine transitions (React DevTools)
3. Channel states (WebSocket frames in Network tab)

## Quick Commands

```bash
# View documentation
cat RELIABILITY_RULES_README.md | less

# Search for examples
grep -r "useEnhancedReservation" src/

# Find guard usage
grep -r "requireAvailable" src/
```

---

**Version**: 1.0  
**Last Updated**: 2026-01-28  
**Status**: Production Ready ✅
