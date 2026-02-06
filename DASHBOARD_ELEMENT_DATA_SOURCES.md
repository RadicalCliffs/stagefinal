# User Dashboard Element Data Sources - Complete Outline

This document outlines exactly where each element of the user dashboard pulls its information from, with a focus on the Orders page (Purchases and Top-Ups tabs).

## Overview

The user dashboard consists of several main sections:
1. **Orders Page** - Shows purchases (competition entries) and wallet top-ups
2. **Entries Page** - Shows user's competition entries with status
3. **Wallet Page** - Shows wallet balances and transaction history
4. **Account Page** - Shows user profile information

---

## 1. Orders Page (`/dashboard/orders`)

### Location
- **Component**: `src/components/UserDashboard/Orders/OrdersList.tsx`
- **Layout**: `src/components/UserDashboard/Orders/OrdersLayout.tsx`
- **Table**: `src/components/UserDashboard/Orders/OrdersTable.tsx`

### Data Source Flow

```
User Dashboard
    ↓
OrdersList.tsx (line 84)
    ↓
database.getUserTransactions(canonicalUserId)
    ↓
src/lib/database.ts (line 1729)
    ↓
Supabase RPC: get_user_transactions(user_identifier)
    ↓
supabase/migrations/20260202095000_fix_dashboard_data_issues.sql
    ↓
Returns: user_transactions LEFT JOIN competitions
```

### Tab Structure

#### **Tab 1: Purchases** (key: 'purchases')
**Purpose**: Shows competition ticket purchases only

**Data Filtering** (OrdersList.tsx line 100):
```typescript
const purchasesData = (allTransactions || []).filter((tx: any) => !tx.is_topup);
```

**Columns Displayed** (OrdersTable.tsx):
- **Competition Name**: `item.competition_name` or 'Unknown Competition'
- **Type**: `item.type` (transaction type)
- **Payment Provider**: `item.payment_provider` (e.g., 'base', 'coinbase', 'nowpayments')
- **Date/Time**: `item.created_at` (purchase timestamp)
- **Cost**: Computed from `item.amount`, `item.balance_before`, `item.balance_after`
- **Status**: Computed from `item.status` with action button

**Database Columns Used**:
```sql
FROM user_transactions ut
LEFT JOIN competitions c ON ut.competition_id = c.id
WHERE ut.competition_id IS NOT NULL  -- Has a competition
  AND NOT (ut.webhook_ref LIKE 'TOPUP_%')  -- Not marked as top-up
```

Fields:
- `ut.id` - Transaction ID
- `ut.type` - Transaction type
- `ut.amount` - Amount spent
- `ut.currency` - Currency used
- `ut.status` - Transaction status
- `ut.payment_status` - Payment status
- `ut.competition_id` - Competition reference (NOT NULL for purchases)
- `ut.ticket_count` - Number of tickets
- `ut.created_at` - Purchase time
- `ut.payment_provider` - Payment provider
- `ut.balance_before` - Balance before purchase
- `ut.balance_after` - Balance after purchase
- `c.title` → `competition_name` - Competition name from JOIN
- `c.image_url` → `competition_image` - Competition image from JOIN

---

#### **Tab 2: Top-Ups** (key: 'topups')
**Purpose**: Shows wallet credit transactions only

**Data Filtering** (OrdersList.tsx line 102):
```typescript
const topupsData = (allTransactions || []).filter((tx: any) => tx.is_topup);
```

**Columns Displayed** (OrdersTable.tsx):
- **Description**: `item.competition_name` (shows "Wallet Top-Up")
- **Payment Provider**: `item.payment_provider` (e.g., 'nowpayments', 'coinbase')
- **TX Hash**: `item.tx_id` or `item.transaction_hash` (blockchain transaction hash with copy button)
- **Balance Before**: `item.balance_before` (formatted as USD)
- **Balance After**: `item.balance_after` (formatted as USD)
- **Completed At**: `item.completed_at` (transaction completion time)
- **Amount**: `item.amount_usd` (formatted amount)

**Database Columns Used**:
```sql
FROM user_transactions ut
LEFT JOIN competitions c ON ut.competition_id = c.id
WHERE ut.competition_id IS NULL  -- No competition = top-up
   OR (ut.webhook_ref IS NOT NULL AND ut.webhook_ref LIKE 'TOPUP_%')
```

Fields:
- `ut.id` - Transaction ID
- `ut.type` - Transaction type ('topup')
- `ut.amount` - Amount topped up
- `ut.currency` - Currency (usually 'USD', 'USDC')
- `ut.status` - Transaction status
- `ut.payment_status` - Payment status
- `ut.competition_id` - NULL for top-ups
- `ut.tx_id` - Transaction hash on blockchain
- `ut.transaction_hash` - Alternative transaction hash field
- `ut.order_id` - Payment provider order ID
- `ut.webhook_ref` - Webhook reference (starts with 'TOPUP_' for top-ups)
- `ut.payment_provider` - Payment provider
- `ut.balance_before` - Balance before top-up
- `ut.balance_after` - Balance after top-up
- `ut.created_at` - Transaction initiation time
- `ut.completed_at` - Transaction completion time
- `ut.metadata` - Additional transaction metadata (JSONB)

---

### is_topup Determination Logic

The `is_topup` flag is computed in the RPC function:

**Source**: `supabase/migrations/20260202095000_fix_dashboard_data_issues.sql`

```sql
'is_topup', (ut.competition_id IS NULL OR 
             (ut.webhook_ref IS NOT NULL AND ut.webhook_ref LIKE 'TOPUP_%'))
```

**Logic**:
- `competition_id IS NULL` → Top-up (no competition associated)
- OR `webhook_ref LIKE 'TOPUP_%'` → Explicitly marked as top-up

**Fallback in TypeScript** (database.ts line 1774):
```typescript
const isTopUp = tx.is_topup ?? 
                (!tx.competition_id || 
                 (tx.webhook_ref && tx.webhook_ref.startsWith('TOPUP_')));
```

---

## 2. Real-Time Updates

### Subscriptions (OrdersList.tsx lines 127-208)

The Orders page subscribes to real-time database changes:

#### Channel 1: User Transactions
```typescript
supabase
  .channel(`user-transactions-${canonicalUserId}`)
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'user_transactions',
  }, handler)
```

**Triggers on**: INSERT, UPDATE, DELETE in `user_transactions` table

**Matches user via**: 
- `canonical_user_id`
- `user_id`
- `wallet_address`
- `privy_user_id`

**Action**: Debounced refresh (500ms) of orders data

#### Channel 2: Sub-Account Balances
```typescript
supabase
  .channel(`user-balance-orders-${canonicalUserId}`)
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'sub_account_balances',
  }, handler)
```

**Triggers on**: Balance changes (may indicate completed top-up)

**Filters**: Only USD currency records

**Action**: Debounced refresh of orders data

#### Event Listener: Balance Updated
```typescript
window.addEventListener('balance-updated', handleBalanceUpdated);
```

**Triggers on**: Custom event dispatched after successful payments/top-ups

**Action**: Immediate debounced refresh

---

## 3. User Identification

All dashboard queries use one of these identifiers (in priority order):

1. **canonical_user_id** (primary) - Format: `prize:pid:0x...`
2. **wallet_address** (secondary) - Ethereum address
3. **user_id** (legacy) - Various formats
4. **privy_user_id** (legacy) - Privy authentication ID

### Identifier Resolution (get_user_transactions RPC)

```sql
-- Extract wallet from prize:pid: format
IF user_identifier LIKE 'prize:pid:0x%' THEN 
  search_wallet := LOWER(SUBSTRING(user_identifier FROM 11));
ELSIF user_identifier LIKE '0x%' THEN 
  search_wallet := LOWER(user_identifier); 
END IF;

-- Resolve canonical user ID
SELECT cu.canonical_user_id INTO v_canonical_user_id 
FROM canonical_users cu
WHERE cu.canonical_user_id = user_identifier 
   OR cu.uid = user_identifier
   OR (search_wallet IS NOT NULL AND LOWER(cu.wallet_address) = search_wallet) 
LIMIT 1;
```

---

## 4. Data Consistency Checks

### Balance Health Check
- **Component**: `BalanceHealthIndicator` (shown on all dashboard pages)
- **Compares**: `canonical_users.usdc_balance` vs `sub_account_balances.available_balance`
- **Shows**: Warning if discrepancy detected (temporary sync delays expected)

### Balance Sync Indicator
- **Component**: `BalanceSyncIndicator` (shown on all dashboard pages)
- **Monitors**: Real-time balance updates and sync status
- **Shows**: Visual indicator during balance synchronization

---

## 5. Common Issues & Their Fixes

### Issue 1: Reversed Tab Data ✅ FIXED
**Symptom**: "Purchases" showed top-ups, "Transactions" showed entries
**Root Cause**: Inverted filtering logic in OrdersList.tsx
**Fix**: Swapped data assignment and renamed "Transactions" → "Top-Ups"

### Issue 2: Missing Competition Name
**Symptom**: "Unknown Competition" displayed for entries
**Root Cause**: RPC returns `competition_title` but code expected `title`
**Fix**: RPC now uses `competition_name` consistently (via LEFT JOIN)

### Issue 3: Duplicate Balance Entries
**Symptom**: Multiple balance records causing incorrect display
**Root Cause**: Trigger creating duplicate sub_account_balances
**Fix**: Added duplicate prevention in balance triggers (separate migration)

---

## 6. Related Components

### WalletManagement Component
**Location**: `src/components/WalletManagement/WalletManagement.tsx`
**Shows**: Top-up transactions separately (lines 171-180)
**Query**: Direct query to `user_transactions` WHERE `competition_id IS NULL`

### WalletPage
**Location**: `src/pages/Dashboard/WalletPage.tsx`
**Shows**: WalletManagement component with payment status modal
**Handles**: Payment return flow from external providers

---

## 7. Database Schema Reference

### user_transactions Table
```sql
CREATE TABLE user_transactions (
  id UUID PRIMARY KEY,
  user_id TEXT,                    -- User identifier
  canonical_user_id TEXT,          -- Canonical user ID (prize:pid:...)
  wallet_address TEXT,             -- Wallet address
  privy_user_id TEXT,              -- Privy user ID (legacy)
  type TEXT,                       -- Transaction type
  amount NUMERIC,                  -- Transaction amount
  currency TEXT,                   -- Currency code
  status TEXT,                     -- Transaction status
  payment_status TEXT,             -- Payment provider status
  competition_id UUID,             -- Competition reference (NULL for top-ups)
  ticket_count INTEGER,            -- Number of tickets purchased
  ticket_numbers TEXT[],           -- Array of ticket numbers
  tx_id TEXT,                      -- Blockchain transaction hash
  transaction_hash TEXT,           -- Alternative tx hash field
  order_id UUID,                   -- Order reference
  webhook_ref TEXT,                -- Webhook reference
  payment_provider TEXT,           -- Payment provider name
  method TEXT,                     -- Payment method
  network TEXT,                    -- Blockchain network
  balance_before NUMERIC,          -- Balance before transaction
  balance_after NUMERIC,           -- Balance after transaction
  metadata JSONB,                  -- Additional data
  created_at TIMESTAMPTZ,          -- Transaction creation
  completed_at TIMESTAMPTZ,        -- Transaction completion
  updated_at TIMESTAMPTZ           -- Last update
);
```

### competitions Table (Joined for enrichment)
```sql
CREATE TABLE competitions (
  id UUID PRIMARY KEY,
  title TEXT,                      -- Competition name
  description TEXT,                -- Competition description
  image_url TEXT,                  -- Competition image
  status TEXT,                     -- Competition status
  prize_value NUMERIC,             -- Prize value
  is_instant_win BOOLEAN,          -- Instant win flag
  end_date TIMESTAMPTZ             -- Competition end date
);
```

---

## 8. Testing & Verification

### Manual Testing Checklist
- [ ] Purchases tab shows only competition entries (no top-ups)
- [ ] Top-Ups tab shows only wallet credits (no competition entries)
- [ ] Real-time updates work when new transactions are created
- [ ] Pagination works correctly on both tabs
- [ ] Mobile layout displays correctly on both tabs
- [ ] TX hash copy button works on Top-Ups tab
- [ ] Competition status buttons work on Purchases tab
- [ ] Balance before/after displays correctly on Top-Ups tab
- [ ] Export functionality works for both tabs

### Key Files Modified
1. `src/components/UserDashboard/Orders/OrdersLayout.tsx` - Tab labels
2. `src/components/UserDashboard/Orders/OrdersList.tsx` - Data filtering logic
3. `src/components/UserDashboard/Orders/OrdersTable.tsx` - Display logic for both tabs
4. `DASHBOARD_DATA_SOURCES.md` - Documentation update

---

## Summary

The user dashboard Orders page now correctly separates:
- **Purchases Tab**: Competition ticket purchases only (`!is_topup`)
- **Top-Ups Tab**: Wallet credit transactions only (`is_topup`)

Both tabs pull from the same `get_user_transactions` RPC, which returns enriched data from `user_transactions` LEFT JOIN `competitions`. The `is_topup` flag is computed by the RPC based on whether `competition_id IS NULL` or `webhook_ref` starts with 'TOPUP_'.

Real-time updates are handled via Supabase subscriptions to the `user_transactions` and `sub_account_balances` tables, with debounced refresh to prevent excessive API calls.
