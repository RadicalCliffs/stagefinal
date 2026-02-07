# Documentation Index

## Frontend Development Guides

### Purchase and Payment Integration

#### [Frontend Purchase Guide](./FRONTEND_PURCHASE_GUIDE.md)
**Complete guide** for integrating the `purchase-tickets-with-bonus` edge function.

Covers:
- Complete client flow with code examples
- Idempotency key management
- Error handling and retry logic
- React component integration
- Balance updates and real-time sync
- Testing strategies
- Troubleshooting guide
- API reference

**Start here** if you're implementing purchase functionality from scratch.

#### [Quick Start: Purchase](./QUICK_START_PURCHASE.md)
**Quick reference** with minimal examples.

Includes:
- 5-step minimal example
- Service-based approach
- Key points checklist
- Common error handling patterns

**Start here** if you already understand the concepts and need a quick reference.

### Type Definitions

#### [Purchase Types](../src/types/purchase-tickets.ts)
TypeScript type definitions for:
- Request/response interfaces
- Type guards
- Result wrappers
- Full JSDoc documentation

Import these in your TypeScript code:
```typescript
import type { 
  PurchaseWithBalanceOptions,
  PurchaseTicketsResponse
} from '@/types/purchase-tickets';
```

### Example Code

#### [React Hook](../src/hooks/usePurchaseWithBalance.ts)
Production-ready React hook demonstrating:
- Complete purchase flow
- Automatic retry with exponential backoff
- Idempotency key management
- Loading/error/success states
- Balance update events

Copy and adapt this for your implementation.

## Service Layer

### Existing Services

#### Balance Payment Service
Location: `src/lib/balance-payment-service.ts`

High-level service for balance payments:
```typescript
import { BalancePaymentService } from '@/lib/balance-payment-service';

// Reserve tickets
const reservation = await BalancePaymentService.reserveTickets({
  userId, competitionId, ticketNumbers
});

// Purchase with balance
const purchase = await BalancePaymentService.purchaseWithBalance({
  competitionId, ticketNumbers, userId, ticketPrice, reservationId
});
```

#### Idempotency Key Manager
Location: `src/lib/idempotency-keys.ts`

Manages idempotency keys with automatic persistence:
```typescript
import { idempotencyKeyManager } from '@/lib/idempotency-keys';

// Get or create key (reused on retries)
const key = idempotencyKeyManager.getOrCreateKey(reservationId);

// Mark as terminal after success
idempotencyKeyManager.markTerminal(reservationId);
```

## Edge Functions

### purchase-tickets-with-bonus
Location: `supabase/functions/purchase-tickets-with-bonus/`

Server-side function that:
- Validates user balance
- Debits balance atomically
- Allocates tickets
- Returns new balance and ticket info

Endpoint: `POST /functions/v1/purchase-tickets-with-bonus`

## Quick Links

### New to the codebase?
1. Read [Quick Start: Purchase](./QUICK_START_PURCHASE.md)
2. Review [Purchase Types](../src/types/purchase-tickets.ts)
3. Examine [React Hook](../src/hooks/usePurchaseWithBalance.ts)
4. Refer to [Complete Guide](./FRONTEND_PURCHASE_GUIDE.md) as needed

### Implementing purchase flow?
1. Import `BalancePaymentService` from `@/lib/balance-payment-service`
2. Use TypeScript types from `@/types/purchase-tickets`
3. Follow patterns from [React Hook](../src/hooks/usePurchaseWithBalance.ts)
4. Reference [Error Handling](./FRONTEND_PURCHASE_GUIDE.md#error-handling) section

### Debugging issues?
1. Check [Troubleshooting](./FRONTEND_PURCHASE_GUIDE.md#troubleshooting) section
2. Review [Common Errors](./FRONTEND_PURCHASE_GUIDE.md#common-errors-and-how-to-handle-them)
3. Verify [Idempotency Key Management](./FRONTEND_PURCHASE_GUIDE.md#idempotency-key-management)

## Related Documentation

- `debug/FIX_PURCHASE_TICKETS_BONUS_SUMMARY.md` - Technical implementation details
- `debug/BASE_ACCOUNT_PAYMENT.md` - Base Account SDK integration
- `debug/PAYMENT_FIXES_SUMMARY.md` - Payment system fixes and improvements

## Contributing

When adding new documentation:
1. Update this index
2. Follow existing documentation structure
3. Include code examples
4. Add TypeScript types when applicable
5. Test all code examples
