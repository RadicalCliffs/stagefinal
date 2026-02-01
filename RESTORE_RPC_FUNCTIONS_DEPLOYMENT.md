# Production RPC Functions - Migration System Integration

## Overview

This deployment adds 4 critical RPC (Remote Procedure Call) functions to the migration system. These functions already exist in production but were missing from the baseline migrations, causing issues in fresh database setups. These functions are essential for the balance payment system and ticket purchase workflows.

## Background

The frontend code (edge functions) references these RPC functions for atomic balance operations and ticket purchases. These functions were present in the production database but were not included in the initial schema baseline. This restoration ensures consistency across all environments.

## Migration Files

### 1. Core Balance Operations
**File:** `supabase/migrations/20260201004000_restore_production_balance_functions.sql`

Restores two fundamental balance management functions:

#### `credit_sub_account_balance`
- **Purpose:** Atomically credit a user's balance
- **Parameters:**
  - `p_canonical_user_id` (TEXT) - User identifier (supports prize:pid:0x... format)
  - `p_amount` (NUMERIC) - Amount to credit
  - `p_currency` (TEXT) - Currency code (default: 'USD')
  - `p_reference_id` (TEXT) - Optional transaction reference
  - `p_description` (TEXT) - Optional description
- **Features:**
  - Wallet address normalization (handles prize:pid:0x... format)
  - Creates balance record if it doesn't exist
  - Automatic audit trail in `balance_ledger` table
  - Returns: `(success, previous_balance, new_balance, error_message)`
- **Security:** Restricted to `service_role` only
- **Used By:**
  - `supabase/functions/onramp-complete/index.ts`
  - `supabase/functions/onramp-webhook/index.ts`
  - `supabase/functions/process-balance-payments/index.ts`
  - `supabase/functions/purchase-tickets-with-bonus/index.ts` (for rollback)
  - `supabase/functions/reconcile-payments/index.ts`

#### `debit_sub_account_balance`
- **Purpose:** Atomically debit a user's balance with race condition prevention
- **Parameters:** Same as `credit_sub_account_balance`
- **Features:**
  - Row-level locking (`FOR UPDATE`) to prevent concurrent modifications
  - Validates sufficient balance before debit
  - Wallet address normalization
  - Automatic audit trail in `balance_ledger` table
  - Returns: `(success, previous_balance, new_balance, error_message)`
- **Security:** Restricted to `service_role` only
- **Used By:**
  - `supabase/functions/purchase-tickets-with-bonus/index.ts` (primary balance debit)

### 2. Helper Functions
**File:** `supabase/migrations/20260201004100_restore_additional_balance_functions.sql`

Restores two helper functions for ticket purchases and competition entries:

#### `confirm_ticket_purchase`
- **Purpose:** Atomically confirm a pending ticket purchase and debit balance
- **Parameters:**
  - `p_pending_ticket_id` (UUID) - Pending ticket reservation ID
  - `p_payment_provider` (TEXT) - Payment provider (default: 'balance')
- **Features:**
  - Atomic transaction: validates → debits balance → creates tickets → updates ledger
  - Row-level locking on pending ticket and balance
  - Handles already-confirmed and expired reservations
  - Checks for sufficient balance
  - Creates tickets in `tickets` table
  - Creates entry in `joincompetition` table
  - Updates `canonical_users` balance
  - Creates audit entry in `balance_ledger`
  - Returns: JSONB with success status and ticket details
- **Security:** Restricted to `service_role` only
- **Used By:**
  - `supabase/functions/purchase-tickets-with-bonus/index.ts` (fallback confirmation path)

#### `get_joincompetition_entries_for_competition`
- **Purpose:** Retrieve all competition entries for deduplication and validation
- **Parameters:**
  - `p_competition_id` (UUID) - Competition ID
- **Features:**
  - Returns entries sorted by purchase date (newest first)
  - Used for checking duplicate entries
  - Available to both `service_role` and `authenticated` users
- **Used By:**
  - `supabase/functions/select-competition-winners/index.ts`
  - `supabase/functions/confirm-pending-tickets/index.ts`
  - `supabase/functions/purchase-tickets-with-bonus/index.ts`

## Key Features

### Wallet Address Normalization
All balance functions handle multiple wallet address formats:
- Standard format: `0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb7`
- Prize PID format: `prize:pid:0x742d35cc6634c0532925a3b844bc9e7595f0beb7`
- Automatic case normalization (lowercase)

### Race Condition Prevention
The `debit_sub_account_balance` function uses PostgreSQL's `FOR UPDATE` row-level locking to ensure:
- No double-spending
- Atomic balance checks and updates
- Consistent balance state during concurrent requests

### Audit Trail
All balance operations automatically create entries in the `balance_ledger` table with:
- Transaction type (credit/debit)
- Before and after balances
- Reference ID and description
- Timestamp

## Deployment Steps

### Option 1: Supabase CLI (Recommended)
```bash
# Apply both migrations
supabase db push
```

### Option 2: Supabase Studio
1. Open Supabase Studio → SQL Editor
2. Execute `20260201004000_restore_production_balance_functions.sql`
3. Execute `20260201004100_restore_additional_balance_functions.sql`

### Option 3: Manual SQL
```bash
# Apply migrations in order
psql $DATABASE_URL -f supabase/migrations/20260201004000_restore_production_balance_functions.sql
psql $DATABASE_URL -f supabase/migrations/20260201004100_restore_additional_balance_functions.sql
```

## Verification

After deployment, verify the functions exist:

```sql
-- Check all 4 functions are present
SELECT 
  routine_name,
  routine_type,
  data_type as return_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'credit_sub_account_balance',
    'debit_sub_account_balance',
    'confirm_ticket_purchase',
    'get_joincompetition_entries_for_competition'
  )
ORDER BY routine_name;
```

Expected output:
```
routine_name                                  | routine_type | return_type
----------------------------------------------+--------------+-------------
confirm_ticket_purchase                       | FUNCTION     | jsonb
credit_sub_account_balance                    | FUNCTION     | record
debit_sub_account_balance                     | FUNCTION     | record
get_joincompetition_entries_for_competition   | FUNCTION     | record
```

### Test Balance Operations

```sql
-- Test credit (replace with actual user ID)
SELECT * FROM public.credit_sub_account_balance(
  'prize:pid:0x742d35cc6634c0532925a3b844bc9e7595f0beb7',
  10.00,
  'USD',
  'test_credit_001',
  'Test credit operation'
);

-- Test debit (requires existing balance)
SELECT * FROM public.debit_sub_account_balance(
  'prize:pid:0x742d35cc6634c0532925a3b844bc9e7595f0beb7',
  5.00,
  'USD',
  'test_debit_001',
  'Test debit operation'
);

-- Verify audit trail
SELECT * FROM balance_ledger 
WHERE canonical_user_id = 'prize:pid:0x742d35cc6634c0532925a3b844bc9e7595f0beb7'
ORDER BY created_at DESC 
LIMIT 5;
```

## Impact on Frontend

### Edge Functions Using These RPCs

1. **Balance Credits:**
   - `onramp-complete` - Credits balance after successful onramp
   - `onramp-webhook` - Credits balance via webhook
   - `process-balance-payments` - Processes balance credits
   - `reconcile-payments` - Reconciles and credits balances

2. **Balance Debits:**
   - `purchase-tickets-with-bonus` - Debits balance for ticket purchases

3. **Ticket Confirmations:**
   - `purchase-tickets-with-bonus` - Confirms pending ticket purchases
   - `confirm-pending-tickets` - Confirms pending tickets

4. **Competition Entries:**
   - `select-competition-winners` - Gets entries for winner selection
   - `confirm-pending-tickets` - Checks for duplicate entries
   - `purchase-tickets-with-bonus` - Validates entries

### Frontend Type Definitions

The TypeScript types in `src/lib/database.types.ts` reference these functions, so no frontend code changes are needed.

## Rollback Plan

If issues occur, you can drop these functions:

```sql
-- Rollback script
DROP FUNCTION IF EXISTS public.get_joincompetition_entries_for_competition(UUID);
DROP FUNCTION IF EXISTS public.confirm_ticket_purchase(UUID, TEXT);
DROP FUNCTION IF EXISTS public.debit_sub_account_balance(TEXT, NUMERIC, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.credit_sub_account_balance(TEXT, NUMERIC, TEXT, TEXT, TEXT);
```

Note: This will break the edge functions that depend on these RPCs. Only rollback if absolutely necessary.

## Security Notes

- **Service Role Only:** `credit_sub_account_balance`, `debit_sub_account_balance`, and `confirm_ticket_purchase` are restricted to `service_role` to prevent unauthorized balance manipulation
- **Authenticated Access:** `get_joincompetition_entries_for_competition` is available to authenticated users for legitimate lookups
- **PUBLIC Access Revoked:** All sensitive functions have PUBLIC access revoked
- **SECURITY DEFINER:** All functions run with the privileges of the function owner, not the caller

## Monitoring

After deployment, monitor:
1. Edge function logs for RPC call success/failures
2. Balance ledger entries for audit trail
3. Database function execution times (should be < 100ms)
4. Row lock contention on `sub_account_balances` table

## Related Documentation

- `/supabase/migrations/README.md` - Migration system overview
- `/debug/SUPABASE_FUNCTIONS_AND_RPCS.md` - Complete RPC documentation
- `/debug/PAYMENT_ARCHITECTURE.md` - Payment system architecture
- `/debug/IMPLEMENTATION_SUMMARY_BALANCE_RPCS.md` - Balance RPC implementation details

## Questions?

These function definitions were extracted from the production database and added to the migration system. The frontend code was already written to use these functions (which exist in production), but they were missing from the baseline migrations. Adding them to the migration system ensures they exist in all environments (dev, staging, production) and allows fresh database setups to work correctly. They enable the frontend to properly utilize the balance payment system with atomic operations and proper audit trails.
