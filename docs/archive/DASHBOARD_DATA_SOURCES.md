# User Dashboard Data Sources

This document outlines the database columns and data sources used by each element in the User Dashboard.

## 1. Entries Tab (EntriesList.tsx)

### Data Source
- **Primary RPC**: `get_user_competition_entries(p_user_identifier)`
- **Fallback Method**: `getUserEntries()` via `getUserEntriesFromCompetitionEntries()`

### Database Tables Queried
- `competition_entries` (primary)
- `competitions` (joined for details)
- `joincompetition` (fallback)
- `tickets` (fallback)
- `user_transactions` (fallback)

### Columns Used

#### From competition_entries (via RPC):
- `id` - Entry ID (UUID)
- `competition_id` - Competition reference (UUID)
- `canonical_user_id` - User identifier (TEXT)
- `wallet_address` - User wallet (TEXT)
- `tickets_count` - Number of tickets purchased (INTEGER)
- `ticket_numbers_csv` - Comma-separated ticket numbers (TEXT)
- `amount_spent` - Total amount spent (NUMERIC)
- `is_winner` - Winner flag (BOOLEAN)
- `created_at` - Entry creation time (TIMESTAMPTZ)
- `latest_purchase_at` - Most recent purchase (TIMESTAMPTZ)

#### From competitions (via JOIN in RPC):
- `title` - Competition name (TEXT) → maps to `competition_title`
- `description` - Competition description (TEXT) → maps to `competition_description`
- `image_url` - Competition image (TEXT) → maps to `competition_image_url`
- `status` - Competition status (TEXT) → maps to `competition_status`
- `end_date` - Competition end date (TIMESTAMPTZ) → maps to `competition_end_date`
- `prize_value` - Prize value (NUMERIC) → maps to `competition_prize_value`
- `is_instant_win` - Instant win flag (BOOLEAN) → maps to `competition_is_instant_win`

### Display Fields in EntriesCard:
- `title` - From `competition_title` (fallback: "Unknown Competition")
- `description` - From `competition_description`
- `competitionImage` - From `competition_image_url`
- `ticketNumbers` - From `ticket_numbers_csv`
- `amountSpent` - From `amount_spent`
- `numberOfTickets` - From `tickets_count`
- `status` - From `competition_status` mapped to UI status
- `isWinner` - From `is_winner`
- `prizeValue` - From `competition_prize_value`
- `endDate` - From `competition_end_date`

---

## 2. Orders Tab (OrdersList.tsx / OrdersTable.tsx)

### Tab Structure
- **Purchases Tab**: Shows competition ticket purchases only (transactions with competition_id)
- **Top-Ups Tab**: Shows wallet credit transactions only (transactions without competition_id)

### Data Source
- **RPC**: `get_user_transactions(user_identifier)`
- **Filtering**: Frontend separates data based on `is_topup` flag

### Database Tables Queried
- `user_transactions` (primary)
- `competitions` (joined for details via RPC)

### Columns Used

#### From user_transactions:
- `id` - Transaction ID (UUID)
- `user_id` - User identifier (TEXT)
- `canonical_user_id` - Canonical user ID (TEXT)
- `wallet_address` - Wallet address (TEXT)
- `type` - Transaction type (TEXT)
- `amount` - Transaction amount (NUMERIC)
- `currency` - Currency type (TEXT)
- `status` - Transaction status (TEXT)
- `payment_status` - Payment status (TEXT)
- `competition_id` - Competition reference (UUID)
- `ticket_count` - Number of tickets (INTEGER)
- `tx_id` - Transaction hash (TEXT)
- `payment_provider` - Payment provider (TEXT)
- `order_id` - Order reference (UUID)
- `created_at` - Transaction creation time (TIMESTAMPTZ)
- `completed_at` - Transaction completion time (TIMESTAMPTZ)
- `metadata` - Additional data (JSONB)

#### From competitions (via JOIN in RPC):
- `title` - Competition name → maps to `competition_name`
- `image_url` - Competition image → maps to `competition_image`

### Display Fields in OrdersTable:

#### Purchases Tab (Competition Entries):
- `competition_name` - From joined competitions.title
- `type` - Transaction type
- `payment_provider` - Payment provider used
- `created_at` - Purchase timestamp
- `amount` - Transaction amount
- `status` - Competition status with action button

#### Top-Ups Tab (Wallet Credits):
- `competition_name` - Shows "Wallet Top-Up" for top-ups
- `payment_provider` - Payment provider used
- `tx_id` - Transaction hash (with copy button)
- `balance_before` - Balance before transaction
- `balance_after` - Balance after transaction
- `completed_at` - Transaction completion time
- `amount_usd` - Amount in USD

---

## 3. User Mini Profile (UserMiniProfile.tsx)

### Data Source
- **Context**: `useAuthUser()` hook → queries `canonical_users` table

### Database Tables Queried
- `canonical_users`

### Columns Used
- `id` - User UUID (TEXT/UUID)
- `canonical_user_id` - Primary user identifier (TEXT, format: `prize:pid:0x...`)
- `uid` - Alternative user ID (TEXT)
- `wallet_address` - Primary wallet address (TEXT)
- `base_wallet_address` - Base chain wallet (TEXT)
- `eth_wallet_address` - Ethereum wallet (TEXT)
- `username` - Display name (TEXT)
- `avatar_url` - Avatar image URL (TEXT)
- `email` - User email (TEXT)
- `usdc_balance` - USDC balance (NUMERIC)
- `bonus_balance` - Bonus balance (NUMERIC)

### Display Fields:
- `username` - From username (fallback: formatted wallet)
- `avatar_url` - From avatar_url
- `wallet_address` - From wallet_address (truncated display)
- `canonical_user_id` - From canonical_user_id (for copy)

---

## 4. Balance Display

### Data Source
- **Context**: `useAuthUser()` hook
- **Additional**: `useBalanceHealthCheck()` hook

### Database Tables Queried
- `canonical_users` (for usdc_balance, bonus_balance)
- `sub_account_balances` (for available_balance, pending_balance via RPC)

### Columns Used

#### From canonical_users:
- `usdc_balance` - Main balance (NUMERIC)
- `bonus_balance` - Bonus balance (NUMERIC)

#### From sub_account_balances (via RPC):
- `id` - Balance record ID (UUID)
- `canonical_user_id` - User reference (TEXT)
- `currency` - Currency type (TEXT)
- `available_balance` - Available balance (NUMERIC)
- `pending_balance` - Pending balance (NUMERIC)
- `last_updated` - Last update time (TIMESTAMPTZ)

### Display Fields:
- Main balance display uses `available_balance` from sub_account_balances
- Bonus balance uses `bonus_balance` from canonical_users
- Health check compares canonical_users.usdc_balance vs sub_account_balances.available_balance

---

## 5. Notifications (NotificationsLayout.tsx)

### Data Source
- **Table**: `notifications` (direct query)

### Database Tables Queried
- `notifications`

### Columns Used
- `id` - Notification ID (UUID)
- `user_id` - User identifier (TEXT)
- `canonical_user_id` - Canonical user ID (TEXT)
- `type` - Notification type (TEXT)
- `title` - Notification title (TEXT)
- `message` - Notification message (TEXT)
- `data` - Additional data (JSONB)
- `read` - Read status (BOOLEAN)
- `created_at` - Creation time (TIMESTAMPTZ)
- `updated_at` - Update time (TIMESTAMPTZ)

### Display Fields:
- `title` - From title
- `message` - From message
- `type` - From type (determines icon/color)
- `read` - From read (visual indicator)
- `created_at` - From created_at (formatted as relative time)

---

## 6. Account Settings (AccountLayout.tsx)

### Data Source
- **Context**: `useAuthUser()` hook
- **Update**: Direct mutations to `canonical_users` table

### Database Tables Queried
- `canonical_users`

### Columns Used (Read):
- `username` - Display name (TEXT)
- `email` - Email address (TEXT)
- `country` - User country (TEXT)
- `avatar_url` - Avatar image (TEXT)
- `first_name` - First name (TEXT)
- `last_name` - Last name (TEXT)
- `telegram_handle` - Telegram handle (TEXT)

### Columns Used (Write):
- All above fields can be updated
- `updated_at` - Auto-updated on changes (TIMESTAMPTZ)

---

## Key Data Flow Patterns

### 1. User Identification
All dashboard queries use one of these identifiers:
- `canonical_user_id` (primary, format: `prize:pid:0x...`)
- `wallet_address` (secondary)
- `privy_user_id` (legacy)
- `user_id` (legacy)

### 2. Competition Data Enrichment
Most queries JOIN with `competitions` table to enrich data:
```sql
LEFT JOIN competitions c ON [table].competition_id = c.id
```

This provides:
- `title` → `competition_title` / `competition_name`
- `image_url` → `competition_image_url` / `competition_image`
- `status` → `competition_status`
- `prize_value` → `competition_prize_value`

### 3. Fallback Chain
Entries tab uses this fallback chain:
1. `get_user_competition_entries()` RPC (queries competition_entries)
2. `get_comprehensive_user_dashboard_entries()` RPC (queries joincompetition)
3. Individual table queries (tickets, user_transactions, orders, balance_ledger)

### 4. Real-time Updates
Dashboard components subscribe to Supabase real-time channels on:
- `user_transactions` table
- `competition_entries` table
- `notifications` table
- `canonical_users` table

---

## Common Issues & Solutions

### Issue: "Unknown Competition" in Entries
**Root Cause**: RPC returns `competition_title` but code expects `title`
**Column Mapping**: 
```javascript
title: entry.competition_title || 'Unknown Competition'
```

### Issue: Balance Discrepancy
**Root Cause**: Temporary sync delay between `canonical_users.usdc_balance` and `sub_account_balances.available_balance`
**Solution**: Log to console only (not UI display)

### Issue: Missing Transaction Data
**Root Cause**: Transaction in `user_transactions` but `competition_id` is NULL (top-up)
**Solution**: Detect via metadata or check if `competition_id IS NULL`

---

## RPC Functions Reference

### get_user_competition_entries(p_user_identifier text)
**Returns**: 17 columns including competition details
**Source Tables**: competition_entries + competitions (JOIN)

### get_comprehensive_user_dashboard_entries(p_user_identifier text)
**Returns**: 17 columns with aggregated data
**Source Tables**: joincompetition + competitions (JOIN with aggregation)

### get_user_transactions(user_identifier text)
**Returns**: Transaction data with competition details
**Source Tables**: user_transactions + competitions (JOIN)

### get_sub_account_balance(p_canonical_user_id text)
**Returns**: Balance details
**Source Tables**: sub_account_balances

---

Last Updated: 2026-02-02
