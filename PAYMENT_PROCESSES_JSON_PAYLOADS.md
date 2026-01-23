# Complete Payment Processes JSON Payloads Documentation

This document provides the **exact JSON payloads** for all payment-related processes in The Prize platform, particularly for Supabase alignment.

## Table of Contents
1. [purchase-tickets-with-bonus](#1-purchase-tickets-with-bonus)
2. [process-balance-payments](#2-process-balance-payments)
3. [reserve-tickets](#3-reserve-tickets)
4. [confirm-pending-tickets](#4-confirm-pending-tickets)
5. [create-charge](#5-create-charge)
6. [commerce-webhook](#6-commerce-webhook)
7. [onramp-init](#7-onramp-init)
8. [onramp-webhook](#8-onramp-webhook)
9. [Database Schemas](#database-schemas)
10. [User Identity Format](#user-identity-format)

---

## 1. purchase-tickets-with-bonus

**Endpoint:** `POST /functions/v1/purchase-tickets-with-bonus`

**Description:** Purchase tickets using balance with automatic bonus application (50% first-topup bonus).

### Request Payload

```json
{
  "userId": "string (optional)",
  "userIdentifier": "string (optional)",
  "canonical_user_id": "text (optional)",
  "walletAddress": "string (optional, 0x...)",
  "wallet_address": "string (optional)",
  "competitionId": "string (UUID)",
  "competition_id": "string (UUID, alternative)",
  "numberOfTickets": "number",
  "number_of_tickets": "number (alternative)",
  "ticketCount": "number (alternative)",
  "ticket_count": "number (alternative)",
  "quantity": "number (alternative)",
  "ticketPrice": "number ($0.10-$100)",
  "ticket_price": "number (alternative)",
  "price": "number (alternative)",
  "selectedTickets": [1, 5, 10, 23],
  "selected_tickets": "[number] (alternative)",
  "tickets": "[number] (alternative)",
  "reservationId": "string (UUID, optional)",
  "reservation_id": "string (UUID, optional)",
  "referenceId": "string (optional, for idempotency)",
  "reference_id": "string (alternative)",
  "txRef": "string (alternative)"
}
```

**Field Notes:**
- Multiple field name variations supported for compatibility
- At least one user identifier required (userId, userIdentifier, canonical_user_id, or walletAddress)
- `competitionId` is required
- Either `selectedTickets` array OR `numberOfTickets` required
- If no reservation exists, uses lucky dip allocation
- `ticketPrice` optional (fetched from competition if not provided)

### Response Payload (Success)

```json
{
  "success": true,
  "ticketsCreated": 5,
  "ticketsPurchased": 5,
  "totalCost": 5.00,
  "balanceAfterPurchase": 45.50,
  "message": "Successfully purchased 5 tickets",
  "tickets": [1, 5, 10, 23, 45],
  "entryCreated": true,
  "entryId": "550e8400-e29b-41d4-a716-446655440000",
  "transactionId": "660e8400-e29b-41d4-a716-446655440001",
  "transactionRef": "PURCHASE_prize:pid:0x1234..._660e8400",
  "instantWins": [
    {
      "ticketNumber": 23,
      "prize": "iPhone 15 Pro",
      "prizeId": "770e8400-e29b-41d4-a716-446655440002"
    }
  ]
}
```

### Response Payload (Error)

```json
{
  "success": false,
  "error": "Insufficient balance",
  "details": "Required: $5.00, Available: $3.50",
  "currentBalance": 3.50,
  "requiredAmount": 5.00
}
```

**Common Error Cases:**
- `"Insufficient balance"` - User doesn't have enough USD balance
- `"Competition not found"` - Invalid competition ID
- `"Tickets not available"` - Selected tickets already sold
- `"Invalid user identifier"` - No valid user ID provided

---

## 2. process-balance-payments

**Endpoint:** `POST /functions/v1/process-balance-payments`

**Description:** Background process that converts pending transactions into balance credits or competition entries. Automatically applies 50% first-topup bonus.

### Request Payload

```json
{}
```

**Note:** No request body required. Function queries `user_transactions` table for pending transactions with `status='pending'` or `status='waiting'` and `payment_status='credited'`.

### Response Payload (Success)

```json
{
  "success": true,
  "message": "Processed 12 balance payments",
  "processed": 12,
  "results": [
    {
      "transactionId": "550e8400-e29b-41d4-a716-446655440000",
      "status": "credited_ledger",
      "amountUsd": 50.00,
      "bonusAmount": 25.00,
      "totalCredit": 75.00,
      "isFirstTopup": true,
      "newBalance": 75.00,
      "error": null
    },
    {
      "transactionId": "660e8400-e29b-41d4-a716-446655440001",
      "status": "processed_entry",
      "amountUsd": 5.00,
      "bonusAmount": 0,
      "totalCredit": 5.00,
      "isFirstTopup": false,
      "newBalance": 70.00,
      "competitionId": "770e8400-e29b-41d4-a716-446655440002",
      "ticketCount": 5,
      "error": null
    },
    {
      "transactionId": "880e8400-e29b-41d4-a716-446655440003",
      "status": "error",
      "amountUsd": 10.00,
      "error": "User not found"
    }
  ]
}
```

**Status Values:**
- `"credited_ledger"` - Top-up transaction credited to balance (with optional bonus)
- `"already_processed"` - Transaction already marked as credited
- `"processed_entry"` - Entry purchase debited balance and created joincompetition entry
- `"marked_credited_unknown_type"` - Unknown transaction type, marked as credited
- `"error"` - Processing failed with error message

**Processing Logic:**
1. **Top-ups** (competition_id IS NULL):
   - Credits `amount` to user's `sub_account_balances`
   - Applies 50% bonus if `has_used_new_user_bonus = false`
   - Records in `balance_ledger` as separate 'real' and 'bonus' entries
   - Sets `has_used_new_user_bonus = true` after first bonus

2. **Entry Purchases** (competition_id IS NOT NULL):
   - Debits `amount` from `sub_account_balances`
   - Creates entry in `joincompetition` table
   - Records in `balance_ledger` with negative amount
   - Uses `debit_sub_account_balance_with_entry` RPC

---

## 3. reserve-tickets

**Endpoint:** `POST /functions/v1/reserve-tickets`

**Description:** Reserve specific ticket numbers for 15 minutes before payment. Creates entry in `pending_tickets` table.

### Request Payload

```json
{
  "userId": "string",
  "userIdentifier": "string (alternative)",
  "user_identifier": "string (alternative)",
  "canonical_user_id": "text (alternative)",
  "user_id": "string (alternative)",
  "competitionId": "string (UUID)",
  "competition_id": "string (alternative)",
  "selectedTickets": [1, 5, 10, 23, 45],
  "ticket_numbers": "[number] (alternative)",
  "ticketIds": "[number] (alternative)",
  "ticketNumbers": "[number] (alternative)",
  "tickets": "[number] (alternative)",
  "ticketPrice": "number (optional, from competition if not provided)",
  "sessionId": "string (optional)"
}
```

**Field Requirements:**
- At least one user identifier required
- `competitionId` required
- `selectedTickets` array required
- `ticketPrice` optional (fetched from competition)

### Response Payload (Success)

```json
{
  "success": true,
  "reservationId": "550e8400-e29b-41d4-a716-446655440000",
  "competitionId": "660e8400-e29b-41d4-a716-446655440001",
  "selectedTickets": [1, 5, 10, 23, 45],
  "ticketNumbers": [1, 5, 10, 23, 45],
  "ticketCount": 5,
  "ticketPrice": 1.00,
  "totalAmount": 5.00,
  "expiresAt": "2026-01-23T11:00:00.000Z",
  "userIdentifier": "prize:pid:0x1234",
  "message": "Tickets reserved successfully"
}
```

### Response Payload (Error)

```json
{
  "success": false,
  "error": "Some tickets are no longer available",
  "unavailableTickets": [5, 23],
  "availableTickets": [1, 10, 45]
}
```

**Common Errors:**
- `"Some tickets are no longer available"` - Selected tickets already sold or reserved
- `"Competition not found"` - Invalid competition ID
- `"Invalid ticket numbers"` - Tickets outside valid range

---

## 4. confirm-pending-tickets

**Endpoint:** `POST /functions/v1/confirm-pending-tickets`

**Description:** Confirm payment and convert pending tickets to sold tickets. Creates entries in `tickets` and `joincompetition` tables. Handles instant win prizes.

### Request Payload

```json
{
  "reservationId": "string (UUID, optional)",
  "userId": "string (required if no reservationId)",
  "competitionId": "string (UUID, optional)",
  "transactionHash": "string (optional, for idempotency)",
  "paymentProvider": "balance | coinbase_commerce | onchainkit_checkout",
  "walletAddress": "string (optional, 0x...)",
  "network": "string (optional, e.g., 'base')",
  "sessionId": "string (optional, transaction session ID)",
  "selectedTickets": "[number] (optional)",
  "ticketCount": "number"
}
```

**Two Confirmation Paths:**
1. **Reservation Path** (reservationId provided):
   - Uses ticket numbers from `pending_tickets`
   - Validates reservation not expired
   - Confirms exact tickets reserved

2. **Lucky Dip Path** (no reservationId):
   - Allocates random available tickets
   - Uses `ticketCount` to determine quantity
   - Falls back if specific tickets unavailable

### Response Payload (Success)

```json
{
  "success": true,
  "reservationId": "550e8400-e29b-41d4-a716-446655440000",
  "ticketNumbers": [1, 5, 10, 23, 45],
  "ticketCount": 5,
  "totalAmount": 5.00,
  "instantWins": [
    {
      "ticketNumber": 23,
      "prize": "iPhone 15 Pro",
      "prizeId": "770e8400-e29b-41d4-a716-446655440002"
    }
  ],
  "soldOut": false,
  "message": "Tickets confirmed successfully",
  "alreadyConfirmed": false,
  "confirmationInProgress": false
}
```

### Response Payload (Already Confirmed)

```json
{
  "success": true,
  "message": "Tickets already confirmed",
  "alreadyConfirmed": true,
  "ticketNumbers": [1, 5, 10, 23, 45]
}
```

### Response Payload (Error)

```json
{
  "success": false,
  "error": "Reservation expired",
  "reservationId": "550e8400-e29b-41d4-a716-446655440000",
  "expiresAt": "2026-01-23T10:45:00.000Z"
}
```

**Common Errors:**
- `"Reservation expired"` - 15-minute window passed
- `"Reservation not found"` - Invalid reservationId
- `"Competition sold out"` - All tickets already sold
- `"Tickets no longer available"` - Selected tickets sold to another user

---

## 5. create-charge

**Endpoint:** `POST /functions/v1/create-charge`

**Description:** Create a Coinbase Commerce charge for ticket purchase or wallet top-up. Creates transaction record and returns checkout URL.

### Request Payload

```json
{
  "userId": "string",
  "competitionId": "string (UUID, optional)",
  "entryPrice": "number (optional)",
  "entryCount": "number (optional)",
  "totalAmount": "number",
  "amount": "number (legacy, use totalAmount)",
  "selectedTickets": [1, 5, 10],
  "reservationId": "string (UUID, optional)",
  "type": "entry | topup",
  "checkoutUrl": "string (optional, for pre-configured products)"
}
```

**Field Requirements:**
- `userId` required
- `totalAmount` or `amount` required (positive number)
- `type` required ('entry' or 'topup')
- For entry: `competitionId` required
- For entry: `entryCount` or `selectedTickets.length` determines quantity

### Response Payload (Success)

```json
{
  "success": true,
  "data": {
    "transactionId": "550e8400-e29b-41d4-a716-446655440000",
    "checkoutUrl": "https://commerce.coinbase.com/charges/ABC123",
    "chargeId": "abc123-def456-ghi789",
    "chargeCode": "ABC123"
  }
}
```

### Response Payload (Error)

```json
{
  "success": false,
  "error": "Payment service configuration error - missing API key",
  "code": "CONFIG_ERROR",
  "hint": "Ensure COINBASE_COMMERCE_API_KEY is set in Supabase secrets"
}
```

**Transaction Record Created:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "user_id": "prize:pid:0x1234...",
  "competition_id": "660e8400-e29b-41d4-a716-446655440001",
  "amount": 50.00,
  "currency": "USD",
  "payment_status": "pending",
  "status": "pending",
  "ticket_count": 5,
  "order_id": "770e8400-e29b-41d4-a716-446655440002",
  "webhook_ref": "COMP_prize:pid:0x1234_660e8400_550e8400",
  "payment_provider": "coinbase",
  "type": "entry"
}
```

**Coinbase Charge Payload Sent:**
```json
{
  "name": "Competition Entry: 5 tickets",
  "description": "Purchase 5 entry tickets for competition",
  "pricing_type": "fixed_price",
  "local_price": {
    "amount": "50.00",
    "currency": "USD"
  },
  "metadata": {
    "user_id": "prize:pid:0x1234...",
    "wallet_address": "0x1234...",
    "competition_id": "660e8400-e29b-41d4-a716-446655440001",
    "entry_count": 5,
    "entry_price": 10.00,
    "reservation_id": "770e8400-e29b-41d4-a716-446655440002",
    "transaction_id": "550e8400-e29b-41d4-a716-446655440000",
    "type": "entry",
    "selected_tickets": "[1,5,10,23,45]"
  },
  "redirect_url": "https://theprize.io/dashboard/entries?payment=success&txId=550e8400",
  "cancel_url": "https://theprize.io/dashboard/entries?payment=cancelled&txId=550e8400"
}
```

---

## 6. commerce-webhook

**Endpoint:** `POST /functions/v1/commerce-webhook`

**Description:** Webhook receiver for Coinbase Commerce payment events. Processes payment confirmations and triggers ticket confirmation or balance credit.

### Request Payload (from Coinbase)

```json
{
  "event": {
    "type": "charge:confirmed | charge:failed | charge:pending | charge:delayed | charge:resolved",
    "data": {
      "id": "abc123-def456-ghi789",
      "code": "ABC123",
      "metadata": {
        "user_id": "prize:pid:0x1234...",
        "competition_id": "660e8400-e29b-41d4-a716-446655440001",
        "transaction_id": "550e8400-e29b-41d4-a716-446655440000",
        "reservation_id": "770e8400-e29b-41d4-a716-446655440002",
        "selected_tickets": "[1,5,10,23,45]",
        "entry_count": 5,
        "wallet_address": "0x1234..."
      },
      "payments": [
        {
          "payer_addresses": ["0x1234abcd..."],
          "transaction_id": "0xabc123def456...",
          "payment_id": "payment_abc123",
          "network": "base"
        }
      ]
    }
  }
}
```

**Headers:**
- `X-CC-Webhook-Signature` - HMAC SHA256 signature for verification

### Response Payload

```json
{
  "success": true,
  "message": "Payment processed",
  "transactionId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Processing Logic:**

1. **Signature Verification:**
   - Validates `X-CC-Webhook-Signature` header
   - Uses `COINBASE_COMMERCE_WEBHOOK_SECRET`

2. **Event Routing:**
   - `charge:confirmed` → Process payment
   - `charge:failed` → Mark transaction failed
   - Other events → Log and ignore

3. **For Confirmed Payments:**
   - **Top-ups** (no competition_id): Update status to 'credited', processed by `process-balance-payments`
   - **Entries** (has competition_id): Call `confirm-pending-tickets` with retry logic (3 attempts, exponential backoff)

4. **Retry Logic:**
   - Attempts: 3 times
   - Delays: 2s, 4s, 8s
   - On final failure: Marks for reconciliation

---

## 7. onramp-init

**Endpoint:** `POST /functions/v1/onramp-init`

**Description:** Initialize Coinbase Onramp session for buying crypto with fiat. Returns session token and onramp URL for widget.

### Request Payload

```json
{
  "destinationAddress": "string (0x..., required)",
  "destinationNetwork": "string (default: 'base')",
  "assets": ["USDC", "ETH"],
  "fiatCurrency": "string (default: 'USD')",
  "presetFiatAmount": "number (optional)",
  "presetCryptoAmount": "number (optional)",
  "defaultAsset": "string (default: 'USDC')",
  "defaultPaymentMethod": "string (default: 'CARD')",
  "partnerUserRef": "string (optional, user ID)",
  "redirectUrl": "string (optional)",
  "defaultExperience": "buy | send (default: 'buy')"
}
```

**Field Requirements:**
- `destinationAddress` required (must be valid 0x... address)
- Address validated with regex: `/^0x[a-fA-F0-9]{40}$/`

### Response Payload (Success)

```json
{
  "success": true,
  "data": {
    "sessionToken": "eyJhbGciOiJFUzI1NiIsImtpZCI6...",
    "url": "https://pay.coinbase.com/buy/select-asset?sessionToken=eyJhbGci...&defaultNetwork=base&defaultAsset=USDC&presetFiatAmount=50",
    "destinationAddress": "0x1234abcd...",
    "destinationNetwork": "base",
    "defaultAsset": "USDC",
    "expiresIn": 120
  }
}
```

### Response Payload (Error)

```json
{
  "success": false,
  "error": "Invalid wallet address format",
  "code": "ONRAMP_INIT_ERROR"
}
```

**Session Token Generation:**
- Uses ES256 JWT with Coinbase CDP API keys
- JWT Header:
  ```json
  {
    "alg": "ES256",
    "kid": "<CDC_CLIENT_API_KEY>",
    "nonce": "<16-byte random hex>",
    "typ": "JWT"
  }
  ```
- JWT Payload:
  ```json
  {
    "iss": "coinbase-cloud",
    "sub": "<CDC_CLIENT_API_KEY>",
    "nbf": 1706000000,
    "exp": 1706000120,
    "uri": "POST api.developer.coinbase.com/onramp/v1/token"
  }
  ```
- Token expires in 2 minutes

**Token API Request to Coinbase:**
```json
{
  "addresses": [
    {
      "address": "0x1234abcd...",
      "blockchains": ["base"]
    }
  ],
  "clientIp": "192.168.1.1",
  "assets": ["USDC", "ETH"]
}
```

---

## 8. onramp-webhook

**Endpoint:** `POST /functions/v1/onramp-webhook`

**Description:** Webhook receiver for Coinbase Onramp (CDP) events. Processes successful onramp purchases and credits user balance with 50% first-topup bonus.

### Request Payload (from Coinbase CDP)

```json
{
  "eventType": "onramp.transaction.created | onramp.transaction.updated | onramp.transaction.success | onramp.transaction.failed",
  "status": "ONRAMP_TRANSACTION_STATUS_IN_PROGRESS | ONRAMP_TRANSACTION_STATUS_COMPLETED",
  "transactionId": "string (optional, guest checkout)",
  "orderId": "string (optional, Apple Pay orders)",
  "partnerUserRef": "string (optional, user ID from partner)",
  "paymentTotal": {
    "currency": "USD",
    "value": "50.00"
  },
  "purchaseAmount": {
    "currency": "USDC",
    "value": "49.50"
  },
  "exchangeRate": {
    "currency": "USD",
    "value": "1.01"
  },
  "paymentMethod": "CARD | GUEST_CHECKOUT_APPLE_PAY",
  "walletAddress": "string (0x...)",
  "destinationAddress": "string (0x...)",
  "purchaseNetwork": "base | ethereum",
  "destinationNetwork": "string",
  "txHash": "string (optional, 0x...)",
  "coinbaseFee": {
    "currency": "USD",
    "value": "0.50"
  },
  "networkFee": {
    "currency": "USD",
    "value": "0.10"
  },
  "country": "US",
  "completedAt": "2026-01-23T10:45:00.000Z"
}
```

**Headers:**
- `X-Hook0-Signature` - Hook0 HMAC signature for verification

### Response Payload

```json
{
  "success": true,
  "message": "Webhook processed",
  "eventType": "onramp.transaction.success",
  "status": "complete"
}
```

**Processing Logic:**

1. **Signature Verification:**
   - Validates `X-Hook0-Signature` header
   - Uses `ONRAMP_WEBHOOK_SECRET`
   - Hook0 format: `v1,timestamp,signature`

2. **Event Filtering:**
   - Only processes: `onramp.transaction.success` with `COMPLETED` status
   - Ignores: `created`, `updated`, `failed` events

3. **Smart Wallet Resolution:**
   - If `walletAddress` is smart contract wallet
   - Resolves to parent EOA wallet
   - Uses `destinationAddress` as canonical wallet

4. **Balance Credit:**
   - Credits `paymentTotal.value` as USD
   - Applies 50% bonus if first topup
   - Uses `credit_sub_account_balance` RPC
   - Records in `balance_ledger`:
     - Entry 1: Base amount as 'real' balance
     - Entry 2: Bonus amount as 'bonus' balance

5. **Transaction Update:**
   - Creates or updates `user_transactions` record
   - Sets `payment_status = 'credited'`
   - Sets `status = 'finished'`
   - Records txHash and network

**Balance Ledger Entries Created:**
```json
[
  {
    "user_id": "prize:pid:0x1234...",
    "balance_type": "real",
    "source": "topup_onramp",
    "amount": 50.00,
    "transaction_id": "550e8400-e29b-41d4-a716-446655440000",
    "metadata": {
      "provider": "coinbase_onramp",
      "txHash": "0xabc123...",
      "network": "base"
    },
    "created_at": "2026-01-23T10:45:00.000Z"
  },
  {
    "user_id": "prize:pid:0x1234...",
    "balance_type": "bonus",
    "source": "first_topup_bonus",
    "amount": 25.00,
    "transaction_id": "550e8400-e29b-41d4-a716-446655440000",
    "metadata": {
      "bonus_percentage": 50,
      "base_amount": 50.00
    },
    "created_at": "2026-01-23T10:45:00.000Z"
  }
]
```

---

## Database Schemas

### user_transactions Table

```sql
CREATE TABLE user_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text,                          -- Canonical user ID (prize:pid:...)
  wallet_address text,                   -- User's wallet address (0x...)
  competition_id text,                   -- Competition UUID (null for top-ups)
  ticket_count integer NOT NULL DEFAULT 1,
  amount numeric(10, 2) NOT NULL,       -- Amount in USD
  session_id text,                       -- Payment session/charge ID
  webhook_ref text,                      -- Webhook reference for matching
  status text NOT NULL DEFAULT 'pending', -- pending, waiting, confirming, finished, failed, credited
  payment_status text,                   -- Provider-specific status
  user_privy_id text,                    -- Legacy Privy user ID
  order_id text,                         -- Internal order/reservation ID
  network text,                          -- Blockchain network (base, ethereum)
  tx_id text,                            -- Transaction hash or charge ID
  currency text DEFAULT 'usd',
  payment_provider text DEFAULT 'nowpayments', -- coinbase, nowpayments, balance, onramp
  pay_currency text,                     -- Cryptocurrency used (USDC, ETH)
  type text,                             -- entry, topup
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  completed_at timestamptz
);
```

**Key Indexes:**
- `idx_user_transactions_user_id`
- `idx_user_transactions_wallet_address`
- `idx_user_transactions_session_id`
- `idx_user_transactions_webhook_ref`
- `idx_user_transactions_order_id`
- `idx_user_transactions_competition_id`
- `idx_user_transactions_tx_id`
- `idx_user_transactions_status`

### pending_tickets Table

```sql
CREATE TABLE pending_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,                 -- Privy user ID or canonical ID
  competition_id UUID NOT NULL,
  ticket_numbers INTEGER[] NOT NULL,     -- Array of reserved ticket numbers
  ticket_count INTEGER NOT NULL,
  ticket_price DECIMAL(10,2) DEFAULT 1.00,
  total_amount DECIMAL(10,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, confirmed, expired, cancelled
  session_id TEXT,                       -- Payment session ID
  transaction_hash TEXT,                 -- Payment tx hash (after confirmation)
  payment_provider TEXT,                 -- balance, coinbase_commerce, onchainkit_checkout
  canonical_user_id TEXT,                -- Canonical user ID (prize:pid:...)
  expires_at TIMESTAMPTZ NOT NULL,       -- 15 minutes from creation
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### sub_account_balances Table

```sql
CREATE TABLE sub_account_balances (
  canonical_user_id TEXT PRIMARY KEY,    -- Unique user ID (prize:pid:...)
  available_balance NUMERIC DEFAULT 0,   -- USD balance available for spending
  pending_balance NUMERIC DEFAULT 0,     -- USD balance pending confirmation
  currency TEXT DEFAULT 'USD',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### balance_ledger Table

```sql
CREATE TABLE balance_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,                 -- UUID from privy_user_connections
  balance_type TEXT NOT NULL,            -- 'real', 'bonus', 'pending'
  source TEXT NOT NULL,                  -- topup, topup_onramp, purchase, refund, bonus, first_topup_bonus
  amount NUMERIC NOT NULL,               -- Positive for credit, negative for debit
  transaction_id UUID,                   -- Reference to user_transactions.id
  metadata JSONB,                        -- Additional transaction data
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP                   -- For bonus expiration (null = no expiry)
);
```

**Balance Types:**
- `'real'` - Real USD balance (from top-ups)
- `'bonus'` - Promotional bonus balance
- `'pending'` - Balance pending confirmation

**Common Sources:**
- `'topup'` - Balance top-up (Coinbase Commerce)
- `'topup_onramp'` - Balance top-up (Coinbase Onramp/CDP)
- `'purchase'` - Ticket purchase (negative amount)
- `'refund'` - Refund (positive amount)
- `'first_topup_bonus'` - 50% first-time top-up bonus
- `'bonus'` - Other promotional bonuses

### tickets Table

```sql
CREATE TABLE tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID NOT NULL,
  ticket_number INTEGER NOT NULL,        -- Specific ticket number (1-N)
  user_id TEXT,                          -- Canonical user ID (prize:pid:...)
  wallet_address TEXT,                   -- User's wallet address
  purchase_date TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'active',          -- active, used, refunded
  is_instant_win BOOLEAN DEFAULT false,
  instant_prize_id UUID,                 -- Reference to Prize_Instantprizes
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(competition_id, ticket_number)
);
```

### joincompetition Table

```sql
CREATE TABLE joincompetition (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID NOT NULL,          -- Competition UUID
  user_id TEXT NOT NULL,                 -- Canonical user ID (prize:pid:...)
  wallet_address TEXT,                   -- User's wallet address
  ticket_count INTEGER DEFAULT 1,        -- Number of tickets purchased
  entry_date TIMESTAMPTZ DEFAULT NOW(),
  transaction_id UUID,                   -- Reference to user_transactions
  payment_method TEXT,                   -- balance, coinbase_commerce, onramp
  total_amount NUMERIC,                  -- Total amount paid
  status TEXT DEFAULT 'active',          -- active, refunded
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### canonical_users Table

```sql
CREATE TABLE canonical_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_user_id TEXT UNIQUE NOT NULL, -- prize:pid:0x... or prize:pid:<uuid>
  privy_user_id TEXT,                    -- Legacy Privy user ID
  wallet_address TEXT,                   -- Primary wallet address
  base_wallet_address TEXT,              -- Base network wallet
  eth_wallet_address TEXT,               -- Ethereum network wallet
  smart_wallet_address TEXT,             -- Smart contract wallet address
  username TEXT,
  email TEXT,
  usdc_balance NUMERIC DEFAULT 0,        -- LEGACY - kept for compatibility
  has_used_new_user_bonus BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## User Identity Format

### Canonical User ID Structure

All user identifiers follow the canonical format:

```
prize:pid:<identifier>
```

Where `<identifier>` is one of:
- **Wallet Address**: `0x1234abcd...` (42 chars, lowercase)
- **UUID**: `550e8400-e29b-41d4-a716-446655440000`
- **Legacy Privy ID**: Original Privy user identifier

**Examples:**
```
prize:pid:0x1234abcd5678ef90abcd1234567890abcdef1234
prize:pid:550e8400-e29b-41d4-a716-446655440000
prize:pid:clg123abc456def789
```

### User Lookup Priority

When resolving a user, functions check in this order:

1. `canonical_user_id` in `canonical_users`
2. `wallet_address` in `canonical_users` (for wallet-based users)
3. `privy_user_id` in `canonical_users` (legacy)
4. Create new user if not found

### Smart Wallet Resolution

For smart contract wallets (e.g., Coinbase Smart Wallet):
- `smart_wallet_address` = Smart contract address
- `wallet_address` = Parent EOA wallet (owner)
- Payments to smart wallet resolve to parent wallet
- Canonical ID uses parent wallet: `prize:pid:0x<parent_wallet>`

---

## Critical RPC Functions

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

**Returns:**
```json
{
  "success": true,
  "new_balance": 75.00,
  "credited_amount": 50.00,
  "bonus_amount": 25.00,
  "is_first_topup": true
}
```

### debit_sub_account_balance

Debits USD balance for purchases.

```sql
FUNCTION debit_sub_account_balance(
  p_canonical_user_id TEXT,
  p_amount NUMERIC,
  p_transaction_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
) RETURNS JSONB
```

**Returns:**
```json
{
  "success": true,
  "new_balance": 70.00,
  "debited_amount": 5.00
}
```

### debit_sub_account_balance_with_entry

Debits balance and creates joincompetition entry atomically.

```sql
FUNCTION debit_sub_account_balance_with_entry(
  p_canonical_user_id TEXT,
  p_amount NUMERIC,
  p_competition_id UUID,
  p_ticket_count INTEGER,
  p_transaction_id UUID DEFAULT NULL
) RETURNS JSONB
```

**Returns:**
```json
{
  "success": true,
  "new_balance": 65.00,
  "entry_id": "770e8400-e29b-41d4-a716-446655440002",
  "debited_amount": 5.00
}
```

### confirm_ticket_purchase

Confirms pending tickets, creates tickets and joincompetition entry, debits balance atomically.

```sql
FUNCTION confirm_ticket_purchase(
  p_reservation_id UUID,
  p_payment_provider TEXT,
  p_transaction_hash TEXT DEFAULT NULL
) RETURNS JSONB
```

**Returns:**
```json
{
  "success": true,
  "ticket_numbers": [1, 5, 10, 23, 45],
  "ticket_count": 5,
  "competition_id": "660e8400-e29b-41d4-a716-446655440001",
  "user_id": "prize:pid:0x1234...",
  "new_balance": 45.00
}
```

---

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

### Invalid User
```json
{
  "success": false,
  "error": "User not found",
  "userId": "prize:pid:0x1234..."
}
```

### Competition Not Found
```json
{
  "success": false,
  "error": "Competition not found",
  "competitionId": "660e8400-e29b-41d4-a716-446655440001"
}
```

### Tickets Unavailable
```json
{
  "success": false,
  "error": "Tickets no longer available",
  "requestedTickets": [1, 5, 10],
  "unavailableTickets": [5, 10],
  "availableAlternatives": [2, 3, 7, 15]
}
```

### Reservation Expired
```json
{
  "success": false,
  "error": "Reservation expired",
  "reservationId": "550e8400-e29b-41d4-a716-446655440000",
  "expiresAt": "2026-01-23T10:45:00.000Z",
  "currentTime": "2026-01-23T11:00:00.000Z"
}
```

### Validation Error
```json
{
  "success": false,
  "error": "Missing required fields",
  "code": "VALIDATION_ERROR",
  "missingFields": ["userId", "competitionId"]
}
```

---

## Integration Notes

### Balance Top-up Flow

1. User initiates top-up
2. Call `create-charge` or `onramp-init`
3. User completes payment
4. Webhook received (`commerce-webhook` or `onramp-webhook`)
5. Balance credited with 50% first-time bonus
6. User can purchase tickets with balance

### Ticket Purchase Flow (Balance)

1. User selects tickets
2. Call `reserve-tickets` (optional, for specific tickets)
3. Call `purchase-tickets-with-bonus`
4. Balance debited, tickets created instantly
5. Instant win prizes detected and returned

### Ticket Purchase Flow (External Payment)

1. User selects tickets
2. Call `reserve-tickets` (creates 15-min hold)
3. Call `create-charge` (creates Coinbase charge)
4. User completes payment
5. Webhook received (`commerce-webhook`)
6. Webhook calls `confirm-pending-tickets` with retry
7. Tickets confirmed, instant wins detected

### First-Topup Bonus Logic

- Applied automatically on first top-up
- 50% of top-up amount added as bonus
- Tracked via `canonical_users.has_used_new_user_bonus`
- Recorded in `balance_ledger` as separate 'bonus' entry
- Applies to both Coinbase Commerce and Coinbase Onramp top-ups

---

## Webhook Security

### Coinbase Commerce Webhook Verification

```typescript
const signature = request.headers.get('X-CC-Webhook-Signature');
const secret = Deno.env.get('COINBASE_COMMERCE_WEBHOOK_SECRET');

const hmac = await crypto.subtle.sign(
  'HMAC',
  await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
  encoder.encode(rawBody)
);

const computedSignature = btoa(String.fromCharCode(...new Uint8Array(hmac)));

if (signature !== computedSignature) {
  throw new Error('Invalid signature');
}
```

### Coinbase Onramp (Hook0) Webhook Verification

```typescript
const signatureHeader = request.headers.get('X-Hook0-Signature');
// Format: v1,timestamp,signature

const [version, timestamp, signature] = signatureHeader.split(',');
const signedPayload = `${timestamp}.${rawBody}`;
const secret = Deno.env.get('ONRAMP_WEBHOOK_SECRET');

const hmac = await crypto.subtle.sign(
  'HMAC',
  await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
  encoder.encode(signedPayload)
);

const computedSignature = Array.from(new Uint8Array(hmac))
  .map(b => b.toString(16).padStart(2, '0'))
  .join('');

if (signature !== computedSignature) {
  throw new Error('Invalid signature');
}
```

---

## Environment Variables Required

### Coinbase Commerce
- `COINBASE_COMMERCE_API_KEY` - API key for creating charges
- `COINBASE_COMMERCE_WEBHOOK_SECRET` - Secret for webhook signature verification

### Coinbase Onramp/CDP
- `CDC_CLIENT_API_KEY` - Client API key ID
- `CDC_SECRET_API_KEY` - Private key (PEM format, ES256)
- `ONRAMP_WEBHOOK_SECRET` - Hook0 webhook secret

### Supabase
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key for database access

### Application
- `SUCCESS_URL` - Base URL for redirect after payment (default: https://substage.theprize.io)

---

## Testing Payloads

### Test purchase-tickets-with-bonus

```bash
curl -X POST https://your-project.supabase.co/functions/v1/purchase-tickets-with-bonus \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "prize:pid:0x1234abcd...",
    "competitionId": "660e8400-e29b-41d4-a716-446655440001",
    "selectedTickets": [1, 5, 10, 23, 45],
    "ticketPrice": 1.00
  }'
```

### Test reserve-tickets

```bash
curl -X POST https://your-project.supabase.co/functions/v1/reserve-tickets \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "prize:pid:0x1234abcd...",
    "competitionId": "660e8400-e29b-41d4-a716-446655440001",
    "selectedTickets": [1, 5, 10]
  }'
```

### Test create-charge

```bash
curl -X POST https://your-project.supabase.co/functions/v1/create-charge \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "prize:pid:0x1234abcd...",
    "competitionId": "660e8400-e29b-41d4-a716-446655440001",
    "totalAmount": 50.00,
    "entryCount": 5,
    "type": "entry"
  }'
```

---

**Document Version:** 1.0  
**Last Updated:** 2026-01-23  
**Maintained By:** The Prize Development Team
