# Frontend Developer Quick Links

## Getting Started with Purchase Integration

Need to implement ticket purchases with balance payment? Start here:

### 📚 Documentation
- **[Quick Start Guide](./docs/QUICK_START_PURCHASE.md)** - 5-minute minimal example
- **[Complete Guide](./docs/FRONTEND_PURCHASE_GUIDE.md)** - Full documentation with examples
- **[Documentation Index](./docs/README.md)** - All available guides

### 💻 Code Resources
- **[TypeScript Types](./src/types/purchase-tickets.ts)** - Type definitions for type safety
- **[React Hook](./src/hooks/usePurchaseWithBalance.ts)** - Production-ready hook implementation
- **[Balance Payment Service](./src/lib/balance-payment-service.ts)** - Service layer
- **[Idempotency Keys](./src/lib/idempotency-keys.ts)** - Key management utilities

### 🚀 Quick Example

```typescript
import { BalancePaymentService } from '@/lib/balance-payment-service';

// Purchase tickets with balance
const result = await BalancePaymentService.purchaseWithBalance({
  competitionId: 'comp-123',
  ticketNumbers: [1, 5, 10],
  userId: 'user-456',
  ticketPrice: 1.00
});

if (result.success) {
  console.log('New balance:', result.data.new_balance);
}
```

### 🔍 Need Help?
- Troubleshooting → [Guide Section](./docs/FRONTEND_PURCHASE_GUIDE.md#troubleshooting)
- Error Handling → [Guide Section](./docs/FRONTEND_PURCHASE_GUIDE.md#error-handling)
- Testing → [Guide Section](./docs/FRONTEND_PURCHASE_GUIDE.md#testing)

---

**Last Updated:** 2026-02-07
