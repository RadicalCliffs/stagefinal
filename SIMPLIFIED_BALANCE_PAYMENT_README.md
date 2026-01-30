# Simplified Balance Payment System

## Overview

This implementation replaces the complex, multi-fallback payment system with a **straightforward, single-path** balance payment flow.

## What Changed

### Before (Complex System)
- 2197+ lines of complex logic in `purchase-tickets-with-bonus`
- Multiple fallback paths across different tables
- Sync logic between `sub_account_balances`, `wallet_balances`, `canonical_users`
- Unclear error states and failure modes
- Hard to debug and maintain

### After (Simplified System)
- **Single RPC function** `purchase_tickets_with_balance` (~400 lines) that does everything atomically
- **Single edge function** wrapper (~300 lines) 
- **One source of truth**: `sub_account_balances` table
- Clear success/error responses
- Easy to understand and debug

## How It Works

### 1. Check Balance
```sql
SELECT available_balance FROM sub_account_balances
WHERE canonical_user_id = ? AND currency = 'USD'
FOR UPDATE; -- Lock for atomic update
```

### 2. Match User
Supports multiple identifier formats:
- `canonical_user_id` (e.g., `prize:pid:0x...`)
- Wallet addresses (case-insensitive match via `canonical_users`)
- Privy DIDs

### 3. Deduct Balance
```sql
UPDATE sub_account_balances
SET available_balance = available_balance - total_cost
WHERE canonical_user_id = ? AND currency = 'USD';
```

### 4. Allocate Tickets
- **Selected tickets**: Use the exact ticket numbers provided
- **Lucky dip**: Randomly select from available tickets using Fisher-Yates shuffle

### 5. Create Entry
```sql
INSERT INTO joincompetition (...) VALUES (...);
INSERT INTO tickets (...) SELECT ...;
```

### 6. Return Response
```json
{
  "success": true,
  "entry_id": "uuid",
  "ticket_numbers": [1, 5, 10],
  "ticket_count": 3,
  "total_cost": 15.00,
  "previous_balance": 100.00,
  "new_balance": 85.00,
  "competition_id": "comp-uuid"
}
```

## API Contract

### Purchase Tickets with Balance

**Endpoint**: `POST /functions/v1/purchase-tickets-with-bonus`

**Request Body**:
```json
{
  "competition_id": "uuid",
  "tickets": [
    { "ticket_number": 1 },
    { "ticket_number": 5 },
    { "ticket_number": 10 }
  ],
  "idempotent": true
}
```

**Success Response** (200):
```json
{
  "status": "ok",
  "success": true,
  "competition_id": "uuid",
  "tickets": [
    { "ticket_number": 1 },
    { "ticket_number": 5 },
    { "ticket_number": 10 }
  ],
  "entry_id": "uuid",
  "ticket_count": 3,
  "total_cost": 15.00,
  "previous_balance": 100.00,
  "new_balance": 85.00
}
```

**Error Response** (400/402/404/500):
```json
{
  "status": "error",
  "error": "Insufficient balance",
  "errorCode": "INSUFFICIENT_BALANCE"
}
```

## Error Codes

| Code | Status | Meaning |
|------|--------|---------|
| `INSUFFICIENT_BALANCE` | 402 | User doesn't have enough balance |
| `NO_BALANCE_RECORD` | 400 | User has no balance record (needs to top up first) |
| `COMPETITION_NOT_FOUND` | 404 | Competition doesn't exist |
| `INVALID_JSON` | 400 | Request body is not valid JSON |
| `MISSING_USER` | 400 | User identifier not provided |
| `MISSING_COMPETITION` | 400 | Competition ID not provided |
| `MISSING_TICKETS` | 400 | Tickets array not provided or empty |
| `INVALID_TICKET_NUMBERS` | 400 | Ticket numbers are invalid |
| `RPC_ERROR` | 500 | Database RPC call failed |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

## Database Schema

### Table: `sub_account_balances`
```sql
CREATE TABLE sub_account_balances (
  id TEXT PRIMARY KEY,
  canonical_user_id TEXT NOT NULL,
  currency TEXT DEFAULT 'USD' NOT NULL,
  available_balance NUMERIC(20, 6) DEFAULT 0 NOT NULL,
  pending_balance NUMERIC(20, 6) DEFAULT 0 NOT NULL,
  bonus_balance NUMERIC(20, 6) DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(canonical_user_id, currency)
);
```

### RPC: `purchase_tickets_with_balance`
```sql
purchase_tickets_with_balance(
  p_user_identifier TEXT,
  p_competition_id TEXT,
  p_ticket_price NUMERIC,
  p_ticket_count INTEGER DEFAULT NULL,
  p_ticket_numbers INTEGER[] DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
) RETURNS JSONB
```

### RPC: `get_user_balance`
```sql
get_user_balance(
  p_user_identifier TEXT
) RETURNS JSONB
```

## Migration

Apply the migration:
```bash
supabase migration up
```

Or manually run:
```bash
psql -f supabase/migrations/20260130000000_simplified_balance_payment.sql
```

## Testing

### Test Balance Check
```sql
SELECT get_user_balance('prize:pid:0x1234...');
-- Returns: {"success": true, "balance": 100.00, "currency": "USD"}
```

### Test Purchase
```sql
SELECT purchase_tickets_with_balance(
  'prize:pid:0x1234...',
  'competition-uuid',
  5.0,
  NULL,
  ARRAY[1, 2, 3],
  'test-idempotency-key'
);
-- Returns: {"success": true, "entry_id": "...", "ticket_numbers": [1,2,3], ...}
```

### Test Insufficient Balance
```sql
-- User with $10 balance trying to buy $50 worth of tickets
SELECT purchase_tickets_with_balance(
  'prize:pid:0x1234...',
  'competition-uuid',
  10.0,
  NULL,
  ARRAY[1, 2, 3, 4, 5],
  NULL
);
-- Returns: {"success": false, "error": "Insufficient balance", "error_code": "INSUFFICIENT_BALANCE", ...}
```

## Frontend Integration

The frontend already uses `BalancePaymentService.purchaseWithBalance()` which has been updated to work with the simplified system. No changes needed to calling code.

```typescript
import { BalancePaymentService } from '@/lib/balance-payment-service';

const result = await BalancePaymentService.purchaseWithBalance({
  competitionId: 'uuid',
  ticketNumbers: [1, 5, 10]
});

if (result.success) {
  console.log('New balance:', result.data.new_balance);
  console.log('Tickets:', result.data.tickets);
} else {
  console.error('Error:', result.error);
}
```

## Benefits

1. **Simplicity**: Single code path, easy to understand
2. **Atomicity**: All operations in one transaction
3. **Performance**: No redundant syncing across multiple tables
4. **Reliability**: One source of truth eliminates consistency issues
5. **Maintainability**: Less code = fewer bugs
6. **Debuggability**: Clear logs, clear error messages

## Files Changed

- ✅ `supabase/migrations/20260130000000_simplified_balance_payment.sql` - New RPC functions
- ✅ `supabase/functions/purchase-tickets-with-bonus/index.ts` - Simplified to ~300 lines
- ✅ `src/lib/balance-payment-service.ts` - Updated comments and response handling
- 📦 `supabase/functions/purchase-tickets-with-bonus/index.ts.backup` - Backup of old complex version

## Rollback

If needed, restore the old version:
```bash
mv supabase/functions/purchase-tickets-with-bonus/index.ts.backup \
   supabase/functions/purchase-tickets-with-bonus/index.ts
```

And drop the new functions:
```sql
DROP FUNCTION IF EXISTS purchase_tickets_with_balance(TEXT, TEXT, NUMERIC, INTEGER, INTEGER[], TEXT);
DROP FUNCTION IF EXISTS get_user_balance(TEXT);
```
