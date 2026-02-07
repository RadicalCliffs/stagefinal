# Frontend Guide: Purchase Tickets with Balance

## Overview

This guide shows how to integrate the `purchase-tickets-with-bonus` edge function into your frontend application with proper idempotency handling, error recovery, and balance tracking.

## Complete Client Flow

### Step 1: Generate Idempotency Key

Create a stable, unique idempotency key per checkout attempt. **Reuse the same key on retries** to prevent duplicate charges.

```typescript
import { nanoid } from 'nanoid';

// Generate a unique idempotency key
const idempotencyKey = `web-${crypto.randomUUID()}`;

// Alternative: Use the built-in idempotency manager
import { idempotencyKeyManager } from '@/lib/idempotency-keys';

// Get or create key for a reservation (automatically reused on retries)
const idempotencyKey = idempotencyKeyManager.getOrCreateKey(reservationId);
```

**Best Practices:**
- Generate once per purchase attempt
- Store in component state or session storage
- Reuse the same key for retries after transient failures
- Generate a new key only for completely new purchase attempts

### Step 2: Call the Edge Function

Use the Supabase client to invoke the edge function with proper authentication.

```typescript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://your-project.supabase.co',
  'your-anon-key'
);

// Get user session for authentication
const { data: { session } } = await supabase.auth.getSession();

// Prepare request body
const requestBody = {
  userId: canonicalUserId,              // User's canonical ID (required)
  competition_id: competitionId,         // Competition UUID (required)
  numberOfTickets: ticketNumbers.length, // Total ticket count (required)
  ticketPrice: pricePerTicket,          // Price per ticket (required)
  tickets: ticketNumbers.map(num => ({  // Array of ticket numbers (required)
    ticket_number: num
  })),
  idempotent: true,                     // Enable idempotency (recommended)
  reservation_id: reservationId         // Optional: reservation ID if pre-reserved
};

// Call the edge function
const { data, error } = await supabase.functions.invoke('purchase-tickets-with-bonus', {
  body: requestBody,
  headers: {
    Authorization: `Bearer ${session?.access_token}` // Optional: for user context
  }
});
```

### Step 3: Handle Response

Parse and handle success/error responses appropriately.

```typescript
// Check for errors
if (error) {
  console.error('Purchase failed:', error);
  
  // Determine if retryable
  const isRetryable = error.message?.includes('network') || 
                      error.message?.includes('timeout');
  
  if (isRetryable) {
    // Retry with same idempotency key
    return { success: false, retryable: true };
  } else {
    // Permanent failure - show error to user
    return { success: false, error: error.message };
  }
}

// Check response status
if (data.status === 'error') {
  console.error('Purchase error:', data.error);
  return { success: false, error: data.error };
}

// Success!
if (data.status === 'ok') {
  console.log('Purchase successful!', {
    competitionId: data.competition_id,
    tickets: data.tickets,
    entryId: data.entry_id,
    totalCost: data.total_cost,
    newBalance: data.new_balance
  });
  
  // Mark idempotency key as terminal (no more retries needed)
  idempotencyKeyManager.markTerminal(reservationId);
  
  // Update UI with new balance
  updateBalanceDisplay(data.new_balance);
  
  return {
    success: true,
    data: {
      tickets: data.tickets,
      entryId: data.entry_id,
      newBalance: data.new_balance
    }
  };
}
```

## Complete Example: React Component

Here's a complete example showing how to integrate this into a React component:

```typescript
import React, { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { idempotencyKeyManager } from '@/lib/idempotency-keys';
import { toCanonicalUserId } from '@/lib/canonicalUserId';

interface PurchaseWithBalanceProps {
  userId: string;
  competitionId: string;
  ticketNumbers: number[];
  ticketPrice: number;
  reservationId?: string;
  onSuccess: (result: any) => void;
  onError: (error: string) => void;
}

export function PurchaseWithBalance({
  userId,
  competitionId,
  ticketNumbers,
  ticketPrice,
  reservationId,
  onSuccess,
  onError
}: PurchaseWithBalanceProps) {
  const [loading, setLoading] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  
  const purchaseTickets = useCallback(async () => {
    setLoading(true);
    
    try {
      // Convert userId to canonical format
      const canonicalUserId = toCanonicalUserId(userId);
      
      // Get or create idempotency key (reused on retries)
      const idempotencyKey = reservationId 
        ? idempotencyKeyManager.getOrCreateKey(reservationId)
        : `web-${crypto.randomUUID()}`;
      
      console.log('[Purchase] Attempting purchase', {
        userId: canonicalUserId.substring(0, 20) + '...',
        competitionId: competitionId.substring(0, 10) + '...',
        ticketCount: ticketNumbers.length,
        idempotencyKey,
        retryCount
      });
      
      // Build request body
      const requestBody = {
        userId: canonicalUserId,
        competition_id: competitionId,
        numberOfTickets: ticketNumbers.length,
        ticketPrice: ticketPrice,
        tickets: ticketNumbers.map(num => ({ ticket_number: num })),
        idempotent: true
      };
      
      // Include reservation_id if provided
      if (reservationId) {
        requestBody.reservation_id = reservationId;
      }
      
      // Get authentication token
      const { data: { session } } = await supabase.auth.getSession();
      
      // Call edge function
      const { data, error } = await supabase.functions.invoke('purchase-tickets-with-bonus', {
        body: requestBody,
        headers: session?.access_token ? {
          Authorization: `Bearer ${session.access_token}`
        } : {}
      });
      
      // Handle errors
      if (error) {
        console.error('[Purchase] Edge function error:', error);
        
        // Check if retryable
        const isNetworkError = error.message?.includes('network') || 
                               error.message?.includes('timeout') ||
                               error.message?.includes('fetch');
        
        if (isNetworkError && retryCount < 3) {
          // Retry with exponential backoff
          const delay = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s
          console.log(`[Purchase] Retrying in ${delay}ms...`);
          
          setTimeout(() => {
            setRetryCount(prev => prev + 1);
            purchaseTickets();
          }, delay);
          
          return;
        }
        
        // Permanent failure
        setLoading(false);
        onError(error.message || 'Purchase failed');
        return;
      }
      
      // Check for error response
      if (data?.status === 'error') {
        console.error('[Purchase] Purchase error:', data.error);
        setLoading(false);
        onError(data.error || 'Purchase failed');
        return;
      }
      
      // Success!
      if (data?.status === 'ok') {
        console.log('[Purchase] Purchase successful!', {
          entryId: data.entry_id,
          ticketCount: data.tickets?.length,
          newBalance: data.new_balance
        });
        
        // Mark idempotency key as terminal
        if (reservationId) {
          idempotencyKeyManager.markTerminal(reservationId);
        }
        
        // Dispatch balance update event
        window.dispatchEvent(new CustomEvent('balance-updated', {
          detail: {
            newBalance: Number(data.new_balance),
            purchaseAmount: Number(data.total_cost || 0),
            tickets: data.tickets,
            competitionId: data.competition_id
          }
        }));
        
        setLoading(false);
        setRetryCount(0);
        onSuccess(data);
        return;
      }
      
      // Unknown response format
      console.error('[Purchase] Unknown response format:', data);
      setLoading(false);
      onError('Invalid response from server');
      
    } catch (error) {
      console.error('[Purchase] Exception:', error);
      setLoading(false);
      onError(error instanceof Error ? error.message : 'An unexpected error occurred');
    }
  }, [userId, competitionId, ticketNumbers, ticketPrice, reservationId, retryCount, onSuccess, onError]);
  
  return (
    <button 
      onClick={purchaseTickets}
      disabled={loading}
      className="purchase-button"
    >
      {loading ? (
        <>
          <Spinner />
          {retryCount > 0 ? `Retrying (${retryCount}/3)...` : 'Processing...'}
        </>
      ) : (
        'Purchase with Balance'
      )}
    </button>
  );
}
```

## Using the Balance Payment Service

For a simpler integration, use the built-in `BalancePaymentService`:

```typescript
import { BalancePaymentService } from '@/lib/balance-payment-service';

// Step 1: Reserve tickets (optional but recommended)
const reservationResult = await BalancePaymentService.reserveTickets({
  userId: user.id,
  competitionId: competition.id,
  ticketNumbers: [1, 5, 10, 25, 100] // Or use ticketCount for random selection
});

if (!reservationResult.success) {
  console.error('Reservation failed:', reservationResult.error);
  return;
}

const { reservation_id, ticket_numbers } = reservationResult.data;

// Step 2: Purchase with balance
const purchaseResult = await BalancePaymentService.purchaseWithBalance({
  competitionId: competition.id,
  ticketNumbers: ticket_numbers,
  userId: user.id,
  ticketPrice: competition.ticketPrice,
  reservationId: reservation_id
});

if (!purchaseResult.success) {
  console.error('Purchase failed:', purchaseResult.error);
  return;
}

// Success!
const { new_balance, tickets } = purchaseResult.data;
console.log('Purchase complete!', {
  newBalance: new_balance,
  ticketCount: tickets.length
});
```

## Error Handling

### Common Errors and How to Handle Them

```typescript
interface PurchaseError {
  statusCode: number;
  message: string;
  type: 'validation' | 'conflict' | 'expired' | 'insufficient_balance' | 'not_found' | 'network' | 'unknown';
}

function handlePurchaseError(error: PurchaseError): { retry: boolean; message: string } {
  switch (error.type) {
    case 'validation':
      // User input error - don't retry
      return {
        retry: false,
        message: error.message || 'Invalid request. Please check your input.'
      };
      
    case 'conflict':
      // Tickets no longer available - don't retry, suggest re-selection
      return {
        retry: false,
        message: 'Some tickets are no longer available. Please select different tickets.'
      };
      
    case 'expired':
      // Reservation expired - don't retry, user needs to reserve again
      return {
        retry: false,
        message: 'Your reservation has expired. Please reserve tickets again.'
      };
      
    case 'insufficient_balance':
      // Not enough funds - don't retry, user needs to top up
      return {
        retry: false,
        message: 'Insufficient balance. Please top up your wallet and try again.'
      };
      
    case 'not_found':
      // Reservation not found - don't retry
      return {
        retry: false,
        message: 'Reservation not found. Please reserve tickets again.'
      };
      
    case 'network':
      // Network error - safe to retry with same idempotency key
      return {
        retry: true,
        message: 'Network error. Retrying...'
      };
      
    default:
      // Unknown error - retry once, then give up
      return {
        retry: error.statusCode >= 500, // Retry server errors
        message: error.message || 'An unexpected error occurred. Please try again.'
      };
  }
}
```

## Idempotency Key Management

### Manual Management

```typescript
// Create a new key
const key = `web-${crypto.randomUUID()}`;

// Store in session storage for retries across page reloads
sessionStorage.setItem(`purchase-key-${reservationId}`, key);

// Retrieve for retry
const existingKey = sessionStorage.getItem(`purchase-key-${reservationId}`);
const keyToUse = existingKey || `web-${crypto.randomUUID()}`;

// Clear after success
sessionStorage.removeItem(`purchase-key-${reservationId}`);
```

### Using IdempotencyKeyManager

```typescript
import { idempotencyKeyManager } from '@/lib/idempotency-keys';

// Get or create key (automatically managed)
const key = idempotencyKeyManager.getOrCreateKey(reservationId);

// Key is automatically reused on subsequent calls for same reservation

// Mark as terminal after success (prevents further retries)
idempotencyKeyManager.markTerminal(reservationId);

// Clear after successful completion
idempotencyKeyManager.clearKey(reservationId);

// Cleanup expired keys (runs automatically)
idempotencyKeyManager.cleanup();
```

## Balance Updates and Real-time Sync

### Listen for Balance Updates

```typescript
// Listen for balance updates from purchases
useEffect(() => {
  const handleBalanceUpdate = (event: CustomEvent) => {
    const { newBalance, purchaseAmount, tickets, competitionId } = event.detail;
    
    console.log('Balance updated:', {
      newBalance,
      purchaseAmount,
      ticketsCount: tickets.length,
      competitionId
    });
    
    // Update local state
    setBalance(newBalance);
    
    // Show success notification
    showNotification({
      type: 'success',
      title: 'Purchase Successful!',
      message: `You purchased ${tickets.length} tickets. New balance: $${newBalance.toFixed(2)}`
    });
  };
  
  window.addEventListener('balance-updated', handleBalanceUpdate as EventListener);
  
  return () => {
    window.removeEventListener('balance-updated', handleBalanceUpdate as EventListener);
  };
}, []);
```

## Testing

### Test Checklist

- [ ] Generate unique idempotency key per purchase
- [ ] Retry with same key on network errors
- [ ] Handle insufficient balance gracefully
- [ ] Handle expired reservations
- [ ] Handle unavailable tickets (conflict)
- [ ] Update balance display after successful purchase
- [ ] Show appropriate error messages
- [ ] Test concurrent purchases (idempotency prevents duplicates)
- [ ] Test page refresh during purchase (key persists in storage)
- [ ] Verify balance-updated event fires

### Example Test

```typescript
describe('Purchase with Balance', () => {
  it('should use same idempotency key on retry', async () => {
    const reservationId = 'test-reservation-123';
    
    // First attempt
    const key1 = idempotencyKeyManager.getOrCreateKey(reservationId);
    
    // Retry (should return same key)
    const key2 = idempotencyKeyManager.getOrCreateKey(reservationId);
    
    expect(key1).toBe(key2);
  });
  
  it('should mark key as terminal after success', async () => {
    const reservationId = 'test-reservation-456';
    
    // Get key
    const key = idempotencyKeyManager.getOrCreateKey(reservationId);
    
    // Simulate successful purchase
    idempotencyKeyManager.markTerminal(reservationId);
    
    // New call after terminal should return same key
    const keyAfter = idempotencyKeyManager.getOrCreateKey(reservationId);
    expect(keyAfter).toBe(key);
  });
});
```

## Best Practices

1. **Always use idempotency keys** for payment operations
2. **Reuse the same key** when retrying after transient failures
3. **Generate a new key** only for completely new purchase attempts
4. **Handle all error types** appropriately (retry vs permanent failure)
5. **Update UI immediately** after successful purchase
6. **Show clear error messages** to users
7. **Log all purchase attempts** for debugging
8. **Test edge cases** (network failures, concurrent requests, page refreshes)
9. **Use TypeScript** for type safety
10. **Clean up keys** after successful completion or permanent failure

## Troubleshooting

### Purchase fails with "Invalid response"
- Check that all required fields are provided (userId, competition_id, tickets, etc.)
- Verify userId is in canonical format (use `toCanonicalUserId()`)
- Ensure ticket_numbers array is not empty

### Balance not updating after purchase
- Check that 'balance-updated' event listener is registered
- Verify the event is dispatched (check browser console)
- Ensure balance state is updated in the listener

### Duplicate purchases
- Ensure you're reusing the same idempotency key on retries
- Don't generate a new key for transient failures (network errors, timeouts)
- Use `idempotencyKeyManager` for automatic key management

### Reservation expired errors
- Increase reservation time if needed
- Guide users to complete purchase within time limit
- Show countdown timer in UI

## API Reference

### Edge Function: purchase-tickets-with-bonus

**Endpoint:** `POST /functions/v1/purchase-tickets-with-bonus`

**Request Body:**
```typescript
{
  userId: string;                    // Canonical user ID (required)
  competition_id: string;            // Competition UUID (required)
  numberOfTickets: number;           // Total ticket count (required)
  ticketPrice: number;               // Price per ticket (required)
  tickets: Array<{                   // Array of ticket objects (required)
    ticket_number: number;
  }>;
  idempotent: boolean;               // Enable idempotency (recommended: true)
  reservation_id?: string;           // Optional: reservation ID
}
```

**Success Response:**
```typescript
{
  status: 'ok';
  competition_id: string;
  tickets: Array<{ ticket_number: number }>;
  entry_id: string;
  total_cost: number;
  new_balance: number;
  idempotent: boolean;
}
```

**Error Response:**
```typescript
{
  status: 'error';
  error: string;
  errorCode: number;
}
```

## Related Documentation

- [Balance Payment Service](/src/lib/balance-payment-service.ts) - Higher-level service wrapper
- [Idempotency Keys](/src/lib/idempotency-keys.ts) - Key management utilities
- [Purchase Edge Function](/supabase/functions/purchase-tickets-with-bonus/index.ts) - Server implementation
- [Fix Summary](/debug/FIX_PURCHASE_TICKETS_BONUS_SUMMARY.md) - Technical details and fixes
