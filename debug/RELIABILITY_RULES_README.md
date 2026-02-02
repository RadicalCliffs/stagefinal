# Reliability Rules for Realtime Service

## Overview

This implementation adds comprehensive reliability rules to the centralized realtime service and React hooks, ensuring the client only proceeds when server state guarantees success. The system implements guards, state machines, idempotency, and reconnect resilience to prevent double-spend, race conditions, and data inconsistencies.

## Architecture

### Core Components

1. **Guards** (`src/lib/guards/`)
   - `BalanceGuard`: Validates balance invariants before operations
   - `ReservationGuard`: Verifies DB state after realtime events
   - Type definitions for reliable state management

2. **State Machine** (`src/lib/reservation-state-machine.ts`)
   - Manages reservation lifecycle: idle → reserving → reserved → paying → finalizing → confirmed
   - Prevents invalid state transitions
   - Provides clear flow control

3. **Idempotency Keys** (`src/lib/idempotency-keys.ts`)
   - Generates and manages client-side idempotency keys
   - Ensures safe retries with same key until terminal outcome
   - Persists keys across page refreshes

4. **Enhanced Realtime** (`src/lib/supabase-realtime.ts`)
   - Channel state tracking (CONNECTING, SUBSCRIBED, etc.)
   - Event versioning to reject out-of-order updates
   - Broadcast event subscriptions

5. **Hooks** (`src/hooks/`)
   - `useRealtimeWithGuards`: Exposes ready states and guard methods
   - `useEnhancedReservation`: Complete reservation flow with guards
   - `useReconnectResilience`: Handles reconnection and data reconciliation

## Key Features

### 1. Subscribe Early, Gate UI on "SUBSCRIBED"

Channels expose ready states that components can check before showing UI:

```typescript
const { isReady } = useRealtimeWithGuards(userId);

// Block UI until channels are ready
if (!isReady.balances || !isReady.purchases) {
  return <LoadingSpinner message="Connecting to realtime service..." />;
}
```

### 2. BalanceGuard: Assert Balance Invariants

Guards prevent operations when insufficient funds:

```typescript
const { guards } = useRealtimeWithGuards(userId);

try {
  // Check available balance before reserve
  guards.requireAvailable(totalAmount);
  await reserveTickets();
} catch (err) {
  // Guard failed - show error to user
  showError(err.message);
}
```

### 3. ReservationGuard: Verify DB After Realtime Echo

After creating a reservation, the guard waits for confirmation:

```typescript
// 1. Call server to reserve
const result = await omnipotentData.reserveTickets(userId, competitionId, ticketNumbers);

// 2. Wait for reservation_created event
await reservationGuard.awaitReservationCreated(
  result.reservationId,
  totalAmount,
  {
    verifyDb: true,              // Check DB row exists
    requirePendingBalance: true, // Verify balance moved to pending
  }
);

// 3. Only now enable "Pay" button
```

### 4. Idempotent Payment Attempts

Retries use the same idempotency key:

```typescript
const { initiatePayment, retryPayment } = useEnhancedReservation({ ... });

// First attempt
const result = await initiatePayment();

// If transient error, retry with same key
if (!result.success && isTransientError(result.error)) {
  await retryPayment(); // Uses same idempotency key
}
```

### 5. Realtime-Driven State Machine

State transitions only occur on server broadcasts or DB verifications:

```typescript
const { state } = useEnhancedReservation({ ... });

// Current state determines available actions
switch (state.state) {
  case 'idle':
    // Can reserve
    break;
  case 'reserved':
    // Can pay
    break;
  case 'paying':
    // Cannot click pay again
    break;
}
```

### 6. Event Versioning

Out-of-order events are rejected:

```typescript
subscribeToTableWithState(
  'sub_account_balances',
  handlers,
  undefined,
  {
    enableVersioning: true, // Compare updated_at or version
  }
);
```

### 7. Filtered Channels

Subscribe to exactly what's needed:

```typescript
// User-specific balance channel
const channel = `user:${canonicalUserId}:balances`;

// Competition-specific entries
const filter = `competition_id=eq.${competitionId}`;
```

### 8. UI Interlocks

Single-flight mutex prevents double-spend:

```typescript
const [isLocked, setIsLocked] = useState(false);

const handlePay = async () => {
  if (isLocked) return; // Already processing
  
  setIsLocked(true);
  try {
    await initiatePayment();
  } finally {
    setIsLocked(false);
  }
};
```

### 9. Reconnect Resilience

After reconnect, refetch and reconcile:

```typescript
const { connectionState } = useConnectionState({
  onReconnect: async () => {
    // 1. Refetch latest balances
    const { balance } = await reconcileBalance(userId, lastBalance);
    
    // 2. Verify any active reservation
    if (reservationId) {
      const { valid } = await verifyReservation(reservationId);
      if (!valid) {
        clearReservation();
      }
    }
  }
});
```

## Usage Examples

### Basic Reservation Flow

```typescript
import { useEnhancedReservation } from '@/hooks/useEnhancedReservation';

function CompetitionPage({ competitionId, ticketPrice }) {
  const {
    state,
    isReady,
    canReserve,
    canPay,
    reserveTickets,
    initiatePayment,
    error,
  } = useEnhancedReservation({
    competitionId,
    ticketPrice,
    enableGuards: true,
  });

  // Wait for channels
  if (!isReady.balances || !isReady.purchases) {
    return <div>Connecting...</div>;
  }

  return (
    <div>
      <button
        onClick={() => reserveTickets([1, 2, 3])}
        disabled={!canReserve}
      >
        Reserve Tickets
      </button>

      {state.state === 'reserved' && (
        <button
          onClick={initiatePayment}
          disabled={!canPay}
        >
          Pay Now
        </button>
      )}

      {error && <div className="error">{error}</div>}
    </div>
  );
}
```

### Using Guards Directly

```typescript
import { useRealtimeWithGuards } from '@/hooks/useSupabaseRealtime';

function BalanceDisplay() {
  const { isReady, latest, guards } = useRealtimeWithGuards(userId);

  const handlePurchase = async (amount: number) => {
    try {
      // Check balance before proceeding
      guards.requireAvailable(amount);
      
      // Balance is sufficient, proceed
      await makePurchase(amount);
    } catch (err) {
      alert(err.message); // "Insufficient available balance. Need 100, have 50."
    }
  };

  return (
    <div>
      <p>Available: ${latest.balances?.available ?? 0}</p>
      <p>Pending: ${latest.balances?.pending ?? 0}</p>
      <button onClick={() => handlePurchase(100)}>Purchase</button>
    </div>
  );
}
```

### Handling Reconnection

```typescript
import { useReconnectRefetch } from '@/hooks/useReconnectResilience';

function UserDashboard() {
  const { refetch } = useUserData();

  const { connectionState, refetching } = useReconnectRefetch(
    ['user-balances', 'user-purchases'],
    refetch
  );

  return (
    <div>
      {connectionState !== 'connected' && (
        <div className="alert">
          {refetching ? 'Reconnecting and refreshing...' : 'Disconnected'}
        </div>
      )}
      {/* Dashboard content */}
    </div>
  );
}
```

## Server-Side Requirements

The client logic assumes the following server-side behavior:

### Reservation Function

Must atomically:
1. Insert into `pending_tickets`
2. Move funds available → pending in `sub_account_balances`
3. Emit `reservation_created` on `user:{id}:purchases` channel
4. Emit `balances_changed` on `user:{id}:balances` channel

### Finalize Function

Must atomically:
1. Convert `pending_tickets` to `tickets`
2. Move pending → spent in balances
3. Emit `purchase_confirmed` on `user:{id}:purchases`
4. Emit `balances_changed` on `user:{id}:balances`

### On Failure

1. Revert pending funds to available
2. Emit `reservation_failed` or `payment_failed`
3. Emit updated `balances_changed`

## Database Schema

### Required Fields

**pending_tickets:**
- `id` (uuid) - reservation ID
- `status` ('pending' | 'confirmed' | 'failed' | 'expired')
- `canonical_user_id` (text)
- `competition_id` (uuid)
- `total_amount` (numeric)
- `expires_at` (timestamp)

**sub_account_balances:**
- `canonical_user_id` (text)
- `available_balance` (numeric)
- `pending_balance` (numeric)
- `currency` (text)
- `updated_at` (timestamp) - for versioning

## Testing

### Manual Testing Steps

1. **Reserve Tickets**
   - Verify balance guard checks available funds
   - Confirm reservation appears in sessionStorage
   - Check that pending balance updates

2. **Payment Flow**
   - Verify "Pay" button only enabled after reservation confirmed
   - Test retry with transient errors (same idempotency key)
   - Confirm double-click prevention

3. **Reconnection**
   - Disconnect network
   - Verify UI shows "Connecting..."
   - Reconnect and confirm data refreshes
   - Check that active reservation is verified

4. **Expiration**
   - Create reservation
   - Wait for expiration
   - Verify state transitions to 'expired'
   - Confirm reservation clears from storage

### Integration Testing

```typescript
// Example test case
test('reservation flow with guards', async () => {
  const { result } = renderHook(() =>
    useEnhancedReservation({
      competitionId: 'test-comp',
      ticketPrice: 10,
      enableGuards: true,
    })
  );

  // Wait for ready
  await waitFor(() => {
    expect(result.current.isReady.balances).toBe(true);
  });

  // Reserve
  act(() => {
    result.current.reserveTickets([1, 2, 3]);
  });

  // Verify state
  await waitFor(() => {
    expect(result.current.state.state).toBe('reserved');
  });

  // Pay
  act(() => {
    result.current.initiatePayment();
  });

  await waitFor(() => {
    expect(result.current.state.state).toBe('paying');
  });
});
```

## Troubleshooting

### Guards Fail Immediately

**Problem:** Balance guard fails even though balance looks correct

**Solution:**
- Check if balance channel is SUBSCRIBED: `isReady.balances`
- Verify balance data is being received: `latest.balances`
- Ensure canonical user ID format matches server

### Reconnect Doesn't Refresh Data

**Problem:** After reconnect, stale data persists

**Solution:**
- Implement `onReconnect` handler in `useConnectionState`
- Manually call refetch functions
- Check that channels are re-subscribing

### Double Payments

**Problem:** Payment initiates twice

**Solution:**
- Add `isLocked` state to button handlers
- Check state machine: `canPay()` should return false when paying
- Verify idempotency keys are being generated

### State Machine Stuck

**Problem:** State doesn't transition after server action

**Solution:**
- Check broadcast channel subscriptions
- Verify event types match: 'reservation_created', 'payment_authorized', etc.
- Look for console logs showing event receipt
- Ensure guards aren't throwing errors that prevent transition

## Migration Guide

### For Existing Components

1. **Replace basic reservation hooks:**
   ```typescript
   // Old
   const { reserveTickets } = useTicketReservation(competitionId);
   
   // New
   const { reserveTickets, state, isReady } = useEnhancedReservation({
     competitionId,
     ticketPrice,
     enableGuards: true,
   });
   ```

2. **Add ready state checks:**
   ```typescript
   if (!isReady.balances) {
     return <LoadingOverlay />;
   }
   ```

3. **Update button logic:**
   ```typescript
   <button
     disabled={!canReserve || state.state !== 'idle'}
     onClick={handleReserve}
   >
     Reserve
   </button>
   ```

### Enabling Incrementally

You can enable guards incrementally:

```typescript
// Start with guards disabled
const { ... } = useEnhancedReservation({
  competitionId,
  ticketPrice,
  enableGuards: false, // Use basic flow
});

// Later, enable for testing
enableGuards: true
```

## Performance Considerations

- **Channel overhead:** Each channel has minimal overhead, ~1-2KB memory
- **Event filtering:** Client-side filtering is efficient but server-side RLS is preferred
- **Versioning checks:** Negligible CPU cost, happens only on events
- **State machine:** In-memory, no performance impact

## Security Notes

- Balance checks are advisory - server must validate
- Idempotency keys prevent accidental duplicates, not malicious attacks
- Guards enhance UX but don't replace server-side validation
- All operations must be verified server-side with RLS policies

## Future Enhancements

- [ ] Add metrics/observability for guard failures
- [ ] Implement exponential backoff for retries
- [ ] Add queue for offline operations
- [ ] Support multi-currency balance guards
- [ ] Add optimistic UI updates with rollback

## Support

For issues or questions:
- Check console logs for `[ReservationGuard]`, `[BalanceGuard]`, `[ReconnectResilience]` prefixes
- Review state machine transitions in React DevTools
- Verify channel states in browser network tab (WebSocket frames)

## License

Same as parent project.
