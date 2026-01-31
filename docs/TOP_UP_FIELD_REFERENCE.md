# Top-Up Field Reference Guide

**Document Purpose:** Clarify the correct provider fields and amount/currency handling for top-up transactions before deployment.

**Last Updated:** January 31, 2026  
**Status:** ✅ Ready for Production

---

## Quick Reference

### 1. Reference/ID Field (Stable & Unique)

**Answer: Use `charge.id` → stored in `tx_id` column**

| Provider | Unique Identifier | Storage Field | Notes |
|----------|------------------|---------------|-------|
| **Coinbase Commerce** | `charge.id` | `tx_id` | ✅ **Primary identifier** - Stable, unique per charge |
| **Instant Wallet** | Transaction hash (0x...) | `tx_id` | ✅ **Primary identifier** - Blockchain tx hash |

**Implementation Details:**
```typescript
// Coinbase Commerce Webhook
const charge = eventData;
await supabase.from("user_transactions").update({
  tx_id: charge.id,  // ← This is the stable unique identifier
  session_id: charge.code,
  // ...
});

// Instant Wallet Top-Up
await supabase.from("user_transactions").insert({
  tx_id: transactionHash,  // ← Blockchain transaction hash
  // ...
});
```

**Why `tx_id` and not other fields?**
- ✅ `tx_id` - **CORRECT**: Primary identifier, indexed, used for lookups
- ❌ `charge_id` - Deprecated column (was added for compatibility but not actively used)
- ❌ `reference` - Not used in this codebase
- ❌ `provider_event_id` - Not used in this codebase

**Evidence from Code:**
- `create-charge/index.ts:414` - Sets `tx_id: charge.id`
- `commerce-webhook/index.ts:685` - Updates `tx_id: charge.id`
- `instant-topup.mts:363` - Sets `tx_id: transactionHash`
- Index exists: `idx_user_transactions_tx_id`

---

## 2. Amount & Currency Fields

### Field Names

**Stored in `user_transactions` table:**
```sql
amount NUMERIC(20, 6) NOT NULL,  -- Amount in the specified currency
currency TEXT DEFAULT 'USD',      -- Currency code (USD, USDC, etc.)
```

### Amount Units (Critical!)

**Answer: Amounts are stored in MAJOR units (dollars), NOT minor units (cents)**

| Source | Unit Type | Example | Stored Value |
|--------|-----------|---------|--------------|
| **Coinbase Commerce** | Major units | $50.00 USD | `50.00` |
| **Instant Wallet** | Major units | 50 USDC | `50.000000` |
| **Create Charge** | Major units | $10.00 USD | `10.00` |

**Implementation Evidence:**

#### Coinbase Commerce (`create-charge/index.ts`)
```typescript
// Lines 332-336
local_price: {
  amount: normalizedAmount.toFixed(2),  // ← Major units: "50.00"
  currency: "USD",
},
```

#### Instant Wallet Top-Up (`instant-topup.mts`)
```typescript
// Lines 196-197 - Converts from blockchain minor units to major units
const amountInUnits = BigInt(amountHex);
const actualAmount = Number(amountInUnits) / 1_000_000; // ← USDC has 6 decimals

// Line 356-357 - Stores in major units
amount: creditAmount,  // ← Already converted to major units (50.0, not 50000000)
currency: "USDC",
```

#### Commerce Webhook (`commerce-webhook/index.ts`)
```typescript
// Line 654 - Amount is in major units
const topUpAmount = parseFloat(amount);
// Used directly without conversion
await supabase.rpc('credit_balance_with_first_deposit_bonus', {
  p_amount: topUpAmount,  // ← Major units
  // ...
});
```

---

## Database Schema

### `user_transactions` Table

**Provider-related fields:**
```sql
-- Primary identifier (used for both Coinbase Commerce and blockchain txs)
tx_id TEXT,
CREATE INDEX idx_user_transactions_tx_id ON user_transactions(tx_id);

-- Secondary identifiers (for compatibility/reference)
charge_id TEXT,        -- Added in migration but not actively used
charge_code TEXT,      -- Session code from Coinbase Commerce
tx_ref TEXT,          -- External reference field
order_id TEXT,        -- Order reference
```

**Amount & metadata fields:**
```sql
-- Amount fields
amount NUMERIC(20, 6) NOT NULL,   -- Precision: 6 decimal places
currency TEXT DEFAULT 'USD',       -- USD, USDC, etc.

-- Payment tracking
payment_provider TEXT,             -- 'instant_wallet_topup' or 'coinbase_commerce'
payment_status TEXT,               -- pending | confirmed | completed | failed
status TEXT DEFAULT 'pending',     -- pending | finished | completed | failed

-- Additional metadata
network TEXT DEFAULT 'base',       -- Blockchain network
wallet_address TEXT,               -- User's wallet address
wallet_credited BOOLEAN,           -- True after balance credited
completed_at TIMESTAMPTZ,          -- Completion timestamp
```

---

## Top-Up Flows

### Flow 1: Coinbase Commerce Top-Up

```typescript
// Step 1: Create charge (create-charge/index.ts)
const chargePayload = {
  name: "Wallet Top-Up",
  description: "Add $50.00 to your wallet balance",
  pricing_type: "fixed_price",
  local_price: {
    amount: "50.00",  // ← Major units (dollars)
    currency: "USD",
  },
  metadata: {
    user_id: "prize:pid:0x123...",
    type: "topup",
    transaction_id: "uuid-abc-123",
  },
};

// Coinbase returns:
charge = {
  id: "ABC123DEF",        // ← Unique identifier
  code: "XYZ789",
  hosted_url: "https://commerce.coinbase.com/charges/ABC123DEF",
  // ...
}

// Step 2: Store transaction
await supabase.from("user_transactions").insert({
  id: "uuid-abc-123",
  user_id: "prize:pid:0x123...",
  type: "topup",
  amount: 50.00,          // ← Major units
  currency: "USD",
  tx_id: charge.id,       // ← "ABC123DEF" - Stable unique ID
  session_id: charge.code,
  payment_provider: "coinbase_commerce",
  status: "pending",
  // ...
});

// Step 3: Webhook confirms (commerce-webhook/index.ts)
// Event: charge:confirmed
await supabase.from("user_transactions").update({
  status: "completed",
  payment_status: "completed",
  tx_id: charge.id,       // ← Still "ABC123DEF"
  completed_at: new Date().toISOString(),
});

// Credit balance (major units)
await supabase.rpc("credit_balance_with_first_deposit_bonus", {
  p_canonical_user_id: "prize:pid:0x123...",
  p_amount: 50.00,        // ← Major units
  p_reason: "commerce_topup",
  p_reference_id: charge.id,
});
```

### Flow 2: Instant Wallet Top-Up

```typescript
// Step 1: User sends USDC on-chain (handled in frontend)
// Transaction: 0xabc123... sends 50 USDC to treasury

// Step 2: Backend verifies transaction (instant-topup.mts)
const receipt = await eth_getTransactionReceipt(txHash);
const transferLog = receipt.logs.find(/* USDC Transfer event */);

// Extract amount from blockchain (minor units → major units)
const amountHex = transferLog.data;  // 0x2FAF080 (50000000 in hex)
const amountInUnits = BigInt(amountHex);  // 50000000n
const actualAmount = Number(amountInUnits) / 1_000_000;  // 50.0 ← MAJOR UNITS

// Step 3: Store transaction
await supabase.from("user_transactions").insert({
  user_id: "prize:pid:0x123...",
  type: "topup",
  amount: 50.0,           // ← Major units (dollars)
  currency: "USDC",
  tx_id: "0xabc123...",   // ← Blockchain transaction hash
  wallet_address: "0x123...",
  network: "base",
  payment_provider: "instant_wallet_topup",
  status: "completed",
  payment_status: "confirmed",
  completed_at: new Date().toISOString(),
});

// Step 4: Credit balance (major units)
await supabase.rpc("credit_balance_with_first_deposit_bonus", {
  p_canonical_user_id: "prize:pid:0x123...",
  p_amount: 50.0,         // ← Major units
  p_reason: "wallet_topup",
  p_reference_id: "0xabc123...",
});
```

---

## Field Mapping Summary

### Coinbase Commerce

| Coinbase Field | Database Column | Type | Example | Notes |
|----------------|----------------|------|---------|-------|
| `charge.id` | `tx_id` | TEXT | `"ABC123DEF"` | ✅ **Primary unique ID** |
| `charge.code` | `session_id` | TEXT | `"XYZ789"` | Alternative reference |
| `local_price.amount` | `amount` | NUMERIC | `50.00` | Major units (dollars) |
| `local_price.currency` | `currency` | TEXT | `"USD"` | Currency code |
| `payments[0].network` | `network` | TEXT | `"base"` | Blockchain network |
| `payments[0].payer_addresses[0]` | `wallet_address` | TEXT | `"0x123..."` | Payer wallet |

### Instant Wallet (Blockchain)

| Source | Database Column | Type | Example | Notes |
|--------|----------------|------|---------|-------|
| Transaction hash | `tx_id` | TEXT | `"0xabc123..."` | ✅ **Primary unique ID** |
| Transfer event amount / 1e6 | `amount` | NUMERIC | `50.000000` | Converted to major units |
| `"USDC"` | `currency` | TEXT | `"USDC"` | Fixed value |
| `"base"` | `network` | TEXT | `"base"` | Fixed value |
| Sender address | `wallet_address` | TEXT | `"0x123..."` | From Transfer event |

---

## Validation & Testing

### How to Verify Correct Implementation

**1. Check `tx_id` is set correctly:**
```sql
-- All top-ups should have tx_id populated
SELECT 
  id, 
  tx_id,           -- Should be charge.id OR blockchain tx hash
  amount, 
  currency,
  payment_provider,
  type
FROM user_transactions 
WHERE type = 'topup'
  AND tx_id IS NULL;  -- Should return 0 rows
```

**2. Verify amount units:**
```sql
-- Amounts should be reasonable (e.g., $3-$100 for top-ups)
-- NOT in cents (300-10000) or minor units (3000000-100000000)
SELECT 
  id,
  amount,          -- Should be 3.00-100.00 range
  currency,
  payment_provider
FROM user_transactions 
WHERE type = 'topup'
  AND (amount < 1 OR amount > 10000);  -- Suspicious amounts
```

**3. Verify idempotency:**
```sql
-- No duplicate tx_id values
SELECT 
  tx_id, 
  COUNT(*) as count
FROM user_transactions 
WHERE tx_id IS NOT NULL
GROUP BY tx_id
HAVING COUNT(*) > 1;  -- Should return 0 rows
```

---

## Migration Notes

### Historical Context

**January 29, 2026 Migration:**
- Added `charge_id` column for Coinbase Commerce compatibility
- However, the actual implementation uses `tx_id` as the primary identifier
- `charge_id` exists for backward compatibility but is not actively populated

**Current State (January 31, 2026):**
- ✅ `tx_id` is the authoritative field for both payment providers
- ✅ Indexed for fast lookups: `idx_user_transactions_tx_id`
- ✅ Used in webhook handlers and instant top-up
- ✅ Supports idempotency checks

---

## Deployment Checklist

Before deploying updates, confirm:

- [ ] **Field wiring uses `tx_id`** (not `charge_id`, `reference`, or `provider_event_id`)
- [ ] **Amounts are in major units** (dollars, not cents or minor units)
- [ ] **Currency is set correctly** (`USD` for Coinbase Commerce, `USDC` for instant wallet)
- [ ] **Idempotency checks use `tx_id`** for duplicate detection
- [ ] **Database queries filter on `tx_id`** for transaction lookups
- [ ] **Indexes are in place** (`idx_user_transactions_tx_id`)

---

## References

**Code Files:**
- `supabase/functions/commerce-webhook/index.ts` - Coinbase webhook handler
- `netlify/functions/instant-topup.mts` - Instant wallet top-up
- `supabase/functions/create-charge/index.ts` - Charge creation
- `supabase/migrations/20260129100000_add_missing_user_transactions_columns.sql` - Schema

**Database Tables:**
- `user_transactions` - All payment transactions
- `payment_webhook_events` - Webhook audit log

**Coinbase Commerce API:**
- Version: `2018-03-22`
- Webhook signature: HMAC-SHA256
- Documentation: https://docs.cloud.coinbase.com/commerce/

---

## Support

For questions or issues:
1. Check the `debug/PAYMENT_ARCHITECTURE.md` documentation
2. Review recent webhook logs in `payment_webhook_events` table
3. Verify transaction status in `user_transactions` table
4. Check application logs for detailed error messages
