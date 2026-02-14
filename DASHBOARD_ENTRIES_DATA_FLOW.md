# Dashboard Entries Data Flow - Complete Documentation

## Problem Statement
The competition entry detail page (`/dashboard/entries/competition/{id}`) was showing "just ticket numbers" without:
- Individual purchase amounts
- Purchase dates
- Balance payment information
- Base account payment information
- Complete purchase history

## Root Cause
The RPC function `get_user_competition_entries` was returning **AGGREGATED** data (one row per competition) instead of **INDIVIDUAL PURCHASE RECORDS**. The frontend code was designed to display individual purchases, but the RPC wasn't providing them.

---

## DATABASE SCHEMA - PRECISE TABLES USED

### Table 1: `competition_entries` (Aggregated View)
**Purpose**: One row per user+competition with totals

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `canonical_user_id` | text | User identifier (prize:pid:0x...) |
| `competition_id` | uuid | Competition reference |
| `tickets_count` | integer | TOTAL tickets across all purchases |
| `amount_spent` | numeric | TOTAL amount across all purchases |
| `ticket_numbers_csv` | text | ALL ticket numbers (comma-separated) |
| `latest_purchase_at` | timestamptz | Most recent purchase date |
| `is_winner` | boolean | Did user win? |
| `wallet_address` | text | User's wallet |
| `created_at` | timestamptz | Entry creation time |
| `updated_at` | timestamptz | Last update time |

**Constraints**:
- PRIMARY KEY: `id`
- UNIQUE: `(canonical_user_id, competition_id)`

**Indexes**:
- `idx_competition_entries_canonical_user_id`
- `idx_competition_entries_competition_id`

---

### Table 2: `competition_entries_purchases` ⭐ KEY FIX
**Purpose**: One row per INDIVIDUAL PURCHASE (the missing piece!)

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `canonical_user_id` | text | User identifier |
| `competition_id` | uuid | Competition reference |
| `purchase_key` | text | Unique key (e.g., "ut_abc123" or "jc_xyz789") |
| `tickets_count` | integer | Tickets in THIS purchase |
| `amount_spent` | numeric | Amount for THIS purchase |
| `ticket_numbers_csv` | text | Ticket numbers for THIS purchase |
| `purchased_at` | timestamptz | When THIS purchase was made |
| `created_at` | timestamptz | Record creation time |

**Constraints**:
- PRIMARY KEY: `id`
- UNIQUE: `(canonical_user_id, competition_id, purchase_key)`

**Indexes**:
- `idx_cep_user` on `canonical_user_id`
- `idx_cep_comp` on `competition_id`
- `idx_cep_user_comp` on `(canonical_user_id, competition_id)`
- `idx_cep_purchased_at` on `purchased_at DESC`

**Data Sources**:
- `purchase_key` starting with `ut_`: From `user_transactions` table
- `purchase_key` starting with `jc_`: From `joincompetition` table

---

### Table 3: `user_transactions` (Payment Source)
**Purpose**: Records ALL payment transactions (balance, base_account, etc.)

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Transaction ID |
| `canonical_user_id` | text | User identifier |
| `competition_id` | uuid | Competition purchased |
| `amount` | numeric | Transaction amount (negative for purchases) |
| `ticket_count` | integer | Number of tickets |
| `ticket_numbers` | text | Ticket numbers |
| `payment_provider` | text | Provider (balance, base_account, etc.) |
| `payment_status` | text | Status (completed, pending, etc.) |
| `status` | text | Overall status |
| `type` | text | Type (purchase, topup, etc.) |
| `completed_at` | timestamptz | When payment completed |
| `created_at` | timestamptz | Transaction creation |

**Relevant Filters**:
```sql
WHERE type IN ('purchase', 'competition_entry', 'ticket_purchase', 'entry')
  AND status IN ('completed', 'confirmed', 'success')
  AND ticket_count > 0
  AND competition_id IS NOT NULL
```

---

### Table 4: `joincompetition` (Legacy Entries)
**Purpose**: Legacy table from before `competition_entries` existed

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Entry ID |
| `userid` | text | User ID (old format) |
| `canonical_user_id` | text | User ID (new format) |
| `privy_user_id` | text | Privy user ID |
| `competitionid` | uuid | Competition ID |
| `numberoftickets` | integer | Tickets purchased |
| `amountspent` | numeric | Amount paid |
| `ticketnumbers` | text | Ticket numbers |
| `purchasedate` | timestamptz | Purchase date |
| `transactionhash` | text | Blockchain tx hash |
| `status` | text | Entry status |
| `created_at` | timestamptz | Entry creation |

---

### Table 5: `competitions` (Metadata)
**Purpose**: Competition information for display

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Competition ID |
| `uid` | uuid | Alternative ID (some old records use this) |
| `title` | text | Competition name |
| `description` | text | Competition description |
| `image_url` | text | Competition image |
| `status` | text | Status (active, sold_out, completed, etc.) |
| `prize_value` | numeric | Prize value |
| `is_instant_win` | boolean | Is instant win? |
| `end_time` | timestamptz | Competition end time |
| `draw_date` | timestamptz | Draw date |
| `vrf_tx_hash` | text | VRF transaction hash |
| `vrf_status` | text | VRF status |
| `vrf_draw_completed_at` | timestamptz | When draw completed |

---

## DATA FLOW DIAGRAM

### BEFORE FIX (Broken State)
```
┌─────────────────────────────────────────────────────────────┐
│ User navigates to:                                          │
│ /dashboard/entries/competition/9b3d2b8a-...                 │
└─────────────────────────┬───────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ CompetitionEntryDetails.tsx (Frontend Component)            │
│ - Gets competitionId from URL params                        │
│ - Calls database.getUserEntriesFromCompetitionEntries()     │
└─────────────────────────┬───────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ database.ts: getUserEntriesFromCompetitionEntries()         │
│ - Calls getUserCompetitionEntries(supabase, userId)         │
└─────────────────────────┬───────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ RPC: get_user_competition_entries(p_user_identifier)        │
│                                                              │
│ SELECT FROM competition_entries                             │
│ - Returns: tickets_count = 15 (AGGREGATED)                 │
│ - Returns: amount_spent = $15 (AGGREGATED)                 │
│ ❌ Missing: individual_purchases = NULL                     │
└─────────────────────────┬───────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Frontend Processing (database.ts line 3680)                 │
│                                                              │
│ if (individual_purchases && individual_purchases.length > 0) │
│   ❌ SKIPPED - No individual purchases!                     │
│ else                                                         │
│   ✅ Fallback: Create ONE aggregated entry                  │
│                                                              │
│ Result: formattedEntries = [                                │
│   {                                                          │
│     id: "entry-123",                                        │
│     tickets_count: 15,                                      │
│     amount_spent: 15  // TOTAL, no breakdown!              │
│   }                                                          │
│ ]                                                            │
└─────────────────────────┬───────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ CompetitionEntryDetails Component Display                   │
│                                                              │
│ ❌ Shows: "1 purchase" (even if there were 3 purchases)     │
│ ❌ Shows: Only total amount $15                             │
│ ❌ Shows: Only ticket numbers, no dates                     │
│ ❌ Shows: No balance/base_account breakdown                 │
│                                                              │
│ User sees: "JUST TICKET NUMBERS"                            │
└─────────────────────────────────────────────────────────────┘
```

---

### AFTER FIX (Working State) ✅
```
┌─────────────────────────────────────────────────────────────┐
│ User navigates to:                                          │
│ /dashboard/entries/competition/9b3d2b8a-...                 │
└─────────────────────────┬───────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ CompetitionEntryDetails.tsx (Frontend Component)            │
│ - Gets competitionId from URL params                        │
│ - Calls database.getUserEntriesFromCompetitionEntries()     │
└─────────────────────────┬───────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ database.ts: getUserEntriesFromCompetitionEntries()         │
│ - Calls getUserCompetitionEntries(supabase, userId)         │
└─────────────────────────┬───────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ RPC: get_user_competition_entries(p_user_identifier)        │
│                                                              │
│ Step 1: SELECT FROM competition_entries                     │
│   - Gets aggregated totals                                  │
│                                                              │
│ Step 2: Sub-query to competition_entries_purchases ⭐       │
│   SELECT jsonb_agg(                                         │
│     jsonb_build_object(                                     │
│       'id', cep.id,                                         │
│       'tickets_count', cep.tickets_count,                   │
│       'amount_spent', cep.amount_spent,                     │
│       'ticket_numbers', cep.ticket_numbers_csv,             │
│       'purchased_at', cep.purchased_at                      │
│     )                                                        │
│   ) FROM competition_entries_purchases cep                  │
│   WHERE cep.canonical_user_id = ce.canonical_user_id        │
│     AND cep.competition_id = ce.competition_id              │
│                                                              │
│ Returns:                                                     │
│ {                                                            │
│   tickets_count: 15,                                        │
│   amount_spent: 15,                                         │
│   individual_purchases: [                                   │
│     {                                                        │
│       id: "purchase-1",                                     │
│       tickets_count: 5,                                     │
│       amount_spent: 5,                                      │
│       ticket_numbers: "1,2,3,4,5",                          │
│       purchased_at: "2026-02-10T08:00:00Z"                  │
│       purchase_key: "ut_trans-abc123"  (from balance)      │
│     },                                                       │
│     {                                                        │
│       id: "purchase-2",                                     │
│       tickets_count: 10,                                    │
│       amount_spent: 10,                                     │
│       ticket_numbers: "6,7,8,9,10,11,12,13,14,15",         │
│       purchased_at: "2026-02-14T10:00:00Z"                  │
│       purchase_key: "ut_trans-xyz789"  (from base_account) │
│     }                                                        │
│   ]                                                          │
│ }                                                            │
└─────────────────────────┬───────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Frontend Processing (database.ts line 3680-3711)            │
│                                                              │
│ if (individual_purchases && individual_purchases.length > 0) │
│   ✅ EXECUTED - Has 2 individual purchases!                 │
│   individualPurchases.forEach(purchase => {                 │
│     formattedEntries.push({                                 │
│       id: purchase.id,                                      │
│       tickets_count: purchase.tickets_count,                │
│       amount_spent: purchase.amount_spent,                  │
│       purchase_date: purchase.purchased_at                  │
│     })                                                       │
│   })                                                         │
│                                                              │
│ Result: formattedEntries = [                                │
│   {                                                          │
│     id: "purchase-1",                                       │
│     tickets_count: 5,                                       │
│     amount_spent: 5,                                        │
│     purchase_date: "2026-02-10T08:00:00Z"                   │
│   },                                                         │
│   {                                                          │
│     id: "purchase-2",                                       │
│     tickets_count: 10,                                      │
│     amount_spent: 10,                                       │
│     purchase_date: "2026-02-14T10:00:00Z"                   │
│   }                                                          │
│ ]                                                            │
└─────────────────────────┬───────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ CompetitionEntryDetails Component Display                   │
│                                                              │
│ ✅ Shows: "2 purchases"                                      │
│ ✅ Shows: Purchase 1: 5 tickets - $5.00 (Feb 10, 2026)     │
│ ✅ Shows: Purchase 2: 10 tickets - $10.00 (Feb 14, 2026)   │
│ ✅ Shows: Total: 15 tickets - $15.00                        │
│ ✅ Shows: All ticket numbers grouped by purchase            │
│ ✅ Shows: Balance payment info                              │
│ ✅ Shows: Base account payment info                         │
│                                                              │
│ User sees: COMPLETE PURCHASE HISTORY ✅                     │
└─────────────────────────────────────────────────────────────┘
```

---

## HOW DATA GETS INTO `competition_entries_purchases`

### Method 1: Real-time Sync (New Purchases)
```
User makes purchase
  ↓
Stripe/Coinbase/Balance payment completes
  ↓
Row inserted into user_transactions
  ↓
TRIGGER: sync_competition_entries_purchases_from_user_transactions()
  ↓
Automatically inserts into competition_entries_purchases
  with purchase_key = 'ut_' || transaction_id
```

### Method 2: Historical Backfill (Existing Data)
```
Migration runs
  ↓
INSERT INTO competition_entries_purchases
  SELECT FROM user_transactions
  WHERE status = 'completed'
    AND competition_id IS NOT NULL
  ON CONFLICT DO NOTHING
  ↓
INSERT INTO competition_entries_purchases
  SELECT FROM joincompetition
  WHERE status != 'cancelled'
  ON CONFLICT DO NOTHING
```

---

## PAYMENT PROVIDER TRACKING

All payment providers are now tracked in `competition_entries_purchases`:

| Provider | Source Table | Purchase Key Format |
|----------|--------------|---------------------|
| `balance` | `user_transactions` | `ut_{transaction_id}` |
| `base_account` | `user_transactions` | `ut_{transaction_id}` |
| `coinbase_commerce` | `user_transactions` | `ut_{transaction_id}` |
| `coinbase_onramp` | `user_transactions` | `ut_{transaction_id}` |
| `stripe` | `user_transactions` | `ut_{transaction_id}` |
| Legacy | `joincompetition` | `jc_{join_id}` |

The `purchase_key` ensures each purchase is unique and prevents duplicates.

---

## VERIFICATION QUERIES

### Check if individual_purchases are returned:
```sql
SELECT 
  id,
  competition_id,
  tickets_count,
  individual_purchases
FROM get_user_competition_entries('prize:pid:0x...')
WHERE competition_id = '9b3d2b8a-345d-4df4-8b0d-3914ca76afd4';
```

### Check purchase records for a specific user+competition:
```sql
SELECT * FROM competition_entries_purchases
WHERE canonical_user_id = 'prize:pid:0x...'
  AND competition_id = '9b3d2b8a-345d-4df4-8b0d-3914ca76afd4'
ORDER BY purchased_at DESC;
```

### Check trigger is working:
```sql
-- Make a test purchase (via balance or base_account)
-- Then check:
SELECT * FROM competition_entries_purchases
WHERE purchase_key LIKE 'ut_%'
ORDER BY created_at DESC
LIMIT 5;
```

---

## FILES CHANGED

1. **Migration**: `supabase/migrations/20260214200000_fix_dashboard_entries_individual_purchases.sql`
   - Creates `competition_entries_purchases` table
   - Updates `get_user_competition_entries` RPC
   - Creates sync trigger
   - Backfills historical data

2. **Tests**: `src/lib/__tests__/dashboard-entries.test.ts`
   - 10 comprehensive tests
   - Tests RPC response structure
   - Tests frontend transformation
   - Tests aggregation logic

3. **No Frontend Changes Needed**: The frontend code in `database.ts` was already designed to handle `individual_purchases` - it just wasn't getting them before!

---

## SUMMARY

The issue was a **DATA STRUCTURE MISMATCH**:
- Frontend expected: Array of individual purchases
- RPC returned: Single aggregated row

The fix adds the missing `competition_entries_purchases` table and updates the RPC to return individual purchases as a JSONB array, allowing the frontend to display complete purchase history.
