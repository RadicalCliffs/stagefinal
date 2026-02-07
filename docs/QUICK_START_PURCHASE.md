# Quick Start: Purchase Tickets with Balance

## Minimal Example (5 steps)

```typescript
import { supabase } from '@/lib/supabase';
import { toCanonicalUserId } from '@/lib/canonicalUserId';

async function purchaseTickets(
  userId: string,
  competitionId: string,
  ticketNumbers: number[],
  ticketPrice: number,
  reservationId?: string
) {
  // 1. Generate idempotency key (reuse on retries!)
  const idempotencyKey = `web-${crypto.randomUUID()}`;
  
  // 2. Convert userId to canonical format
  const canonicalUserId = toCanonicalUserId(userId);
  
  // 3. Prepare request
  const requestBody = {
    userId: canonicalUserId,
    competition_id: competitionId,
    numberOfTickets: ticketNumbers.length,
    ticketPrice: ticketPrice,
    tickets: ticketNumbers.map(num => ({ ticket_number: num })),
    idempotent: true,
    reservation_id: reservationId // Optional
  };
  
  // 4. Call edge function
  const { data, error } = await supabase.functions.invoke(
    'purchase-tickets-with-bonus',
    { body: requestBody }
  );
  
  // 5. Handle response
  if (error || data?.status === 'error') {
    console.error('Purchase failed:', error || data.error);
    return { success: false, error: error?.message || data?.error };
  }
  
  if (data?.status === 'ok') {
    console.log('Success!', {
      tickets: data.tickets,
      newBalance: data.new_balance
    });
    return { success: true, data };
  }
  
  return { success: false, error: 'Unknown error' };
}
```

## Using the Service (Recommended)

```typescript
import { BalancePaymentService } from '@/lib/balance-payment-service';

// One-line purchase
const result = await BalancePaymentService.purchaseWithBalance({
  competitionId: 'comp-123',
  ticketNumbers: [1, 5, 10],
  userId: 'user-456',
  ticketPrice: 1.00,
  reservationId: 'res-789' // Optional
});

if (result.success) {
  console.log('Purchased!', result.data.new_balance);
} else {
  console.error('Failed:', result.error);
}
```

## Key Points

1. **Idempotency Key**: Generate once, reuse on retries
2. **Canonical User ID**: Always convert with `toCanonicalUserId()`
3. **Required Fields**: userId, competition_id, tickets, ticketPrice
4. **Response**: Check `status === 'ok'` for success
5. **Balance**: New balance returned in `new_balance` field

## Error Handling

```typescript
const { success, data, error, errorDetails } = await BalancePaymentService.purchaseWithBalance({
  // ... params
});

if (!success) {
  switch (errorDetails?.type) {
    case 'insufficient_balance':
      alert('Please top up your balance');
      break;
    case 'conflict':
      alert('Tickets no longer available');
      break;
    case 'network':
      // Retry with same idempotency key
      retry();
      break;
    default:
      alert(error);
  }
}
```

## Complete Flow

```typescript
// 1. Reserve tickets (optional)
const reservation = await BalancePaymentService.reserveTickets({
  userId: user.id,
  competitionId: comp.id,
  ticketNumbers: [1, 2, 3]
});

// 2. Purchase with balance
const purchase = await BalancePaymentService.purchaseWithBalance({
  competitionId: comp.id,
  ticketNumbers: reservation.data.ticket_numbers,
  userId: user.id,
  ticketPrice: comp.ticketPrice,
  reservationId: reservation.data.reservation_id
});

// 3. Update UI
if (purchase.success) {
  setBalance(purchase.data.new_balance);
  showSuccess('Tickets purchased!');
}
```

## See Also

- [Complete Guide](/docs/FRONTEND_PURCHASE_GUIDE.md) - Full documentation with examples
- [Balance Payment Service](/src/lib/balance-payment-service.ts) - Service implementation
- [Idempotency Keys](/src/lib/idempotency-keys.ts) - Key management
