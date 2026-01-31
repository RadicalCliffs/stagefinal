# Database Functions Documentation

## Table of Contents

- [Overview](#overview)
- [Balance Management Functions](#balance-management-functions)
- [User Profile & Identity Functions](#user-profile--identity-functions)
- [Wallet Management Functions](#wallet-management-functions)
- [Ticket Management Functions](#ticket-management-functions)
- [Competition Management Functions](#competition-management-functions)
- [User Query Functions](#user-query-functions)
- [Payment Functions](#payment-functions)
- [Utility Functions](#utility-functions)
- [Security & Permissions](#security--permissions)

---

## Overview

This document catalogs all database functions (stored procedures/RPCs) in the ThePrize.io Supabase schema. These functions handle critical operations including balance management, ticket purchasing, user authentication, and competition management.

**Total Functions:** 48  
**Migration Files:**
- `00000000000000_initial_schema.sql` - 43 core functions
- `20260128152400_add_debit_sub_account_balance.sql` - 1 function
- `20260128152500_secure_credit_sub_account_balance.sql` - 1 updated function
- `20260130000000_simplified_balance_payment.sql` - 2 functions

**Security Model:** Most functions use `SECURITY DEFINER` with `SET search_path = public` to execute with elevated privileges while preventing SQL injection.

---

## Balance Management Functions

### `get_user_balance`
**Signature:**
```sql
get_user_balance(
  p_user_identifier TEXT DEFAULT NULL,
  p_canonical_user_id TEXT DEFAULT NULL
) RETURNS JSONB
```

**Purpose:** Get user's current balance from sub_account_balances table.

**Parameters:**
- `p_user_identifier` - User wallet address, Privy DID, or canonical ID
- `p_canonical_user_id` - Alternative parameter for canonical user ID

**Returns:**
```json
{
  "success": true,
  "balance": 100.00,
  "bonus_balance": 20.00,
  "total_balance": 120.00
}
```

**Security:** `SECURITY DEFINER`, accessible to authenticated users  
**Usage:** Called by dashboard, purchase flows, and balance checks

---

### `get_user_wallet_balance`
**Signature:**
```sql
get_user_wallet_balance(user_identifier TEXT) RETURNS JSONB
```

**Purpose:** Alias for `get_user_balance` for backwards compatibility.

**Security:** `SECURITY DEFINER`, accessible to authenticated users

---

### `credit_user_balance`
**Signature:**
```sql
credit_user_balance(
  p_user_id TEXT,
  p_amount NUMERIC
) RETURNS VOID
```

**Purpose:** Credit balance to user's sub-account. Creates balance ledger entry for audit trail.

**Parameters:**
- `p_user_id` - User ID or canonical_user_id
- `p_amount` - Amount to credit (positive numeric)

**Security:** `SECURITY DEFINER`, **service_role only**  
**Used By:** Top-up webhooks, admin operations

---

### `credit_sub_account_balance`
**Signature:**
```sql
credit_sub_account_balance(
  p_canonical_user_id TEXT,
  p_amount NUMERIC,
  p_currency TEXT DEFAULT 'USD'
) RETURNS JSONB
```

**Purpose:** Credit balance to user's sub-account with currency support. Validates amount is positive.

**Parameters:**
- `p_canonical_user_id` - User's canonical ID
- `p_amount` - Amount to credit (must be > 0)
- `p_currency` - Currency code (default: 'USD')

**Returns:**
```json
{
  "success": true,
  "balance": 150.00
}
```

**Security:** `SECURITY DEFINER`, **service_role only** (as of migration 20260128152500)  
**Migration:** Updated in `secure_credit_sub_account_balance` to add validation and restrict access

---

### `debit_sub_account_balance`
**Signature:**
```sql
debit_sub_account_balance(
  p_canonical_user_id TEXT,
  p_amount NUMERIC,
  p_currency TEXT DEFAULT 'USD'
) RETURNS TABLE(
  success BOOLEAN,
  previous_balance NUMERIC,
  new_balance NUMERIC,
  error_message TEXT
)
```

**Purpose:** Atomically debit balance from user's sub-account. Uses row-level locking to prevent concurrent modifications.

**Parameters:**
- `p_canonical_user_id` - User's canonical ID
- `p_amount` - Amount to debit (must be > 0)
- `p_currency` - Currency code (default: 'USD')

**Returns:**
```json
{
  "success": true,
  "previous_balance": 100.00,
  "new_balance": 75.00,
  "error_message": null
}
```

**Error Codes:**
- "Amount must be greater than zero"
- "User balance record not found"
- "Insufficient balance. Available: X, Required: Y"

**Security:** `SECURITY DEFINER`, **service_role only**  
**Migration:** Added in `add_debit_sub_account_balance` (20260128152400)  
**Used By:** `purchase-tickets-with-bonus` edge function

**Implementation Notes:**
- Uses `FOR UPDATE` to lock balance row during transaction
- Logs debits as negative amounts in balance_ledger for consistency
- Credits are positive, debits are negative in ledger

---

### `credit_balance_with_first_deposit_bonus`
**Signature:**
```sql
credit_balance_with_first_deposit_bonus(
  p_canonical_user_id TEXT,
  p_amount NUMERIC,
  p_reason TEXT,
  p_reference_id TEXT
) RETURNS JSONB
```

**Purpose:** Credit balance with automatic 20% first deposit bonus if eligible.

**Parameters:**
- `p_canonical_user_id` - User's canonical ID
- `p_amount` - Base deposit amount
- `p_reason` - Reason for credit
- `p_reference_id` - Transaction reference

**Bonus Logic:**
- Checks `canonical_users.has_used_new_user_bonus`
- If false/null, adds 20% bonus to bonus_balance
- Marks bonus as used
- Logs in bonus_award_audit table

**Security:** `SECURITY DEFINER`, **service_role only**

---

### `add_pending_balance`
**Signature:**
```sql
add_pending_balance(
  user_identifier TEXT,
  amount NUMERIC
) RETURNS JSONB
```

**Purpose:** Add pending balance awaiting confirmation.

**Parameters:**
- `user_identifier` - User canonical ID, UID, or wallet
- `amount` - Amount to add to pending balance

**Returns:**
```json
{
  "success": true,
  "canonical_user_id": "prize:pid:0x..."
}
```

**Security:** `SECURITY DEFINER`

---

### `migrate_user_balance`
**Signature:**
```sql
migrate_user_balance(p_user_identifier TEXT) RETURNS JSONB
```

**Purpose:** Placeholder for legacy balance migration (currently no-op).

**Security:** `SECURITY DEFINER`

---

## User Profile & Identity Functions

### `upsert_canonical_user`
**Signature:**
```sql
upsert_canonical_user(
  p_uid TEXT,
  p_canonical_user_id TEXT,
  p_email TEXT DEFAULT NULL,
  p_username TEXT DEFAULT NULL,
  p_wallet_address TEXT DEFAULT NULL,
  p_base_wallet_address TEXT DEFAULT NULL,
  p_eth_wallet_address TEXT DEFAULT NULL,
  p_privy_user_id TEXT DEFAULT NULL
) RETURNS JSONB
```

**Purpose:** Create or update canonical user record. Primary function for user identity management.

**Parameters:**
- `p_uid` - Unique user identifier
- `p_canonical_user_id` - Canonical user ID (defaults to uid)
- `p_email` - User email
- `p_username` - Display username
- `p_wallet_address` - Primary wallet address
- `p_base_wallet_address` - Base chain wallet
- `p_eth_wallet_address` - Ethereum wallet
- `p_privy_user_id` - Privy authentication ID

**Returns:**
```json
{
  "success": true,
  "user_id": "prize:pid:0x..."
}
```

**Security:** `SECURITY DEFINER`  
**Used By:** User registration, profile updates, wallet linking

---

### `update_user_profile_by_identifier`
**Signature:**
```sql
update_user_profile_by_identifier(
  p_user_identifier TEXT,
  p_username TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_country TEXT DEFAULT NULL,
  p_telephone_number TEXT DEFAULT NULL,
  p_telegram_handle TEXT DEFAULT NULL
) RETURNS JSONB
```

**Purpose:** Update user profile information.

**Parameters:**
- `p_user_identifier` - User canonical ID, UID, or wallet
- `p_username` - New username
- `p_email` - New email
- `p_country` - Country code
- `p_telephone_number` - Phone number
- `p_telegram_handle` - Telegram handle

**Returns:**
```json
{
  "success": true,
  "updated_count": 1
}
```

**Security:** `SECURITY DEFINER`

---

### `update_user_avatar`
**Signature:**
```sql
update_user_avatar(
  user_identifier TEXT,
  new_avatar_url TEXT
) RETURNS JSONB
```

**Purpose:** Update user avatar URL.

**Security:** `SECURITY DEFINER`

---

### `attach_identity_after_auth`
**Signature:**
```sql
attach_identity_after_auth(
  p_user_id TEXT,
  p_email TEXT,
  p_username TEXT
) RETURNS JSONB
```

**Purpose:** Attach email/username after authentication flow.

**Security:** `SECURITY DEFINER`  
**Used By:** Post-authentication flows

---

## Wallet Management Functions

### `get_user_wallets`
**Signature:**
```sql
get_user_wallets(user_identifier TEXT) RETURNS JSONB
```

**Purpose:** Get all wallet addresses associated with user.

**Returns:**
```json
{
  "success": true,
  "primary_wallet": "0x...",
  "wallets": [...],
  "wallet_address": "0x...",
  "base_wallet_address": "0x...",
  "eth_wallet_address": "0x..."
}
```

**Security:** `SECURITY DEFINER`

---

### `link_additional_wallet`
**Signature:**
```sql
link_additional_wallet(
  user_identifier TEXT,
  p_wallet_address TEXT,
  p_wallet_type TEXT DEFAULT 'ethereum',
  p_nickname TEXT DEFAULT NULL
) RETURNS JSONB
```

**Purpose:** Link additional wallet to user account.

**Parameters:**
- `user_identifier` - User canonical ID or UID
- `p_wallet_address` - Wallet address to link
- `p_wallet_type` - Type (ethereum, base, etc.)
- `p_nickname` - Optional wallet nickname

**Returns:**
```json
{
  "success": true,
  "wallets": [...]
}
```

**Security:** `SECURITY DEFINER`

---

### `unlink_wallet`
**Signature:**
```sql
unlink_wallet(
  user_identifier TEXT,
  p_wallet_address TEXT
) RETURNS JSONB
```

**Purpose:** Remove wallet from user's linked wallets.

**Security:** `SECURITY DEFINER`

---

### `set_primary_wallet`
**Signature:**
```sql
set_primary_wallet(
  user_identifier TEXT,
  p_wallet_address TEXT
) RETURNS JSONB
```

**Purpose:** Set primary wallet for user.

**Security:** `SECURITY DEFINER`

---

### `update_wallet_nickname`
**Signature:**
```sql
update_wallet_nickname(
  user_identifier TEXT,
  p_wallet_address TEXT,
  p_nickname TEXT
) RETURNS JSONB
```

**Purpose:** Update nickname for linked wallet.

**Security:** `SECURITY DEFINER`

---

### `get_linked_external_wallet`
**Signature:**
```sql
get_linked_external_wallet(user_identifier TEXT) RETURNS JSONB
```

**Purpose:** Alias for `get_user_wallets`.

**Security:** `SECURITY DEFINER`

---

### `unlink_external_wallet`
**Signature:**
```sql
unlink_external_wallet(user_identifier TEXT) RETURNS JSONB
```

**Purpose:** Unlink all external wallets.

**Security:** `SECURITY DEFINER`

---

## Ticket Management Functions

### `reserve_tickets`
**Signature:**
```sql
reserve_tickets(
  p_competition_id TEXT,
  p_ticket_numbers INTEGER[],
  p_user_id TEXT,
  p_hold_minutes INTEGER DEFAULT 5
) RETURNS JSONB
```

**Purpose:** Reserve specific ticket numbers for user.

**Parameters:**
- `p_competition_id` - Competition UUID
- `p_ticket_numbers` - Array of ticket numbers to reserve
- `p_user_id` - User identifier
- `p_hold_minutes` - Hold duration (default: 5 minutes)

**Returns:**
```json
{
  "success": true,
  "reservation_id": "uuid",
  "reserved_tickets": [1, 5, 10],
  "expires_at": "2024-01-01T12:05:00Z"
}
```

**Security:** `SECURITY DEFINER`

---

### `reserve_tickets_atomically`
**Signature:**
```sql
reserve_tickets_atomically(
  p_competition_id TEXT,
  p_ticket_count INTEGER,
  p_user_id TEXT,
  p_hold_minutes INTEGER DEFAULT 5
) RETURNS JSONB
```

**Purpose:** Reserve random available tickets atomically (lucky dip).

**Parameters:**
- `p_competition_id` - Competition UUID
- `p_ticket_count` - Number of tickets to reserve
- `p_user_id` - User identifier
- `p_hold_minutes` - Hold duration

**Returns:** Same as `reserve_tickets`

**Security:** `SECURITY DEFINER`

---

### `release_reservation`
**Signature:**
```sql
release_reservation(
  p_reservation_id TEXT,
  p_user_id TEXT
) RETURNS JSONB
```

**Purpose:** Release ticket reservation before expiry.

**Security:** `SECURITY DEFINER`

---

### `allocate_lucky_dip_tickets`
**Signature:**
```sql
allocate_lucky_dip_tickets(
  p_competition_id TEXT,
  p_user_id TEXT,
  p_ticket_count INTEGER
) RETURNS JSONB
```

**Purpose:** Allocate random available tickets.

**Returns:**
```json
{
  "success": true,
  "tickets": [5, 12, 23, 45]
}
```

**Security:** `SECURITY DEFINER`

---

### `allocate_lucky_dip_tickets_batch`
**Signature:**
```sql
allocate_lucky_dip_tickets_batch(
  p_competition_id TEXT,
  p_user_id TEXT,
  p_ticket_count INTEGER
) RETURNS JSONB
```

**Purpose:** Batch allocation of lucky dip tickets (optimized version).

**Security:** `SECURITY DEFINER`

---

### `finalize_order`
**Signature:**
```sql
finalize_order(
  p_reservation_id TEXT,
  p_user_id TEXT,
  p_competition_id TEXT,
  p_unit_price NUMERIC
) RETURNS JSONB
```

**Purpose:** Convert reservation to final purchase.

**Parameters:**
- `p_reservation_id` - Reservation UUID
- `p_user_id` - User identifier
- `p_competition_id` - Competition UUID
- `p_unit_price` - Price per ticket

**Security:** `SECURITY DEFINER`

---

### `get_unavailable_tickets`
**Signature:**
```sql
get_unavailable_tickets(p_competition_id TEXT) RETURNS INT4[]
```

**Purpose:** Get array of unavailable ticket numbers (sold, pending, reserved).

**Returns:** Integer array `[1, 2, 5, 10, ...]`

**Security:** `SECURITY DEFINER`  
**Used By:** Frontend ticket selection UI

---

### `get_competition_unavailable_tickets`
**Signature:**
```sql
get_competition_unavailable_tickets(p_competition_id TEXT) RETURNS INTEGER[]
```

**Purpose:** Alias for `get_unavailable_tickets`.

**Security:** `SECURITY DEFINER`

---

### `get_available_ticket_count_v2`
**Signature:**
```sql
get_available_ticket_count_v2(p_competition_id TEXT) RETURNS INTEGER
```

**Purpose:** Get count of available tickets.

**Returns:** Integer count

**Security:** `SECURITY DEFINER`

---

### `check_and_mark_competition_sold_out`
**Signature:**
```sql
check_and_mark_competition_sold_out(p_competition_id TEXT) RETURNS JSONB
```

**Purpose:** Check if competition is sold out and update status.

**Returns:**
```json
{
  "success": true,
  "is_sold_out": true,
  "status": "sold_out"
}
```

**Security:** `SECURITY DEFINER`

---

## Competition Management Functions

### `sync_competition_status_if_ended`
**Signature:**
```sql
sync_competition_status_if_ended(p_competition_id TEXT) RETURNS JSONB
```

**Purpose:** Update competition status to 'ended' if past end_time.

**Security:** `SECURITY DEFINER`

---

### `get_competition_ticket_availability_text`
**Signature:**
```sql
get_competition_ticket_availability_text(p_competition_id TEXT) RETURNS TEXT
```

**Purpose:** Get human-readable availability text.

**Returns:** 
- "SOLD OUT" 
- "5 left!" 
- "23 available"

**Security:** `SECURITY DEFINER`  
**Used By:** Competition cards, detail pages

---

### `get_recent_entries_count`
**Signature:**
```sql
get_recent_entries_count(
  p_competition_id TEXT,
  p_minutes INTEGER
) RETURNS INTEGER
```

**Purpose:** Get count of entries in last N minutes.

**Security:** `SECURITY DEFINER`  
**Used By:** "X entries in last 5 minutes" display

---

## User Query Functions

### `get_user_transactions`
**Signature:**
```sql
get_user_transactions(p_user_identifier TEXT) RETURNS JSONB
```

**Purpose:** Get user's transaction history (last 100).

**Returns:**
```json
{
  "success": true,
  "transactions": [
    {
      "id": "uuid",
      "amount": 100.00,
      "status": "completed",
      "created_at": "2024-01-01T12:00:00Z"
    }
  ]
}
```

**Security:** `SECURITY DEFINER`

---

### `get_user_tickets`
**Signature:**
```sql
get_user_tickets(
  p_user_identifier TEXT,
  p_competition_id TEXT
) RETURNS JSONB
```

**Purpose:** Get user's tickets for specific competition.

**Returns:**
```json
{
  "success": true,
  "tickets": [1, 5, 10, 25],
  "count": 4
}
```

**Security:** `SECURITY DEFINER`

---

### `get_user_tickets_for_competition`
**Signature:**
```sql
get_user_tickets_for_competition(
  competition_id TEXT,
  user_id TEXT
) RETURNS JSONB
```

**Purpose:** Alias for `get_user_tickets`.

**Security:** `SECURITY DEFINER`

---

### `get_user_active_tickets`
**Signature:**
```sql
get_user_active_tickets(
  p_user_identifier TEXT,
  p_competition_id TEXT
) RETURNS JSONB
```

**Purpose:** Get active tickets (alias for get_user_tickets).

**Security:** `SECURITY DEFINER`

---

### `get_competition_entries`
**Signature:**
```sql
get_competition_entries(
  p_competition_id TEXT,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
) RETURNS JSONB
```

**Purpose:** Get paginated list of competition entries.

**Returns:**
```json
{
  "success": true,
  "entries": [
    {
      "user_id": "prize:pid:0x...",
      "username": "user123",
      "tickets_count": 5,
      "amount_spent": 50.00
    }
  ],
  "total": 150
}
```

**Security:** `SECURITY DEFINER`

---

### `get_competition_entries_bypass_rls`
**Signature:**
```sql
get_competition_entries_bypass_rls(
  p_competition_id TEXT,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
) RETURNS JSONB
```

**Purpose:** Compatibility alias for `get_competition_entries`.

**Security:** `SECURITY DEFINER`

---

### `get_competition_entries_public`
**Signature:**
```sql
get_competition_entries_public(p_competition_id TEXT)
RETURNS TABLE(
  canonical_user_id TEXT,
  username TEXT,
  tickets_count INTEGER,
  amount_spent NUMERIC,
  latest_purchase_at TIMESTAMPTZ
)
```

**Purpose:** Get public competition entries as table.

**Security:** `SECURITY DEFINER`  
**Used By:** Public leaderboard displays

---

### `get_user_competition_entries`
**Signature:**
```sql
get_user_competition_entries(p_user_identifier TEXT)
RETURNS TABLE(
  competition_id TEXT,
  competition_title TEXT,
  tickets_count INTEGER,
  amount_spent NUMERIC,
  is_winner BOOLEAN,
  latest_purchase_at TIMESTAMPTZ
)
```

**Purpose:** Get user's entries across all competitions.

**Security:** `SECURITY DEFINER`  
**Used By:** User dashboard

---

### `get_comprehensive_user_dashboard_entries`
**Signature:**
```sql
get_comprehensive_user_dashboard_entries(p_user_identifier TEXT)
RETURNS TABLE(
  competition_id TEXT,
  competition_title TEXT,
  competition_status TEXT,
  competition_image_url TEXT,
  competition_end_time TIMESTAMPTZ,
  tickets_count INTEGER,
  amount_spent NUMERIC,
  is_winner BOOLEAN,
  prize_title TEXT,
  prize_value NUMERIC,
  latest_purchase_at TIMESTAMPTZ,
  ticket_numbers INTEGER[],
  winner_announced_at TIMESTAMPTZ,
  total_tickets INTEGER,
  tickets_sold INTEGER
)
```

**Purpose:** Comprehensive user dashboard data with competition details.

**Security:** `SECURITY DEFINER`  
**Used By:** Main user dashboard page

---

## Payment Functions

### `execute_balance_payment`
**Signature:**
```sql
execute_balance_payment(
  p_user_identifier TEXT,
  p_competition_id TEXT,
  p_amount NUMERIC,
  p_ticket_count INTEGER,
  p_selected_tickets INTEGER[] DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL,
  p_reservation_id TEXT DEFAULT NULL
) RETURNS JSONB
```

**Purpose:** Execute payment using user's balance (legacy function - deprecated).

**Security:** `SECURITY DEFINER`  
**Status:** Deprecated in favor of `purchase_tickets_with_balance`

---

### `purchase_tickets_with_balance`
**Signature:**
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

**Purpose:** **PRIMARY PAYMENT FUNCTION** - Simplified atomic balance payment with ticket allocation.

**Parameters:**
- `p_user_identifier` - User wallet, canonical ID, or Privy DID
- `p_competition_id` - Competition UUID
- `p_ticket_price` - Price per ticket in USD
- `p_ticket_count` - Number of tickets (lucky dip mode)
- `p_ticket_numbers` - Specific tickets (manual selection)
- `p_idempotency_key` - Optional key to prevent duplicates

**Returns:**
```json
{
  "success": true,
  "entry_id": "uuid",
  "ticket_numbers": [1, 5, 10],
  "ticket_count": 3,
  "total_cost": 30.00,
  "previous_balance": 100.00,
  "new_balance": 70.00,
  "competition_id": "uuid"
}
```

**Error Returns:**
```json
{
  "success": false,
  "error": "Insufficient balance",
  "error_code": "INSUFFICIENT_BALANCE",
  "required": 30.00,
  "available": 20.00
}
```

**Error Codes:**
- `NO_BALANCE_RECORD` - User balance not found
- `INSUFFICIENT_BALANCE` - Not enough balance
- `INTERNAL_ERROR` - Unexpected error

**Features:**
1. **Atomic Transaction** - All-or-nothing operation
2. **Row Locking** - Uses `FOR UPDATE` to prevent race conditions
3. **Idempotency** - Prevents duplicate purchases with same key
4. **Lucky Dip** - Randomly allocates available tickets
5. **Manual Selection** - Validates specific ticket availability
6. **Audit Trail** - Logs to balance_ledger
7. **Dual Table Updates** - Updates both joincompetition and tickets

**Workflow:**
1. Validate inputs (user, competition, price, tickets)
2. Normalize user identifier to canonical format
3. Check for duplicate with idempotency_key
4. Lock and validate user balance
5. Verify competition is active
6. Determine ticket numbers (lucky dip or manual)
7. Calculate cost and check sufficient balance
8. Debit balance atomically
9. Create balance_ledger entry
10. Create joincompetition entry
11. Insert ticket records
12. Return success with details

**Security:** `SECURITY DEFINER`, **service_role only**  
**Migration:** Added in `simplified_balance_payment` (20260130000000)  
**Used By:** `purchase-tickets-with-bonus` edge function  
**Status:** ✅ **ACTIVE - PRIMARY PAYMENT METHOD**

---

### `get_user_balance` (payment variant)
**Signature:**
```sql
get_user_balance(p_user_identifier TEXT) RETURNS JSONB
```

**Purpose:** Get user balance for payment validation. Updated version from simplified_balance_payment migration.

**Returns:**
```json
{
  "success": true,
  "balance": 100.00,
  "currency": "USD"
}
```

**Features:**
- Matches by canonical_user_id
- Matches by wallet address (case-insensitive)
- Returns 0 if no record found
- Checks canonical_users for wallet linkage

**Security:** `SECURITY DEFINER`, accessible to **service_role** and **authenticated**  
**Migration:** Updated in `simplified_balance_payment` (20260130000000)

---

## Utility Functions

### `log_confirmation_incident`
**Signature:**
```sql
log_confirmation_incident(
  p_source TEXT,
  p_error_message TEXT,
  p_error_details JSONB DEFAULT NULL
) RETURNS TEXT
```

**Purpose:** Log payment/confirmation incidents for debugging.

**Parameters:**
- `p_source` - Source of incident (e.g., 'webhook', 'edge_function')
- `p_error_message` - Error message
- `p_error_details` - Additional JSON details

**Returns:** Incident ID (TEXT)

**Security:** `SECURITY DEFINER`  
**Used By:** Error handling in edge functions

---

### `cleanup_expired_idempotency`
**Signature:**
```sql
cleanup_expired_idempotency() RETURNS INTEGER
```

**Purpose:** Clean up old idempotency records past expiry time.

**Returns:** Count of deleted records (INTEGER)

**Security:** `SECURITY DEFINER`  
**Used By:** Scheduled cleanup jobs

---

## Security & Permissions

### Function Security Model

**SECURITY DEFINER:**
- All functions use `SECURITY DEFINER` to execute with database owner privileges
- Prevents privilege escalation attacks
- Validates inputs to prevent SQL injection

**SET search_path = public:**
- Prevents search path injection attacks
- Ensures functions only access public schema

### Permission Levels

**Service Role Only (Most Sensitive):**
- `credit_user_balance` - Prevents unauthorized credits
- `credit_sub_account_balance` - Balance manipulation
- `debit_sub_account_balance` - Balance manipulation
- `purchase_tickets_with_balance` - Payment execution

**Authenticated Users:**
- `get_user_balance` - Read own balance
- `get_user_wallet_balance` - Read own wallet balance
- `get_user_tickets` - Read own tickets
- `get_user_transactions` - Read own transactions
- All query functions for personal data

**Public Access:**
- `get_competition_entries_public` - Public leaderboards
- `get_competition_ticket_availability_text` - Public availability

### Security Best Practices

1. **Input Validation** - All functions validate inputs
2. **Row Locking** - Balance operations use `FOR UPDATE`
3. **Idempotency** - Payment functions support idempotency keys
4. **Audit Trails** - balance_ledger logs all balance changes
5. **Error Messages** - Don't expose internal details
6. **Rate Limiting** - Handled at API/edge function layer

---

## Migration History

| Migration | Functions Added/Updated | Description |
|-----------|------------------------|-------------|
| `00000000000000_initial_schema.sql` | 43 functions | Core RPC functions for all operations |
| `20260128152400_add_debit_sub_account_balance.sql` | `debit_sub_account_balance` | Added atomic debit function with locking |
| `20260128152500_secure_credit_sub_account_balance.sql` | `credit_sub_account_balance` (updated) | Added validation and restricted to service_role |
| `20260130000000_simplified_balance_payment.sql` | `purchase_tickets_with_balance`, `get_user_balance` (updated) | Simplified atomic payment function |

---

## Usage Examples

### Get User Balance
```javascript
const { data } = await supabase.rpc('get_user_balance', {
  p_user_identifier: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb'
});
console.log(data.balance); // 100.00
```

### Purchase Tickets with Balance
```javascript
const { data } = await supabase.rpc('purchase_tickets_with_balance', {
  p_user_identifier: 'prize:pid:0x742d35...',
  p_competition_id: 'comp-uuid',
  p_ticket_price: 10.00,
  p_ticket_count: 5,
  p_idempotency_key: 'purchase-12345'
});
```

### Reserve Specific Tickets
```javascript
const { data } = await supabase.rpc('reserve_tickets', {
  p_competition_id: 'comp-uuid',
  p_ticket_numbers: [1, 5, 10, 25],
  p_user_id: 'user-uuid',
  p_hold_minutes: 5
});
```

### Get Competition Entries
```javascript
const { data } = await supabase.rpc('get_competition_entries', {
  p_competition_id: 'comp-uuid',
  p_limit: 50,
  p_offset: 0
});
```

---

**Last Updated:** 2026-01-30  
**Schema Version:** 1.5  
**Total Functions:** 48
