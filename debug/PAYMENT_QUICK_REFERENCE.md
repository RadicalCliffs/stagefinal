# Payment Processes Quick Reference Guide

For complete details, see [PAYMENT_PROCESSES_JSON_PAYLOADS.md](./PAYMENT_PROCESSES_JSON_PAYLOADS.md)

## Key Payment Functions Summary

| Function | Purpose | Request Fields | Response Fields | Database Tables |
|----------|---------|---------------|-----------------|-----------------|
| **purchase-tickets-with-bonus** | Buy tickets with balance | userId, competitionId, selectedTickets, ticketPrice | success, tickets, balanceAfterPurchase, instantWins | sub_account_balances, tickets, joincompetition, balance_ledger |
| **process-balance-payments** | Process pending transactions | (none - reads from DB) | success, processed, results[] | user_transactions, sub_account_balances, balance_ledger, joincompetition |
| **reserve-tickets** | Reserve tickets (15 min) | userId, competitionId, selectedTickets | success, reservationId, expiresAt | pending_tickets |
| **confirm-pending-tickets** | Confirm payment & tickets | reservationId OR (userId + competitionId) | success, ticketNumbers, instantWins | pending_tickets, tickets, joincompetition |
| **create-charge** | Create Coinbase Commerce charge | userId, totalAmount, type, competitionId | success, checkoutUrl, transactionId | user_transactions |
| **commerce-webhook** | Coinbase Commerce webhook | event.type, event.data | success, message | user_transactions, pending_tickets |
| **onramp-init** | Initialize Coinbase Onramp | destinationAddress, assets, presetFiatAmount | success, sessionToken, url | (none) |
| **onramp-webhook** | Coinbase Onramp webhook | eventType, status, walletAddress, paymentTotal | success, message | user_transactions, sub_account_balances, balance_ledger |

## Payment Flows

### Flow 1: Balance Top-Up → Purchase Tickets

```
1. create-charge(type="topup", totalAmount=50)
   → Returns checkoutUrl
   
2. User pays via Coinbase Commerce
   
3. commerce-webhook receives charge:confirmed
   → Updates user_transactions status="credited"
   
4. process-balance-payments (background job)
   → Credits 50 USD + 25 USD bonus (first topup)
   → Updates sub_account_balances.available_balance = 75
   → Records in balance_ledger
   
5. purchase-tickets-with-bonus(competitionId, selectedTickets)
   → Debits 5 USD from balance
   → Creates tickets & joincompetition entry
   → Returns instantWins if any
```

### Flow 2: Direct Ticket Purchase (External Payment)

```
1. reserve-tickets(competitionId, selectedTickets=[1,5,10])
   → Creates pending_tickets entry (15 min hold)
   → Returns reservationId
   
2. create-charge(type="entry", competitionId, reservationId)
   → Creates user_transactions record
   → Returns checkoutUrl
   
3. User pays via Coinbase Commerce
   
4. commerce-webhook receives charge:confirmed
   → Calls confirm-pending-tickets(reservationId)
   → Confirms tickets, creates entries
   → Returns instantWins
```

### Flow 3: Coinbase Onramp Direct Credit

```
1. onramp-init(destinationAddress="0x...")
   → Returns sessionToken + onramp URL
   
2. User completes payment in Coinbase Onramp widget
   
3. onramp-webhook receives onramp.transaction.success
   → Credits balance with 50% first-topup bonus
   → Updates sub_account_balances
   → Records in balance_ledger
   
4. User can now purchase tickets with balance
```

## Critical Database Tables

### user_transactions
Primary payment tracking table.

**Key Fields:**
- `id` (uuid) - Transaction ID
- `user_id` (text) - Canonical user ID (prize:pid:...)
- `competition_id` (text) - Competition UUID (null for top-ups)
- `amount` (numeric) - USD amount
- `status` - pending, waiting, confirming, finished, failed, credited
- `payment_status` - Provider status
- `payment_provider` - coinbase, onramp, balance
- `type` - entry, topup

### sub_account_balances
Primary balance storage (atomic operations via RPCs).

**Key Fields:**
- `canonical_user_id` (text, PK) - User ID (prize:pid:...)
- `available_balance` (numeric) - USD available to spend
- `pending_balance` (numeric) - USD pending confirmation
- `currency` (text) - Always "USD"

### pending_tickets
Ticket reservations (15-minute holds).

**Key Fields:**
- `id` (uuid) - Reservation ID
- `user_id` (text) - Canonical user ID
- `competition_id` (uuid) - Competition
- `ticket_numbers` (integer[]) - Array of reserved tickets
- `status` - pending, confirmed, expired, cancelled
- `expires_at` (timestamptz) - 15 min from creation

### balance_ledger
Audit trail for all balance changes.

**Key Fields:**
- `user_id` (uuid) - User ID (UUID format)
- `balance_type` - real, bonus, pending
- `source` - topup, topup_onramp, purchase, refund, first_topup_bonus
- `amount` (numeric) - Positive=credit, Negative=debit
- `transaction_id` (uuid) - Reference to user_transactions

### tickets
Individual ticket records.

**Key Fields:**
- `competition_id` (uuid)
- `ticket_number` (integer) - Specific ticket (1-N)
- `user_id` (text) - Canonical user ID
- `is_instant_win` (boolean)
- `instant_prize_id` (uuid)

### joincompetition
Competition entry records (for dashboard display).

**Key Fields:**
- `competition_id` (uuid)
- `user_id` (text) - Canonical user ID
- `ticket_count` (integer)
- `transaction_id` (uuid)
- `total_amount` (numeric)

## User Identity System

### Canonical Format
All user IDs use: `prize:pid:<identifier>`

**Examples:**
- Wallet: `prize:pid:0x1234abcd5678...` (wallet address)
- UUID: `prize:pid:550e8400-e29b-41d4-a716-446655440000`
- Legacy: `prize:pid:clg123abc456def789` (Privy ID)

### User Lookup Priority
1. `canonical_users.canonical_user_id`
2. `canonical_users.wallet_address` (for wallet-based)
3. `canonical_users.privy_user_id` (legacy)
4. Create new user if not found

## Critical RPCs

### credit_sub_account_balance
Credits USD balance with automatic 50% first-topup bonus.

```sql
FUNCTION credit_sub_account_balance(
  p_canonical_user_id TEXT,
  p_amount NUMERIC,
  p_transaction_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
) RETURNS JSONB
```

**Auto-applies 50% bonus if:**
- `canonical_users.has_used_new_user_bonus = false`
- Updates flag to `true` after first bonus
- Records separate entries in balance_ledger:
  - Entry 1: Base amount ('real' balance)
  - Entry 2: Bonus amount ('bonus' balance)

### debit_sub_account_balance_with_entry
Atomic: Debit balance + Create joincompetition entry.

```sql
FUNCTION debit_sub_account_balance_with_entry(
  p_canonical_user_id TEXT,
  p_amount NUMERIC,
  p_competition_id UUID,
  p_ticket_count INTEGER,
  p_transaction_id UUID DEFAULT NULL
) RETURNS JSONB
```

### confirm_ticket_purchase
Atomic: Confirm pending tickets + Create tickets + Create entry + Debit balance.

```sql
FUNCTION confirm_ticket_purchase(
  p_reservation_id UUID,
  p_payment_provider TEXT,
  p_transaction_hash TEXT DEFAULT NULL
) RETURNS JSONB
```

## Webhook Security

### Coinbase Commerce
Header: `X-CC-Webhook-Signature`  
Algorithm: HMAC SHA256  
Secret: `COINBASE_COMMERCE_WEBHOOK_SECRET`

```typescript
signature = HMAC-SHA256(secret, rawBody)
```

### Coinbase Onramp (Hook0)
Header: `X-Hook0-Signature`  
Format: `v1,timestamp,signature`  
Algorithm: HMAC SHA256  
Secret: `ONRAMP_WEBHOOK_SECRET`

```typescript
signedPayload = `${timestamp}.${rawBody}`
signature = HMAC-SHA256(secret, signedPayload)
```

## First-Topup Bonus Logic

**Conditions:**
- Applied on first balance top-up only
- 50% of topup amount added as bonus
- Tracked via `canonical_users.has_used_new_user_bonus`

**Example:**
- User tops up $50
- System credits $50 (real) + $25 (bonus) = $75 total
- Balance ledger shows 2 entries:
  1. +$50 (real, source='topup')
  2. +$25 (bonus, source='first_topup_bonus')

**Sources that trigger bonus:**
- Coinbase Commerce top-ups (via commerce-webhook)
- Coinbase Onramp purchases (via onramp-webhook)

## Environment Variables

### Required for Payment Processing

```bash
# Coinbase Commerce
COINBASE_COMMERCE_API_KEY=<api_key>
COINBASE_COMMERCE_WEBHOOK_SECRET=<webhook_secret>

# Coinbase Onramp/CDP
CDC_CLIENT_API_KEY=<client_api_key_id>
CDC_SECRET_API_KEY=<private_key_pem_es256>
ONRAMP_WEBHOOK_SECRET=<hook0_webhook_secret>

# Supabase
SUPABASE_URL=<project_url>
SUPABASE_SERVICE_ROLE_KEY=<service_role_key>

# Application
SUCCESS_URL=<base_url_for_redirects>  # Default: https://substage.theprize.io
```

## Common Error Responses

### Insufficient Balance
```json
{
  "success": false,
  "error": "Insufficient balance",
  "required": 50.00,
  "available": 45.00,
  "shortfall": 5.00
}
```

### Tickets Unavailable
```json
{
  "success": false,
  "error": "Tickets no longer available",
  "requestedTickets": [1, 5, 10],
  "unavailableTickets": [5, 10]
}
```

### Reservation Expired
```json
{
  "success": false,
  "error": "Reservation expired",
  "reservationId": "550e8400-...",
  "expiresAt": "2026-01-23T10:45:00.000Z"
}
```

## Testing Endpoints

### Test Balance Purchase
```bash
curl -X POST https://your-project.supabase.co/functions/v1/purchase-tickets-with-bonus \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "prize:pid:0x1234...",
    "competitionId": "660e8400-...",
    "selectedTickets": [1, 5, 10],
    "ticketPrice": 1.00
  }'
```

### Test Reservation
```bash
curl -X POST https://your-project.supabase.co/functions/v1/reserve-tickets \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "prize:pid:0x1234...",
    "competitionId": "660e8400-...",
    "selectedTickets": [1, 5, 10]
  }'
```

### Test Charge Creation
```bash
curl -X POST https://your-project.supabase.co/functions/v1/create-charge \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "prize:pid:0x1234...",
    "totalAmount": 50.00,
    "type": "topup"
  }'
```

---

**Quick Reference Version:** 1.0  
**Full Documentation:** [PAYMENT_PROCESSES_JSON_PAYLOADS.md](./PAYMENT_PROCESSES_JSON_PAYLOADS.md)  
**Last Updated:** 2026-01-23
