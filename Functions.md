# Database Functions - Production Reference

**Last Updated:** January 31, 2026  
**Production Status:** 90+ Active Functions  
**Source:** Supabase Production Database + Migration Files

---

## Table of Contents

- [Overview](#overview)
- [Function Categories](#function-categories)
  - [1. User Management (15 functions)](#1-user-management)
  - [2. Balance & Payment Operations (20 functions)](#2-balance--payment-operations)
  - [3. Ticket Operations (18 functions)](#3-ticket-operations)
  - [4. Competition Management (8 functions)](#4-competition-management)
  - [5. Transaction Processing (12 functions)](#5-transaction-processing)
  - [6. Cleanup & Maintenance (8 functions)](#6-cleanup--maintenance)
  - [7. Utility & Helper Functions (10 functions)](#7-utility--helper-functions)
  - [8. Internal Functions (9 functions)](#8-internal-functions)
- [Function Usage Patterns](#function-usage-patterns)
- [Performance Considerations](#performance-considerations)
- [Security & RLS](#security--rls)

---

## Overview

This document catalogs all production database functions (stored procedures) in the ThePrize.io Supabase database. Functions are organized by category with usage examples and best practices.

**Key Statistics:**
- **Total Functions:** 90+
- **Public RPC Functions:** 40+
- **Internal Helper Functions:** 20+
- **Trigger Functions:** 15+
- **Cleanup/Maintenance Jobs:** 8
- **Critical Business Logic:** 35

**Function Types:**
- **RPC Functions:** Called from frontend via Supabase client
- **Trigger Functions:** Called automatically by database triggers
- **Helper Functions:** Internal functions called by other functions
- **Cleanup Functions:** Scheduled via pg_cron or called manually

---

## Function Categories

### 1. User Management
**Purpose:** Handle user registration, authentication, profile management, and multi-wallet support  
**Importance:** 🔴 Critical

| Function Name | Parameters | Returns | Status | Purpose |
|--------------|------------|---------|--------|---------|
| `upsert_canonical_user()` | Multiple identity params | canonical_user record | ✅ Production | Get or create user from any identifier |
| `ensure_canonical_user()` | user_identifier, wallet, privy_id | canonical_user_id | ✅ Production | Ensure user exists |
| `attach_identity_after_auth()` | privy_id, wallet, email | void | ✅ Production | Link auth identity to user |
| `get_user_balance()` | user_identifier, canonical_user_id | balance record | ✅ Production | Get user's USDC & bonus balance |
| `get_user_wallet_balance()` | user_identifier | numeric | ✅ Production | Get total wallet balance |
| `get_user_wallets()` | user_identifier | wallet[] | ✅ Production | List user's linked wallets |
| `link_additional_wallet()` | user_id, wallet, nickname | boolean | ✅ Production | Link new wallet to account |
| `unlink_wallet()` | user_id, wallet | boolean | ✅ Production | Remove wallet from account |
| `set_primary_wallet()` | user_id, wallet | boolean | ✅ Production | Set primary wallet |
| `update_wallet_nickname()` | user_id, wallet, nickname | boolean | ✅ Production | Update wallet display name |
| `get_linked_external_wallet()` | user_identifier | wallet_address | ✅ Production | Get linked external wallet |
| `unlink_external_wallet()` | user_identifier | boolean | ✅ Production | Unlink external wallet |
| `update_user_profile_by_identifier()` | user_id, profile_data | boolean | ✅ Production | Update user profile |
| `update_user_avatar()` | user_id, avatar_url | boolean | ✅ Production | Update avatar image |
| `create_user_if_not_exists()` | user_data | canonical_user_id | ✅ Production | Create user if needed |

**Key Functions:**

#### `upsert_canonical_user()`
```sql
CREATE OR REPLACE FUNCTION upsert_canonical_user(
  p_privy_user_id TEXT DEFAULT NULL,
  p_wallet_address TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_username TEXT DEFAULT NULL,
  p_avatar_url TEXT DEFAULT NULL,
  p_smart_wallet_address TEXT DEFAULT NULL
) RETURNS TABLE(canonical_user_id TEXT, is_new_user BOOLEAN)
```
**Purpose:** Central user management - get existing or create new canonical user  
**Used By:** Frontend auth flows, wallet connections  
**Returns:** User ID and whether user was just created  
**Importance:** 🔴 Critical - foundation of identity system

#### `ensure_canonical_user()`
```sql
CREATE OR REPLACE FUNCTION ensure_canonical_user(
  p_user_identifier TEXT DEFAULT NULL,
  p_wallet_address TEXT DEFAULT NULL,
  p_privy_user_id TEXT DEFAULT NULL
) RETURNS TEXT
```
**Purpose:** Guarantee canonical_user_id exists, creating if necessary  
**Used By:** Transaction processing, ticket purchases  
**Returns:** canonical_user_id  
**Importance:** 🔴 Critical - ensures data consistency

---

### 2. Balance & Payment Operations
**Purpose:** Manage user balances, process payments, handle deposits/withdrawals  
**Importance:** 🔴 Critical

| Function Name | Parameters | Returns | Status | Purpose |
|--------------|------------|---------|--------|---------|
| `execute_balance_payment()` | canonical_user_id, amount, comp_id, order_id | result JSON | ✅ Production | Process balance payment |
| `credit_user_balance()` | user_id, amount | new_balance | ✅ Production | Add funds to user balance |
| `credit_sub_account_balance()` | canonical_user_id, amount, currency | new_balance | ✅ Production | Credit specific sub-account |
| `credit_balance_with_first_deposit_bonus()` | canonical_user_id, amount | new_balance | ✅ Production | Credit + first deposit bonus |
| `credit_balance_topup()` | user_id, amount, tx_data | transaction_id | ✅ Production | Process topup transaction |
| `credit_sub_account_with_bonus()` | canonical_user_id, usdc, bonus | balances | ✅ Production | Credit both USDC & bonus |
| `debit_user_balance()` | user_id, amount | new_balance | ✅ Production | Deduct from user balance |
| `debit_sub_account_balance()` | canonical_user_id, amount, currency | new_balance | ✅ Production | Debit specific sub-account |
| `debit_balance_and_confirm()` | user_id, amount, comp_id | result | ✅ Production | Debit + confirm tickets |
| `debit_balance_and_confirm_tickets()` | canonical_user_id, amount, comp_id | result | ✅ Production | Debit + ticket confirmation |
| `debit_balance_and_finalize_order()` | order_id | result | ✅ Production | Debit + finalize order |
| `debit_balance_confirm_tickets()` | canonical_user_id, amount, comp_id | result | ✅ Production | Combined debit+confirm |
| `debit_sub_account_balance_with_entry()` | canonical_user_id, amount, comp_id | result | ✅ Production | Debit + create entry |
| `add_pending_balance()` | user_id, amount | pending_balance | ✅ Production | Add to pending balance |
| `migrate_user_balance()` | user_identifier | success | ✅ Production | Migrate legacy balance |
| `check_first_deposit_bonus_eligibility()` | canonical_user_id | boolean | ✅ Production | Check if eligible for bonus |
| `award_first_topup_bonus()` | canonical_user_id, topup_amount | bonus_amount | ✅ Production | Award first deposit bonus |
| `award_first_topup_bonus_via_webhook()` | canonical_user_id, topup_amount | bonus_amount | ✅ Production | Award bonus from webhook |
| `award_welcome_bonus()` | canonical_user_id | bonus_amount | ✅ Production | Award signup bonus |
| `ensure_sub_account_balance_row()` | canonical_user_id, currency | void | ✅ Production | Ensure balance row exists |

**Key Functions:**

#### `execute_balance_payment()`
```sql
CREATE OR REPLACE FUNCTION execute_balance_payment(
  p_canonical_user_id TEXT,
  p_amount_usd NUMERIC,
  p_competition_id TEXT,
  p_order_id TEXT,
  p_ticket_count INTEGER DEFAULT 1
) RETURNS JSON
```
**Purpose:** Main balance payment processor - handles all ticket purchases via balance  
**Flow:**
1. Validate sufficient balance
2. Debit sub-account(s) (BONUS first, then USDC)
3. Create balance_ledger entry
4. Confirm pending tickets
5. Update competition stats
**Returns:** `{success: true, transaction_id, balance_after}` or error  
**Importance:** 🔴 Mission Critical - core payment flow

#### `credit_sub_account_balance()`
```sql
CREATE OR REPLACE FUNCTION credit_sub_account_balance(
  p_canonical_user_id TEXT,
  p_amount NUMERIC(20, 6),
  p_currency TEXT DEFAULT 'USDC',
  p_reference_id TEXT DEFAULT NULL,
  p_transaction_id TEXT DEFAULT NULL,
  p_source TEXT DEFAULT 'deposit'
) RETURNS NUMERIC
```
**Purpose:** Safely add funds to user's sub-account  
**Features:**
- Creates sub-account row if missing
- Records in balance_ledger for audit
- Updates canonical_users.usdc_balance
- Thread-safe with row locking
**Returns:** New balance after credit  
**Importance:** 🔴 Critical - foundation of deposits

#### `debit_sub_account_balance()`
```sql
CREATE OR REPLACE FUNCTION debit_sub_account_balance(
  p_canonical_user_id TEXT,
  p_amount NUMERIC(20, 6),
  p_currency TEXT DEFAULT 'USDC',
  p_reference_id TEXT DEFAULT NULL,
  p_transaction_id TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL
) RETURNS NUMERIC
```
**Purpose:** Safely remove funds from user's sub-account  
**Features:**
- Validates sufficient balance
- Records in balance_ledger
- Updates canonical_users.usdc_balance
- Prevents negative balances (raises exception)
**Returns:** New balance after debit  
**Importance:** 🔴 Critical - prevents overspending

---

### 3. Ticket Operations
**Purpose:** Handle ticket reservations, confirmations, availability checks  
**Importance:** 🔴 Critical

| Function Name | Parameters | Returns | Status | Purpose |
|--------------|------------|---------|--------|---------|
| `reserve_tickets()` | comp_id, user_id, count | reservation_id | ✅ Production | Reserve tickets for purchase |
| `reserve_tickets_atomically()` | comp_id, user_id, count, idempotency | reservation_id | ✅ Production | Atomic reservation with retry |
| `release_reservation()` | reservation_id | boolean | ✅ Production | Cancel/expire reservation |
| `confirm_pending_tickets()` | pending_ticket_id | tickets[] | ✅ Production | Convert pending → sold |
| `confirm_pending_tickets_with_balance()` | canonical_user_id, comp_id | result | ✅ Production | Confirm + debit balance |
| `confirm_pending_to_sold()` | pending_id | success | ✅ Production | Finalize ticket sale |
| `confirm_ticket_purchase()` | order_id | tickets[] | ✅ Production | Confirm tickets from order |
| `confirm_tickets()` | order_id | success | ✅ Production | Mark tickets as sold |
| `confirm_payment_and_issue_tickets()` | order_id, payment_data | result | ✅ Production | Complete payment flow |
| `confirm_purchase_by_ref()` | webhook_ref | result | ✅ Production | Confirm via webhook |
| `get_unavailable_tickets()` | comp_id | ticket_numbers[] | ✅ Production | Get sold/reserved tickets |
| `get_competition_unavailable_tickets()` | comp_id | ticket_numbers[] | ✅ Production | Alias for above |
| `get_available_ticket_count_v2()` | comp_id | count | ✅ Production | Available tickets count |
| `get_competition_ticket_availability_text()` | comp_id | text | ✅ Production | "X tickets remaining" |
| `check_ticket_availability()` | comp_id, ticket_numbers[] | boolean | ✅ Production | Check if tickets available |
| `allocate_lucky_dip_tickets_batch()` | comp_id, user_id, count | ticket_numbers[] | ✅ Production | Random ticket allocation |
| `create_ticket_hold()` | comp_id, ticket_numbers | hold_id | ✅ Production | Temporary hold on tickets |
| `finalize_ticket_hold()` | hold_id | success | ✅ Production | Convert hold to sale |

**Key Functions:**

#### `reserve_tickets_atomically()`
```sql
CREATE OR REPLACE FUNCTION reserve_tickets_atomically(
  p_competition_id TEXT,
  p_user_identifier TEXT,
  p_ticket_count INTEGER,
  p_idempotency_key TEXT DEFAULT NULL
) RETURNS TABLE(
  reservation_id TEXT,
  pending_ticket_id TEXT,
  expires_at TIMESTAMPTZ,
  ticket_numbers INTEGER[]
)
```
**Purpose:** Atomic ticket reservation with race condition protection  
**Flow:**
1. Check idempotency key (prevent duplicates)
2. Lock competition row (prevent overselling)
3. Get unavailable tickets (sold + pending)
4. Select random available tickets
5. Create pending_tickets header
6. Create pending_ticket_items for each ticket
7. Return reservation details
**Features:**
- SERIALIZABLE isolation level
- Idempotency support
- 10-minute expiry
- Automatic cleanup on error
**Returns:** Reservation ID, ticket numbers, expiry  
**Importance:** 🔴 Mission Critical - prevents double-booking

#### `confirm_pending_tickets()`
```sql
CREATE OR REPLACE FUNCTION confirm_pending_tickets(
  p_pending_ticket_id TEXT
) RETURNS TABLE(
  ticket_id TEXT,
  ticket_number INTEGER,
  competition_id TEXT
)
```
**Purpose:** Finalize pending reservation into sold tickets  
**Flow:**
1. Validate pending_tickets record exists
2. For each pending_ticket_item:
   - Insert into tickets table
   - Mark pending_ticket_item as 'confirmed'
3. Update pending_tickets status to 'completed'
4. Update competition.sold_tickets
5. Check if competition sold out
**Returns:** Array of created ticket records  
**Importance:** 🔴 Critical - final step of purchase

#### `get_unavailable_tickets()`
```sql
CREATE OR REPLACE FUNCTION get_unavailable_tickets(
  p_competition_id TEXT
) RETURNS INTEGER[]
```
**Purpose:** Get all ticket numbers that cannot be sold  
**Includes:**
- Sold tickets (tickets table)
- Pending tickets (pending_ticket_items with status='pending', not expired)
**Used By:** Ticket reservation, availability checks  
**Returns:** Array of ticket numbers  
**Importance:** 🔴 Critical - prevents double-booking  
**Performance:** Indexed on competition_id, status, expires_at

---

### 4. Competition Management
**Purpose:** Competition lifecycle, winner selection, status updates  
**Importance:** 🟡 Important

| Function Name | Parameters | Returns | Status | Purpose |
|--------------|------------|---------|--------|---------|
| `get_competition_entries()` | comp_id | entries[] | ✅ Production | Get all competition entries |
| `get_competition_entries_public()` | comp_id | entries[] | ✅ Production | Public entries (RLS-safe) |
| `get_competition_entries_bypass_rls()` | comp_id | entries[] | ✅ Production | Admin entries view |
| `get_user_competition_entries()` | user_id, comp_id | entries[] | ✅ Production | User's entries in comp |
| `get_user_active_tickets()` | user_id | tickets[] | ✅ Production | User's active tickets |
| `end_competition_and_select_winners()` | comp_id, winner_count | winners[] | ✅ Production | Run VRF winner selection |
| `check_and_mark_competition_sold_out()` | comp_id | boolean | ✅ Production | Mark as sold out if full |
| `sync_competition_status_if_ended()` | comp_id | void | ✅ Production | Update status if ended |

**Key Functions:**

#### `end_competition_and_select_winners()`
```sql
CREATE OR REPLACE FUNCTION end_competition_and_select_winners(
  p_competition_id TEXT,
  p_num_winners INTEGER DEFAULT 1,
  p_vrf_seed TEXT DEFAULT NULL
) RETURNS TABLE(
  winner_ticket_number INTEGER,
  winner_user_id TEXT,
  winner_wallet_address TEXT,
  prize_tier INTEGER
)
```
**Purpose:** Fairly select competition winners using VRF (Verifiable Random Function)  
**Flow:**
1. Validate competition is ended
2. Get all sold ticket numbers
3. Use VRF or fallback random for selection
4. Create winner records
5. Update competition status to 'completed'
6. Trigger winner notifications
**Features:**
- Provably fair with VRF
- Fallback to secure random
- Multi-tier prize support
- Prevents duplicate winners
**Returns:** Winner details  
**Importance:** 🔴 Critical - determines prize distribution

---

### 5. Transaction Processing
**Purpose:** Financial transaction handling, order processing  
**Importance:** 🔴 Critical

| Function Name | Parameters | Returns | Status | Purpose |
|--------------|------------|---------|--------|---------|
| `get_user_transactions()` | user_id, limit, offset | transactions[] | ✅ Production | User transaction history |
| `create_order_for_reservation()` | reservation_id | order_id | ✅ Production | Create order from reservation |
| `finalize_order()` | order_id | success | ✅ Production | Complete order processing |
| `finalize_purchase()` | order_id, payment_data | result | ✅ Production | Finalize purchase |
| `finalize_purchase2()` | order_id, payment_data | result | ✅ Production | Updated finalize logic |
| `complete_topup_on_webhook_ref()` | webhook_ref | success | ✅ Production | Complete topup via webhook |
| `convert_specific_deposit()` | tx_id | success | ✅ Production | Convert custody deposit |
| `enter_competition()` | comp_id, user_id, tickets | entry_id | ✅ Production | Create competition entry |
| `enter_competition_and_deduct()` | comp_id, user_id, tickets | result | ✅ Production | Enter + deduct balance |
| `create_entry_charge()` | user_id, comp_id, amount | charge_id | ✅ Production | Create payment charge |
| `claim_prize()` | winner_id | claim_data | ✅ Production | Claim competition prize |
| `enqueue_cdp_event()` | event_type, user_id, data | event_id | ✅ Production | Queue CDP event |

**Key Functions:**

#### `finalize_order()`
```sql
CREATE OR REPLACE FUNCTION finalize_order(
  p_order_id TEXT
) RETURNS JSON
```
**Purpose:** Complete order processing after payment confirmed  
**Flow:**
1. Validate order exists and is pending
2. Get associated pending_tickets
3. Confirm pending tickets (convert to sold)
4. Update order status to 'completed'
5. Create user_transactions record
6. Update competition stats
**Returns:** `{success, tickets_issued, competition_id}`  
**Importance:** 🔴 Critical - final order processing

---

### 6. Cleanup & Maintenance
**Purpose:** Automated cleanup jobs, data maintenance  
**Importance:** 🟡 Important

| Function Name | Parameters | Returns | Status | Purpose |
|--------------|------------|---------|--------|---------|
| `cleanup_expired_holds()` | - | count | ✅ Production | Remove expired ticket holds |
| `cleanup_expired_idempotency()` | - | count | ✅ Production | Remove old idempotency keys |
| `cleanup_expired_pending_tickets()` | - | count | ✅ Production | Expire old pending tickets |
| `cleanup_expired_reservations()` | - | count | ✅ Production | Release expired reservations |
| `cleanup_old_data()` | days_old | count | ✅ Production | Archive/delete old records |
| `cleanup_stale_transactions()` | - | count | ✅ Production | Clean stuck transactions |
| `check_database_health()` | - | health_report | ✅ Production | Database health check |
| `check_external_usdc_balance()` | - | balance | ✅ Production | Check custody wallet balance |

**Scheduling:**
These functions are typically called via:
- Supabase pg_cron jobs (hourly/daily)
- Manual admin triggers
- Post-deployment health checks

**Example pg_cron setup:**
```sql
-- Run every 10 minutes
SELECT cron.schedule('cleanup-expired-holds', '*/10 * * * *', 
  'SELECT cleanup_expired_pending_tickets()');

-- Run daily at 3 AM
SELECT cron.schedule('cleanup-old-data', '0 3 * * *', 
  'SELECT cleanup_old_data(90)');
```

---

### 7. Utility & Helper Functions
**Purpose:** Shared utilities, formatting, calculations  
**Importance:** 🟢 Supporting

| Function Name | Parameters | Returns | Status | Purpose |
|--------------|------------|---------|--------|---------|
| `gen_random_uuid()` | - | uuid | ✅ Production | Generate UUID (pgcrypto) |
| `gen_random_bytes()` | length | bytea | ✅ Production | Random bytes |
| `gen_salt()` | type | text | ✅ Production | Generate bcrypt salt |
| `gen_deterministic_tx_id()` | seed_data | text | ✅ Production | Deterministic transaction ID |
| `crypt()` | password, salt | text | ✅ Production | Bcrypt hash (pgcrypto) |
| `encrypt()` | data, key, type | bytea | ✅ Production | Encrypt data |
| `decrypt()` | data, key, type | bytea | ✅ Production | Decrypt data |
| `digest()` | data, type | bytea | ✅ Production | Hash data (SHA256, etc.) |
| `armor()` | data | text | ✅ Production | ASCII armor encoding |
| `dearmor()` | data | bytea | ✅ Production | ASCII armor decoding |

**Notes:**
- Most are from pgcrypto extension
- Used for security, hashing, encryption
- gen_deterministic_tx_id ensures idempotent transaction IDs

---

### 8. Internal Functions
**Purpose:** Internal helpers called by other functions/triggers  
**Importance:** 🟢 Supporting (but critical for system)

| Function Name | Parameters | Returns | Status | Purpose |
|--------------|------------|---------|--------|---------|
| `_apply_wallet_delta()` | canonical_user_id, delta | new_balance | ✅ Production | Apply balance change atomically |
| `_deduct_sub_account_balance()` | canonical_user_id, amount, currency | new_balance | ✅ Production | Internal debit logic |
| `_get_competition_price()` | comp_id | price | ✅ Production | Get ticket price |
| `_get_user_competition_entries_unified()` | user_id, comp_id | entries[] | ✅ Production | Unified entry query |
| `_insert_user_spend_tx()` | user_id, amount, comp_id | tx_id | ✅ Production | Record spend transaction |
| `_ticket_cuid()` | user_id, wallet, privy_id | canonical_user_id | ✅ Production | Derive canonical user ID |
| `_wallet_delta_from_txn()` | tx_record | delta_amount | ✅ Production | Calculate wallet delta |
| `_run_backfill_now()` | - | count | ✅ Production | Run data backfill |
| `_test_block()` | - | void | ✅ Production | Test/debugging function |

**Notes:**
- Prefixed with `_` to indicate internal use
- Not meant to be called directly from frontend
- Called by other functions or triggers
- Often more permissive (bypass RLS)

---

## Function Usage Patterns

### Frontend RPC Call Pattern

```typescript
// Using Supabase client
import { supabase } from '@/lib/supabase'

// Reserve tickets
const { data, error } = await supabase.rpc('reserve_tickets_atomically', {
  p_competition_id: 'comp_123',
  p_user_identifier: 'user_abc',
  p_ticket_count: 5,
  p_idempotency_key: 'unique_key_123'
})

// Execute balance payment
const { data, error } = await supabase.rpc('execute_balance_payment', {
  p_canonical_user_id: 'user_abc',
  p_amount_usd: 25.00,
  p_competition_id: 'comp_123',
  p_order_id: 'order_456',
  p_ticket_count: 5
})

// Get user balance
const { data, error } = await supabase.rpc('get_user_balance', {
  p_canonical_user_id: 'user_abc'
})
```

### Error Handling

Functions use PostgreSQL's exception handling:

```sql
-- Function with error handling
CREATE OR REPLACE FUNCTION debit_sub_account_balance(
  p_canonical_user_id TEXT,
  p_amount NUMERIC
) RETURNS NUMERIC AS $$
DECLARE
  v_current_balance NUMERIC;
BEGIN
  -- Get current balance with row lock
  SELECT balance INTO v_current_balance
  FROM sub_account_balances
  WHERE canonical_user_id = p_canonical_user_id
  FOR UPDATE;

  -- Check sufficient balance
  IF v_current_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance: % < %', v_current_balance, p_amount;
  END IF;

  -- Debit balance
  UPDATE sub_account_balances
  SET balance = balance - p_amount
  WHERE canonical_user_id = p_canonical_user_id;

  RETURN v_current_balance - p_amount;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Failed to debit balance: %', SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

Frontend handling:
```typescript
try {
  const { data, error } = await supabase.rpc('debit_sub_account_balance', {
    p_canonical_user_id: userId,
    p_amount: 25.00
  })
  
  if (error) {
    if (error.message.includes('Insufficient balance')) {
      // Show "add funds" prompt
    } else {
      // Generic error handling
    }
  }
} catch (err) {
  console.error('Payment failed:', err)
}
```

---

## Performance Considerations

### 1. Use Prepared Statements
```sql
-- Good: Prepared statement
PREPARE reserve_stmt (text, text, int) AS
  SELECT * FROM reserve_tickets_atomically($1, $2, $3);

EXECUTE reserve_stmt('comp_123', 'user_abc', 5);
```

### 2. Avoid N+1 Queries
```sql
-- Bad: Loop with queries
FOR ticket IN SELECT * FROM tickets WHERE competition_id = p_comp_id LOOP
  PERFORM some_operation(ticket.id);
END LOOP;

-- Good: Bulk operation
UPDATE tickets 
SET status = 'completed'
WHERE competition_id = p_comp_id;
```

### 3. Use Indexes Effectively
```sql
-- Ensure indexes exist for function queries
-- See Indexes.md for full index list

-- Example: get_unavailable_tickets uses these indexes:
-- - idx_tickets_competition_id
-- - idx_pending_ticket_items_comp_status_expires
-- - idx_tickets_status
```

### 4. Transaction Isolation
```sql
-- Use appropriate isolation levels
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;
  -- Critical operations (reservations, payments)
COMMIT;

BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED;
  -- Read-heavy operations
COMMIT;
```

### 5. Row Locking
```sql
-- Lock rows to prevent race conditions
SELECT balance 
FROM sub_account_balances 
WHERE canonical_user_id = p_user_id
FOR UPDATE;  -- Exclusive lock until transaction commits
```

---

## Security & RLS

### Function Security Models

**SECURITY DEFINER:**
- Function runs with privileges of function owner
- Use for privileged operations (balance modifications)
- ⚠️ **Validate all inputs** - bypass RLS, so must be careful

```sql
CREATE OR REPLACE FUNCTION credit_sub_account_balance(...)
RETURNS NUMERIC
SECURITY DEFINER  -- Runs as postgres user
SET search_path = public, pg_temp
AS $$ ... $$;
```

**SECURITY INVOKER:**
- Function runs with privileges of caller
- Use for read operations that respect RLS
- Safer but more limited

```sql
CREATE OR REPLACE FUNCTION get_user_tickets(p_user_id TEXT)
RETURNS TABLE(...)
SECURITY INVOKER  -- Runs as current user
AS $$ ... $$;
```

### RLS Bypass Functions

Some functions intentionally bypass RLS for admin/system operations:
- `get_competition_entries_bypass_rls()`
- `_get_user_competition_entries_unified()`
- Internal `_*` functions

**Always validate:**
1. User identity (canonical_user_id)
2. Authorization (is user allowed to perform action?)
3. Input sanitization (prevent SQL injection)
4. Amount limits (prevent abuse)

### Input Validation Example

```sql
CREATE OR REPLACE FUNCTION credit_sub_account_balance(
  p_canonical_user_id TEXT,
  p_amount NUMERIC
) RETURNS NUMERIC AS $$
BEGIN
  -- Validate canonical_user_id format
  IF p_canonical_user_id IS NULL OR p_canonical_user_id = '' THEN
    RAISE EXCEPTION 'Invalid canonical_user_id';
  END IF;

  -- Validate amount is positive
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive: %', p_amount;
  END IF;

  -- Validate amount not too large (prevent abuse)
  IF p_amount > 100000 THEN
    RAISE EXCEPTION 'Amount exceeds maximum: %', p_amount;
  END IF;

  -- Validate user exists
  IF NOT EXISTS (SELECT 1 FROM canonical_users WHERE canonical_user_id = p_canonical_user_id) THEN
    RAISE EXCEPTION 'User not found: %', p_canonical_user_id;
  END IF;

  -- Proceed with operation
  ...
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## Function Monitoring

### Track Function Performance

```sql
-- Enable pg_stat_statements
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- View function call statistics
SELECT 
  schemaname,
  funcname,
  calls,
  total_time,
  mean_time,
  max_time
FROM pg_stat_user_functions
WHERE schemaname = 'public'
ORDER BY total_time DESC
LIMIT 20;

-- Reset statistics
SELECT pg_stat_statements_reset();
```

### Log Function Calls (Optional)

```sql
-- Add logging to critical functions
CREATE OR REPLACE FUNCTION execute_balance_payment(...)
RETURNS JSON AS $$
DECLARE
  v_start_time TIMESTAMPTZ := clock_timestamp();
  v_result JSON;
BEGIN
  -- Function logic
  ...
  
  -- Log execution time
  RAISE NOTICE 'execute_balance_payment took %ms', 
    EXTRACT(milliseconds FROM clock_timestamp() - v_start_time);
  
  RETURN v_result;
END;
$$ LANGUAGE plpgsql;
```

---

## Migration Status

### ✅ In Baseline Migration (`00000000000000_initial_schema.sql`)
Core functions (~40) are in the baseline schema:
- User management functions
- Balance operations
- Ticket reservations
- Competition queries
- Transaction processing

### 🔶 In Recent Migrations
- `execute_balance_payment()` - 20260130000000_simplified_balance_payment.sql
- `credit_sub_account_balance()` - 20260128152500_secure_credit_sub_account_balance.sql
- `debit_sub_account_balance()` - 20260128152400_add_debit_sub_account_balance.sql

### 📋 Production-Only (Not Yet in Migrations)
Some utility and cleanup functions exist only in production:
- CDP integration functions
- Advanced cleanup jobs
- Diagnostic functions

---

## Best Practices

### 1. Always Use Transactions
```sql
CREATE OR REPLACE FUNCTION my_function(...)
RETURNS ... AS $$
BEGIN
  -- All modifications in transaction
  ...
  
  -- Will auto-rollback on exception
  RETURN result;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Operation failed: %', SQLERRM;
END;
$$ LANGUAGE plpgsql;
```

### 2. Use Explicit Locking for Critical Sections
```sql
-- Lock user balance row
SELECT balance FROM sub_account_balances
WHERE canonical_user_id = p_user_id
FOR UPDATE;  -- Others wait here
```

### 3. Return Structured Data
```sql
-- Good: Return JSON with clear structure
RETURN json_build_object(
  'success', true,
  'transaction_id', v_tx_id,
  'balance_after', v_new_balance,
  'timestamp', NOW()
);

-- Bad: Return single value when multiple outputs needed
```

### 4. Idempotency for Payment Operations
```sql
-- Check idempotency key first
IF EXISTS (SELECT 1 FROM payment_idempotency 
           WHERE idempotency_key = p_key) THEN
  RETURN 'already_processed';
END IF;

-- Record idempotency
INSERT INTO payment_idempotency (idempotency_key, ...)
VALUES (p_key, ...);

-- Proceed with operation
...
```

### 5. Comprehensive Error Messages
```sql
-- Include context in exceptions
RAISE EXCEPTION 'Failed to reserve tickets for user % in competition %: %',
  p_user_id, p_competition_id, SQLERRM;
```

---

## Related Documentation
- [Triggers.md](./Triggers.md) - Database trigger reference
- [Indexes.md](./Indexes.md) - Database index reference
- [BASELINE_MIGRATION_README.md](./BASELINE_MIGRATION_README.md) - Migration guide
- [SCHEMA_AUDIT_REPORT.md](./SCHEMA_AUDIT_REPORT.md) - Schema audit results

---

**Document Version:** 1.0  
**Maintainer:** Database Team  
**Last Audit:** January 31, 2026
