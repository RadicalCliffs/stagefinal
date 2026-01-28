# Integration Example: Adding Reliability Rules to Existing Components

## Example 1: Enhancing a Competition Page

### Before (Basic Implementation)

```typescript
// src/pages/CompetitionPage.tsx - BEFORE
import { useTicketReservation } from '@/hooks/useOmnipotentData';

export function CompetitionPage({ competitionId }) {
  const {
    reserveTickets,
    reserving,
    error,
    reservationId,
    clearReservation,
  } = useTicketReservation(competitionId);

  const [selectedTickets, setSelectedTickets] = useState<number[]>([]);

  const handleReserve = async () => {
    const result = await reserveTickets(userId, selectedTickets);
    if (result.success) {
      // Proceed to payment
      showPaymentModal();
    }
  };

  return (
    <div>
      <TicketSelector 
        onSelect={setSelectedTickets}
        selected={selectedTickets}
      />
      
      <button onClick={handleReserve} disabled={reserving}>
        {reserving ? 'Reserving...' : 'Reserve Tickets'}
      </button>
      
      {error && <div className="error">{error}</div>}
    </div>
  );
}
```

### After (With Reliability Rules)

```typescript
// src/pages/CompetitionPage.tsx - AFTER
import { useEnhancedReservation } from '@/hooks/useEnhancedReservation';
import { useConnectionState } from '@/hooks/useReconnectResilience';

export function CompetitionPage({ competitionId, ticketPrice }) {
  const {
    state,
    isReady,
    canReserve,
    canPay,
    isProcessing,
    reserveTickets,
    initiatePayment,
    clearReservation,
    error,
  } = useEnhancedReservation({
    competitionId,
    ticketPrice,
    enableGuards: true, // Enable all reliability rules
  });

  const { connectionState } = useConnectionState({
    onReconnect: async () => {
      // Refresh data after reconnection
      await refetchCompetition();
    },
  });

  const [selectedTickets, setSelectedTickets] = useState<number[]>([]);
  const [isLocked, setIsLocked] = useState(false);

  // Single-flight mutex for reserve
  const handleReserve = async () => {
    if (isLocked || !canReserve) return;
    
    setIsLocked(true);
    try {
      const result = await reserveTickets(selectedTickets);
      if (result.success) {
        console.log('Reservation created:', result.reservationId);
      }
    } finally {
      setIsLocked(false);
    }
  };

  // Single-flight mutex for payment
  const handlePay = async () => {
    if (isLocked || !canPay) return;
    
    setIsLocked(true);
    try {
      const result = await initiatePayment();
      if (result.success) {
        // Payment initiated with idempotency key
        showPaymentModal();
      }
    } finally {
      setIsLocked(false);
    }
  };

  // Show loading state while channels connect
  if (!isReady.balances || !isReady.purchases) {
    return (
      <LoadingOverlay message="Connecting to realtime service..." />
    );
  }

  // Show disconnected state
  if (connectionState !== 'connected') {
    return (
      <div className="alert alert-warning">
        Reconnecting to server...
      </div>
    );
  }

  return (
    <div>
      <TicketSelector 
        onSelect={setSelectedTickets}
        selected={selectedTickets}
        disabled={isProcessing} // Disable during any processing
      />
      
      {/* State-aware button rendering */}
      {state.state === 'idle' && (
        <button
          onClick={handleReserve}
          disabled={!canReserve || isLocked || selectedTickets.length === 0}
          data-state={state.state}
        >
          Reserve Tickets
        </button>
      )}

      {state.state === 'reserving' && (
        <button disabled>
          <Spinner /> Reserving...
        </button>
      )}

      {state.state === 'reserved' && (
        <button
          onClick={handlePay}
          disabled={!canPay || isLocked}
          data-state={state.state}
        >
          Proceed to Payment
        </button>
      )}

      {state.state === 'paying' && (
        <button disabled>
          <Spinner /> Processing Payment...
        </button>
      )}

      {state.state === 'finalizing' && (
        <button disabled>
          <Spinner /> Finalizing Purchase...
        </button>
      )}

      {state.state === 'confirmed' && (
        <div className="success">
          <CheckIcon /> Purchase Complete!
          <button onClick={clearReservation}>Buy More Tickets</button>
        </div>
      )}

      {state.state === 'failed' && (
        <div className="error">
          <AlertIcon /> {error}
          <button onClick={handlePay}>Retry Payment</button>
          <button onClick={clearReservation}>Cancel</button>
        </div>
      )}

      {state.state === 'expired' && (
        <div className="warning">
          <ClockIcon /> Reservation Expired
          <button onClick={clearReservation}>Try Again</button>
        </div>
      )}

      {/* Debug info in development */}
      {process.env.NODE_ENV === 'development' && (
        <div className="debug-panel">
          <h4>State Machine Debug</h4>
          <pre>{JSON.stringify(state, null, 2)}</pre>
          <p>Channels Ready: {isReady.balances && isReady.purchases ? '✓' : '✗'}</p>
          <p>Connection: {connectionState}</p>
        </div>
      )}
    </div>
  );
}
```

## Example 2: Adding Guards to Balance Display

### Before

```typescript
// src/components/BalanceDisplay.tsx - BEFORE
import { useRealTimeBalance } from '@/hooks/useRealTimeBalance';

export function BalanceDisplay() {
  const { balance, pendingBalance, isLoading } = useRealTimeBalance();

  if (isLoading) return <Spinner />;

  return (
    <div className="balance-display">
      <div>Available: ${balance.toFixed(2)}</div>
      <div>Pending: ${pendingBalance.toFixed(2)}</div>
    </div>
  );
}
```

### After (With Guards)

```typescript
// src/components/BalanceDisplay.tsx - AFTER
import { useRealtimeWithGuards } from '@/hooks/useSupabaseRealtime';
import { useAuthUser } from '@/contexts/AuthContext';

export function BalanceDisplay() {
  const { baseUser } = useAuthUser();
  const { isReady, latest, guards } = useRealtimeWithGuards(baseUser?.id || null);

  // Helper to check if amount can be afforded
  const canAfford = (amount: number) => {
    if (!latest.balances) return false;
    return latest.balances.available >= amount;
  };

  // Helper to get balance status class
  const getStatusClass = () => {
    if (!isReady.balances) return 'connecting';
    if (!latest.balances) return 'no-data';
    return 'connected';
  };

  return (
    <div className={`balance-display ${getStatusClass()}`}>
      {!isReady.balances ? (
        <div className="connecting">
          <Spinner size="sm" /> Connecting...
        </div>
      ) : (
        <>
          <div className="balance-item">
            <span className="label">Available:</span>
            <span className="value">
              ${latest.balances?.available.toFixed(2) ?? '0.00'}
            </span>
          </div>
          
          <div className="balance-item">
            <span className="label">Pending:</span>
            <span className="value">
              ${latest.balances?.pending.toFixed(2) ?? '0.00'}
            </span>
          </div>

          {/* Visual indicator */}
          <div className="status-indicator">
            {isReady.balances ? (
              <span className="badge badge-success">Live</span>
            ) : (
              <span className="badge badge-warning">Connecting</span>
            )}
          </div>

          {/* Last update timestamp */}
          {latest.balances?.updated_at && (
            <div className="last-update">
              Last updated: {new Date(latest.balances.updated_at).toLocaleTimeString()}
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

## Example 3: Payment Modal with Idempotency

### Before

```typescript
// src/components/PaymentModal.tsx - BEFORE
export function PaymentModal({ reservationId, amount, onSuccess }) {
  const [paying, setPaying] = useState(false);

  const handlePay = async () => {
    setPaying(true);
    try {
      await processPayment(reservationId, amount);
      onSuccess();
    } catch (err) {
      alert('Payment failed');
    } finally {
      setPaying(false);
    }
  };

  return (
    <Modal>
      <button onClick={handlePay} disabled={paying}>
        Pay ${amount}
      </button>
    </Modal>
  );
}
```

### After (With Idempotency)

```typescript
// src/components/PaymentModal.tsx - AFTER
import { idempotencyKeyManager } from '@/lib/idempotency-keys';
import { useState, useRef } from 'react';

export function PaymentModal({ reservationId, amount, onSuccess, onError }) {
  const [paying, setPaying] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);

  const handlePay = async (isRetry = false) => {
    if (paying) return; // Prevent double-click

    if (isRetry) {
      setRetrying(true);
    } else {
      setPaying(true);
    }

    try {
      setError(null);

      // Get or create idempotency key (reused on retry)
      if (!idempotencyKeyRef.current) {
        idempotencyKeyRef.current = idempotencyKeyManager.getOrCreateKey(reservationId);
      }

      console.log('Processing payment with idempotency key:', idempotencyKeyRef.current);

      // Call payment with idempotency key
      const result = await processPayment({
        reservationId,
        amount,
        idempotencyKey: idempotencyKeyRef.current,
      });

      if (result.success) {
        // Mark key as terminal
        idempotencyKeyManager.markTerminal(reservationId);
        onSuccess();
      } else if (result.transient) {
        // Transient error - can retry with same key
        setError(result.error || 'Payment failed. You can retry safely.');
      } else {
        // Permanent error - clear key
        idempotencyKeyManager.clearKey(reservationId);
        setError(result.error || 'Payment failed');
        onError?.(result.error);
      }
    } catch (err: any) {
      const message = err.message || 'An unexpected error occurred';
      setError(message);
      
      // Assume transient if network error
      if (err.name === 'NetworkError' || err.code === 'ECONNABORTED') {
        console.log('Transient error detected, retry is safe');
      } else {
        idempotencyKeyManager.clearKey(reservationId);
      }
    } finally {
      setPaying(false);
      setRetrying(false);
    }
  };

  const handleRetry = () => handlePay(true);

  const handleCancel = () => {
    idempotencyKeyManager.clearKey(reservationId);
    onError?.('Payment cancelled');
  };

  return (
    <Modal>
      <div className="payment-modal">
        <h3>Complete Payment</h3>
        <p className="amount">Amount: ${amount.toFixed(2)}</p>

        {error && (
          <div className="alert alert-error">
            {error}
          </div>
        )}

        {!paying && !error && (
          <button
            onClick={() => handlePay(false)}
            className="btn btn-primary"
            disabled={paying}
          >
            Pay ${amount.toFixed(2)}
          </button>
        )}

        {paying && (
          <button disabled className="btn btn-secondary">
            <Spinner /> Processing...
          </button>
        )}

        {error && !retrying && (
          <div className="button-group">
            <button
              onClick={handleRetry}
              className="btn btn-warning"
            >
              Retry Safely
            </button>
            <button
              onClick={handleCancel}
              className="btn btn-secondary"
            >
              Cancel
            </button>
          </div>
        )}

        {retrying && (
          <button disabled className="btn btn-warning">
            <Spinner /> Retrying safely...
          </button>
        )}

        {/* Show idempotency key in dev mode */}
        {process.env.NODE_ENV === 'development' && idempotencyKeyRef.current && (
          <div className="debug-info">
            <small>Idempotency Key: {idempotencyKeyRef.current}</small>
          </div>
        )}
      </div>
    </Modal>
  );
}
```

## Key Takeaways

1. **Always check ready states** before showing interactive UI
2. **Use single-flight mutex** (isLocked) to prevent double-clicks
3. **Leverage state machine** for clear flow control
4. **Handle reconnection** gracefully with loading states
5. **Implement retry logic** with idempotency keys for safe retries
6. **Show clear state transitions** to users (reserving → reserved → paying)
7. **Add debug info** in development mode for troubleshooting

## Migration Checklist

- [ ] Replace basic hooks with enhanced versions
- [ ] Add ready state checks (`isReady.balances`, `isReady.purchases`)
- [ ] Implement single-flight mutexes for actions
- [ ] Add state machine UI (show different buttons per state)
- [ ] Handle reconnection with `useConnectionState`
- [ ] Add idempotency keys to payment flows
- [ ] Test guard failures (insufficient balance, etc.)
- [ ] Add loading overlays during channel connection
- [ ] Test reconnection scenarios
- [ ] Verify sessionStorage persistence works

## Testing Your Integration

```typescript
// Test checklist:
// 1. Reserve tickets with insufficient balance → Guard should prevent
// 2. Reserve tickets → Should see "reserved" state
// 3. Click Pay twice rapidly → Should only initiate once
// 4. Disconnect network during reservation → Should handle gracefully
// 5. Refresh page with active reservation → Should recover from storage
// 6. Let reservation expire → Should transition to "expired" state
// 7. Retry failed payment → Should use same idempotency key
```
