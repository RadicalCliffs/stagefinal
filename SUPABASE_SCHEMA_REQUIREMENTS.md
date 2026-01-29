# 📊 COMPREHENSIVE SUPABASE SCHEMA REQUIREMENTS

**Generated:** 2026-01-29  
**Purpose:** Complete documentation of what the frontend expects from Supabase database

---

## 🎯 EXECUTIVE SUMMARY

The frontend expects a Supabase database with:
- **20+ core tables** for competitions, users, tickets, payments, and metadata
- **12+ RPC functions** for atomic operations and complex queries
- **2 views** for denormalized data access
- **Strict typing** with proper foreign keys and indexes
- **Real-time subscriptions** on 5 critical tables

---

## 1. 📋 CORE TABLES

### 1.1 `competitions`
**Purpose:** Central competition/raffle data

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| id | UUID | ✅ | Primary key |
| uid | UUID | ❌ | Legacy identifier |
| title | TEXT | ✅ | Competition name |
| description | TEXT | ❌ | Full description |
| image_url | TEXT | ❌ | Cover image URL |
| status | TEXT | ✅ | active, completed, drawn, cancelled, draft |
| total_tickets | INT | ✅ | Total tickets available |
| ticket_price | FLOAT | ✅ | Price per ticket |
| prize_value | FLOAT | ✅ | Total prize value |
| end_date | TIMESTAMP | ✅ | Competition end time |
| draw_date | TIMESTAMP | ❌ | Winner draw time |
| winner_address | TEXT | ❌ | Winner's wallet address |
| is_instant_win | BOOLEAN | ✅ | Instant win flag |
| is_featured | BOOLEAN | ✅ | Featured on homepage |
| category | TEXT | ❌ | Competition category |
| created_at | TIMESTAMP | ✅ | Creation timestamp |
| updated_at | TIMESTAMP | ✅ | Last update timestamp |

**Indexes:**
```sql
CREATE INDEX idx_competitions_status ON competitions(status);
CREATE INDEX idx_competitions_end_date ON competitions(end_date);
CREATE INDEX idx_competitions_is_featured ON competitions(is_featured);
```

---

### 1.2 `canonical_users`
**Purpose:** Unified user identity across wallets and auth providers

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| id | UUID | ✅ | Primary key |
| uid | TEXT | ❌ | Legacy user ID |
| canonical_user_id | TEXT | ✅ | Canonical ID (prize:pid:0x...) |
| wallet_address | TEXT | ❌ | Primary wallet address |
| eth_wallet_address | TEXT | ❌ | Ethereum wallet |
| base_wallet_address | TEXT | ❌ | Base wallet |
| email | TEXT | ❌ | User email |
| username | TEXT | ❌ | Display username |
| avatar_url | TEXT | ❌ | Profile picture URL |
| usdc_balance | FLOAT | ✅ | Main balance in USD |
| bonus_balance | FLOAT | ✅ | Bonus/promo balance |
| has_used_new_user_bonus | BOOLEAN | ✅ | First-time bonus flag |
| privy_user_id | TEXT | ❌ | Privy DID |
| telegram_handle | TEXT | ❌ | Telegram username |
| telephone_number | TEXT | ❌ | Phone number |
| first_name | TEXT | ❌ | First name |
| last_name | TEXT | ❌ | Last name |
| country | TEXT | ❌ | Country code |
| created_at | TIMESTAMP | ✅ | Account creation |

**Indexes:**
```sql
CREATE UNIQUE INDEX idx_canonical_users_canonical_id ON canonical_users(canonical_user_id);
CREATE INDEX idx_canonical_users_wallet ON canonical_users(wallet_address);
CREATE INDEX idx_canonical_users_email ON canonical_users(email);
```

**Critical:** This table is the single source of truth for user identity.

---

### 1.3 `joincompetition`
**Purpose:** Confirmed competition entries (legacy table, still primary)

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| id | UUID | ✅ | Primary key |
| uid | UUID | ❌ | Legacy entry ID |
| userid | TEXT | ✅ | User canonical ID |
| competitionid | TEXT/UUID | ✅ | Competition ID |
| ticketnumbers | TEXT | ✅ | Comma-separated ticket numbers |
| numberoftickets | INT | ✅ | Count of tickets |
| amountspent | FLOAT | ✅ | Total amount paid |
| wallet_address | TEXT | ❌ | User's wallet |
| chain | TEXT | ❌ | Payment chain (USDC, balance, etc.) |
| transactionhash | TEXT | ❌ | Payment transaction hash |
| purchasedate | TIMESTAMP | ✅ | Purchase timestamp |
| joinedat | TIMESTAMP | ✅ | Join timestamp |
| buytime | TIMESTAMP | ❌ | Legacy buy time |
| status | TEXT | ✅ | sold, pending, confirmed |
| created_at | TIMESTAMP | ✅ | Creation time |

**Indexes:**
```sql
CREATE INDEX idx_joincompetition_user_comp ON joincompetition(userid, competitionid);
CREATE INDEX idx_joincompetition_comp ON joincompetition(competitionid);
CREATE INDEX idx_joincompetition_wallet ON joincompetition(wallet_address);
```

---

### 1.4 `tickets`
**Purpose:** Individual ticket records (newer, normalized approach)

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| id | UUID | ✅ | Primary key |
| competition_id | UUID | ✅ | FK to competitions |
| user_id | TEXT | ✅ | Canonical user ID |
| canonical_user_id | TEXT | ❌ | Duplicate for consistency |
| ticket_number | INT | ✅ | Ticket number (1-N) |
| status | TEXT | ✅ | sold, reserved, available |
| purchase_price | FLOAT | ❌ | Price paid |
| payment_tx_hash | TEXT | ❌ | Transaction hash |
| payment_amount | FLOAT | ❌ | Amount paid |
| reservation_id | UUID | ❌ | FK to pending_tickets |
| tx_id | TEXT | ✅ | Transaction batch ID |
| order_id | UUID | ❌ | FK to orders |
| purchased_at | TIMESTAMP | ❌ | Purchase time |
| created_at | TIMESTAMP | ✅ | Creation time |

**Indexes:**
```sql
CREATE INDEX idx_tickets_competition ON tickets(competition_id);
CREATE INDEX idx_tickets_user_comp ON tickets(user_id, competition_id);
CREATE UNIQUE INDEX idx_tickets_comp_number ON tickets(competition_id, ticket_number);
```

**Critical:** `tx_id` must not be null per CHECK constraint.

---

### 1.5 `pending_tickets`
**Purpose:** Temporary ticket reservations before payment

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| id | UUID | ✅ | Primary key (reservation ID) |
| user_id | TEXT | ✅ | Canonical user ID |
| canonical_user_id | TEXT | ❌ | Duplicate for lookup |
| competition_id | UUID | ✅ | FK to competitions |
| ticket_numbers | INT[] | ✅ | Array of ticket numbers |
| ticket_count | INT | ✅ | Count of tickets |
| ticket_price | DECIMAL | ❌ | Price per ticket |
| total_amount | DECIMAL | ❌ | Total reservation cost |
| status | TEXT | ✅ | pending, confirmed, expired, cancelled |
| expires_at | TIMESTAMP | ✅ | Expiration time |
| transaction_hash | TEXT | ❌ | Payment hash (when confirmed) |
| payment_provider | TEXT | ❌ | balance, stripe, coinbase |
| confirmed_at | TIMESTAMP | ❌ | Confirmation time |
| client_secret | TEXT | ❌ | Stripe payment intent secret |
| wallet_address | TEXT | ❌ | User wallet |
| session_id | TEXT | ❌ | Coinbase checkout session |
| created_at | TIMESTAMP | ✅ | Creation time |
| updated_at | TIMESTAMP | ✅ | Last update time |

**Indexes:**
```sql
CREATE INDEX idx_pending_tickets_user_comp ON pending_tickets(user_id, competition_id);
CREATE INDEX idx_pending_tickets_expires ON pending_tickets(expires_at);
CREATE INDEX idx_pending_tickets_status ON pending_tickets(status);
```

**TTL:** Expired reservations should be cleaned up automatically.

---

### 1.6 `pending_ticket_items`
**Purpose:** Individual line items for pending tickets

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| id | UUID | ✅ | Primary key |
| pending_ticket_id | UUID | ✅ | FK to pending_tickets |
| ticket_number | INT | ✅ | Individual ticket number |
| status | TEXT | ✅ | pending, confirmed, expired |
| expires_at | TIMESTAMP | ✅ | Expiration time |
| created_at | TIMESTAMP | ✅ | Creation time |

**Indexes:**
```sql
CREATE INDEX idx_pending_ticket_items_pending_id ON pending_ticket_items(pending_ticket_id);
CREATE UNIQUE INDEX idx_pending_ticket_items_pending_number ON pending_ticket_items(pending_ticket_id, ticket_number);
```

---

### 1.7 `winners`
**Purpose:** Competition winner records

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| id | UUID | ✅ | Primary key |
| competition_id | UUID | ✅ | FK to competitions |
| wallet_address | TEXT | ✅ | Winner's wallet/canonical ID |
| username | TEXT | ❌ | Display name |
| ticket_number | INT | ✅ | Winning ticket number |
| prize_value | FLOAT | ✅ | Prize amount |
| prize_description | TEXT | ❌ | Prize details |
| won_at | TIMESTAMP | ✅ | Win timestamp |
| distribution_hash | TEXT | ❌ | Prize distribution transaction |
| is_claimed | BOOLEAN | ✅ | Claim status |
| created_at | TIMESTAMP | ✅ | Record creation |

**Indexes:**
```sql
CREATE INDEX idx_winners_competition ON winners(competition_id);
CREATE INDEX idx_winners_wallet ON winners(wallet_address);
```

---

### 1.8 `user_transactions`
**Purpose:** Payment and balance transaction log

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| id | UUID | ✅ | Primary key |
| user_id | TEXT | ✅ | User ID |
| canonical_user_id | TEXT | ❌ | Canonical user ID |
| wallet_address | TEXT | ❌ | User wallet |
| type | TEXT | ✅ | entry, topup, refund |
| amount | FLOAT | ✅ | Transaction amount |
| currency | TEXT | ✅ | USD, USDC, ETH |
| balance_before | FLOAT | ❌ | Balance before transaction |
| balance_after | FLOAT | ❌ | Balance after transaction |
| competition_id | UUID | ❌ | FK to competitions (for entries) |
| description | TEXT | ❌ | Human-readable description |
| status | TEXT | ✅ | pending, completed, failed |
| payment_status | TEXT | ❌ | completed, pending, failed |
| payment_provider | TEXT | ❌ | balance, stripe, coinbase |
| ticket_count | INT | ❌ | Number of tickets purchased |
| tx_id | TEXT | ❌ | Transaction hash |
| metadata | JSON | ❌ | Additional data |
| created_at | TIMESTAMP | ✅ | Transaction time |
| updated_at | TIMESTAMP | ✅ | Last update |
| completed_at | TIMESTAMP | ❌ | Completion time |

**Indexes:**
```sql
CREATE INDEX idx_user_transactions_user ON user_transactions(user_id);
CREATE INDEX idx_user_transactions_competition ON user_transactions(competition_id);
CREATE INDEX idx_user_transactions_created ON user_transactions(created_at DESC);
```

---

### 1.9 `sub_account_balances`
**Purpose:** Real-time user balance tracking

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| id | UUID | ✅ | Primary key |
| user_id | TEXT | ✅ | User ID |
| canonical_user_id | TEXT | ✅ | Canonical user ID |
| privy_user_id | TEXT | ❌ | Privy DID |
| currency | TEXT | ✅ | USD, USDC |
| available_balance | DECIMAL | ✅ | Spendable balance |
| pending_balance | DECIMAL | ✅ | Pending/locked balance |
| total_balance | DECIMAL | ✅ | Total balance |
| created_at | TIMESTAMP | ✅ | Account creation |
| updated_at | TIMESTAMP | ✅ | Last update |

**Indexes:**
```sql
CREATE UNIQUE INDEX idx_sub_account_canonical_currency ON sub_account_balances(canonical_user_id, currency);
CREATE INDEX idx_sub_account_user ON sub_account_balances(user_id);
```

**Critical:** This is the authoritative balance source. All balance operations must update this table atomically.

---

### 1.10 `balance_ledger`
**Purpose:** Immutable balance transaction history

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| id | UUID | ✅ | Primary key |
| canonical_user_id | TEXT | ✅ | User canonical ID |
| transaction_type | TEXT | ✅ | debit, credit |
| amount | DECIMAL | ✅ | Amount (negative for debit) |
| currency | TEXT | ✅ | USD, USDC |
| balance_before | DECIMAL | ✅ | Balance before operation |
| balance_after | DECIMAL | ✅ | Balance after operation |
| reference_id | TEXT | ❌ | External reference |
| description | TEXT | ❌ | Human description |
| metadata | JSON | ❌ | Additional data |
| created_at | TIMESTAMP | ✅ | Transaction time |

**Indexes:**
```sql
CREATE INDEX idx_balance_ledger_user ON balance_ledger(canonical_user_id);
CREATE INDEX idx_balance_ledger_created ON balance_ledger(created_at DESC);
```

**Critical:** Append-only table for audit trail.

---

### 1.11 `orders`
**Purpose:** Purchase order records

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| id | UUID | ✅ | Primary key |
| user_id | TEXT | ✅ | User ID |
| competition_id | UUID | ✅ | FK to competitions |
| amount | FLOAT | ✅ | Total amount |
| ticket_count | INT | ✅ | Number of tickets |
| status | TEXT | ✅ | pending, completed, failed |
| payment_tx_hash | TEXT | ❌ | Transaction hash |
| created_at | TIMESTAMP | ✅ | Order creation |
| completed_at | TIMESTAMP | ❌ | Completion time |

**Indexes:**
```sql
CREATE INDEX idx_orders_user ON orders(user_id);
CREATE INDEX idx_orders_competition ON orders(competition_id);
```

---

### 1.12 `Prize_Instantprizes`
**Purpose:** Instant win prize configuration

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| UID | UUID | ✅ | Primary key |
| competitionId | UUID | ✅ | FK to competitions |
| prize | TEXT | ✅ | Prize description |
| winningTicket | INT | ✅ | Winning ticket number |
| winningWalletAddress | TEXT | ❌ | Winner's address (null until won) |
| wonAt | TIMESTAMP | ❌ | Win timestamp |
| prize_value | FLOAT | ❌ | Prize value in USD |

**Indexes:**
```sql
CREATE INDEX idx_instant_prizes_competition ON Prize_Instantprizes(competitionId);
CREATE INDEX idx_instant_prizes_ticket ON Prize_Instantprizes(competitionId, winningTicket);
```

---

### 1.13 `wallet_balances`
**Purpose:** Legacy wallet balance table (fallback)

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| id | UUID | ✅ | Primary key |
| canonical_user_id | TEXT | ✅ | Canonical user ID |
| wallet_address | TEXT | ❌ | Wallet address |
| base_wallet_address | TEXT | ❌ | Base wallet |
| user_id | TEXT | ❌ | Legacy user ID |
| balance | DECIMAL | ✅ | Balance amount |
| updated_at | TIMESTAMP | ✅ | Last update |

---

### 1.14 `hero_competitions`
**Purpose:** Featured competitions on homepage

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| id | UUID | ✅ | Primary key |
| competition_id | UUID | ✅ | FK to competitions |
| slug | TEXT | ❌ | URL slug |
| is_active | BOOLEAN | ✅ | Display flag |
| display_order | INT | ✅ | Sort order |

---

### 1.15 `site_stats`
**Purpose:** Homepage statistics

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| id | UUID | ✅ | Primary key |
| key | TEXT | ✅ | Stat identifier |
| value | TEXT | ✅ | Stat value |
| is_active | BOOLEAN | ✅ | Display flag |
| display_order | INT | ✅ | Sort order |

---

### 1.16 `partners`
**Purpose:** Partner logos

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| id | UUID | ✅ | Primary key |
| name | TEXT | ✅ | Partner name |
| logo_url | TEXT | ✅ | Logo image URL |
| is_active | BOOLEAN | ✅ | Display flag |
| display_order | INT | ✅ | Sort order |

---

### 1.17 `testimonials`
**Purpose:** User testimonials

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| id | UUID | ✅ | Primary key |
| name | TEXT | ✅ | User name |
| message | TEXT | ✅ | Testimonial text |
| is_active | BOOLEAN | ✅ | Display flag |
| display_order | INT | ✅ | Sort order |

---

### 1.18 `site_metadata`
**Purpose:** General site configuration

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| id | UUID | ✅ | Primary key |
| key | TEXT | ✅ | Config key |
| value | TEXT | ✅ | Config value |

---

### 1.19 `payment_webhook_events`
**Purpose:** Webhook event log

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| id | UUID | ✅ | Primary key |
| provider | TEXT | ✅ | stripe, coinbase, etc. |
| event_type | TEXT | ✅ | Event name |
| payload | JSON | ✅ | Full webhook payload |
| status | TEXT | ✅ | processed, failed |
| processed_at | TIMESTAMP | ❌ | Processing time |
| created_at | TIMESTAMP | ✅ | Received time |

---

### 1.20 `pending_topups`
**Purpose:** Pending wallet top-ups

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| id | UUID | ✅ | Primary key |
| user_id | TEXT | ✅ | User ID |
| amount | FLOAT | ✅ | Top-up amount |
| currency | TEXT | ✅ | USD, USDC |
| status | TEXT | ✅ | pending, completed, failed |
| created_at | TIMESTAMP | ✅ | Creation time |

---

## 2. 🔄 VIEWS

### 2.1 `v_joincompetition_active`
**Purpose:** Denormalized view of active entries

**Expected Columns:**
- userid
- competitionid
- ticketnumbers
- wallet_address
- buytime
- purchasedate
- numberoftickets
- buyvalue
- status
- competitions (joined competition data)

**Query Pattern:**
```sql
CREATE OR REPLACE VIEW v_joincompetition_active AS
SELECT 
  jc.*,
  c.title as competition_title,
  c.image_url as competition_image
FROM joincompetition jc
LEFT JOIN competitions c ON c.id = jc.competitionid::uuid
WHERE jc.status IN ('sold', 'confirmed', 'completed');
```

---

### 2.2 `competition_winners`
**Purpose:** Winner display data

**Expected Columns:**
- competitionprize
- Winner (wallet address)
- winner_username
- crDate
- competitionname
- imageurl

**Query Pattern:**
```sql
CREATE OR REPLACE VIEW competition_winners AS
SELECT
  w.prize_value as competitionprize,
  w.wallet_address as Winner,
  COALESCE(cu.username, LEFT(w.wallet_address, 10)) as winner_username,
  w.won_at as crDate,
  c.title as competitionname,
  c.image_url as imageurl
FROM winners w
LEFT JOIN competitions c ON c.id = w.competition_id
LEFT JOIN canonical_users cu ON cu.canonical_user_id = w.wallet_address;
```

---

## 3. ⚙️ RPC FUNCTIONS (PostgreSQL Stored Procedures)

### 3.1 `get_unavailable_tickets`
**Purpose:** Get all sold/reserved tickets for a competition

**Parameters:**
- `p_competition_id` (text or UUID)

**Returns:** `int4[]` (array of integers)

**Implementation:**
```sql
CREATE OR REPLACE FUNCTION get_unavailable_tickets(p_competition_id text)
RETURNS int4[]
LANGUAGE plpgsql
AS $$
DECLARE
  unavailable int4[];
BEGIN
  -- Get sold tickets from tickets table
  SELECT ARRAY_AGG(DISTINCT ticket_number::int)
  INTO unavailable
  FROM (
    SELECT ticket_number FROM tickets WHERE competition_id = p_competition_id::uuid
    UNION
    SELECT UNNEST(ticket_numbers) as ticket_number 
    FROM pending_tickets 
    WHERE competition_id = p_competition_id::uuid 
    AND status = 'pending'
    AND expires_at > NOW()
  ) t;
  
  RETURN COALESCE(unavailable, ARRAY[]::int4[]);
END;
$$;
```

---

### 3.2 `get_comprehensive_user_dashboard_entries`
**Purpose:** Fetch all user entries from multiple sources

**Parameters:**
- `user_identifier` (text) - canonical_user_id, wallet, or Privy DID

**Returns:** JSON array of entry objects

**Expected Response Schema:**
```json
[
  {
    "competition_id": "uuid",
    "title": "Competition Name",
    "ticket_numbers": "1,5,17",
    "purchase_date": "2024-01-15T10:30:00Z",
    "status": "sold",
    "amount_spent": 15.0,
    "is_winner": false
  }
]
```

---

### 3.3 `get_user_competition_entries`
**Purpose:** Get user entries from competition_entries table

**Parameters:**
- `p_user_identifier` (text)

**Returns:** JSON array

**Expected Response:**
```json
[
  {
    "id": "uuid",
    "competition_id": "uuid",
    "wallet_address": "0x...",
    "tickets_count": 5,
    "is_winner": false,
    "created_at": "2024-01-15T10:30:00Z"
  }
]
```

---

### 3.4 `get_competition_ticket_availability`
**Purpose:** Get complete ticket availability data

**Parameters:**
- `p_competition_id` (text or UUID)

**Returns:** JSON object

**Expected Response:**
```json
{
  "competition_id": "uuid",
  "total_tickets": 100,
  "sold_count": 45,
  "available_count": 55,
  "available_tickets": [1, 2, 3, ..., 100]
}
```

---

### 3.5 `allocate_lucky_dip_tickets`
**Purpose:** Atomic server-side random ticket allocation

**Parameters:**
- `p_user_id` (text)
- `p_competition_id` (UUID)
- `p_ticket_count` (int)
- `p_ticket_price` (decimal)
- `p_hold_minutes` (int, default 10)
- `p_session_id` (text, optional)

**Returns:** JSON object

**Expected Response:**
```json
{
  "success": true,
  "reservation_id": "uuid",
  "ticket_numbers": [1, 5, 17, 42],
  "ticket_count": 4,
  "total_amount": 20.0,
  "expires_at": "2024-01-15T10:40:00Z",
  "available_count": 51
}
```

**Critical:** Must use database-level locking to prevent race conditions.

---

### 3.6 `get_user_tickets`
**Purpose:** Get user's ticket history

**Parameters:**
- `user_identifier` (text)

**Returns:** JSON array

---

### 3.7 `get_user_balance`
**Purpose:** Get user's current balance

**Parameters:**
- `p_canonical_user_id` (text)

**Returns:** DECIMAL (numeric)

---

### 3.8 `get_recent_entries_count`
**Purpose:** Count user entries in last 30 days

**Parameters:**
- `user_identifier` (text)

**Returns:** INTEGER

---

### 3.9 `update_user_avatar`
**Purpose:** Update user avatar URL

**Parameters:**
- `user_identifier` (text)
- `new_avatar_url` (text)

**Returns:** JSON with success status

---

### 3.10 `confirm_ticket_purchase`
**Purpose:** Confirm pending ticket reservation after payment

**Parameters:**
- `p_pending_ticket_id` (UUID)
- `p_payment_provider` (text)

**Returns:** JSON

**Expected Response:**
```json
{
  "success": true,
  "amount_debited": 20.0,
  "already_confirmed": false
}
```

---

### 3.11 `debit_sub_account_balance`
**Purpose:** Atomic balance debit operation

**Parameters:**
- `p_canonical_user_id` (text)
- `p_amount` (decimal)
- `p_currency` (text, default 'USD')

**Returns:** JSON array

**Expected Response:**
```json
[
  {
    "success": true,
    "previous_balance": 100.0,
    "new_balance": 80.0,
    "error_message": null
  }
]
```

**Critical:** Must use row-level locking (SELECT FOR UPDATE) to prevent race conditions.

---

### 3.12 `migrate_user_balance`
**Purpose:** Migrate balance from canonical_users to sub_account_balances

**Parameters:**
- `p_canonical_user_id` (text)

**Returns:** JSON

---

## 4. 🔗 FOREIGN KEY RELATIONSHIPS

```sql
-- Competition relationships
ALTER TABLE tickets ADD CONSTRAINT fk_tickets_competition 
  FOREIGN KEY (competition_id) REFERENCES competitions(id);

ALTER TABLE pending_tickets ADD CONSTRAINT fk_pending_tickets_competition 
  FOREIGN KEY (competition_id) REFERENCES competitions(id);

ALTER TABLE winners ADD CONSTRAINT fk_winners_competition 
  FOREIGN KEY (competition_id) REFERENCES competitions(id);

ALTER TABLE user_transactions ADD CONSTRAINT fk_user_transactions_competition 
  FOREIGN KEY (competition_id) REFERENCES competitions(id);

ALTER TABLE orders ADD CONSTRAINT fk_orders_competition 
  FOREIGN KEY (competition_id) REFERENCES competitions(id);

ALTER TABLE Prize_Instantprizes ADD CONSTRAINT fk_instant_prizes_competition 
  FOREIGN KEY (competitionId) REFERENCES competitions(id);

-- User relationships
ALTER TABLE sub_account_balances ADD CONSTRAINT fk_sub_account_balances_user 
  FOREIGN KEY (user_id) REFERENCES canonical_users(id);

ALTER TABLE balance_ledger ADD CONSTRAINT fk_balance_ledger_user 
  FOREIGN KEY (user_id) REFERENCES canonical_users(id);

-- Ticket item relationships
ALTER TABLE pending_ticket_items ADD CONSTRAINT fk_pending_ticket_items_pending 
  FOREIGN KEY (pending_ticket_id) REFERENCES pending_tickets(id) ON DELETE CASCADE;

ALTER TABLE tickets ADD CONSTRAINT fk_tickets_pending 
  FOREIGN KEY (reservation_id) REFERENCES pending_tickets(id);

ALTER TABLE tickets ADD CONSTRAINT fk_tickets_order 
  FOREIGN KEY (order_id) REFERENCES orders(id);
```

---

## 5. 📊 ENUM/STATUS VALUES

### Competition Status
- `active` → Live, accepting entries
- `completed` → Ended, waiting for draw
- `drawn` → Winner selected
- `drawing` → Draw in progress
- `cancelled` → Cancelled
- `expired` → Expired without winner
- `draft` → Not yet published
- `sold_out` → All tickets sold
- `upcoming` → Pre-launch

### Ticket/Reservation Status
- `pending` → Reservation awaiting payment
- `confirmed` → Payment confirmed, ticket assigned
- `expired` → Reservation expired
- `cancelled` → Manually cancelled
- `sold` → Ticket sold and confirmed

### Payment Status
- `completed` → Payment successful
- `pending` → Payment processing
- `failed` → Payment failed
- `cancelled` → Payment cancelled
- `success` → Legacy success status
- `paid` → Legacy paid status
- `finished` → Legacy finished status

### Transaction Type
- `entry` → Competition entry purchase
- `topup` → Wallet top-up
- `refund` → Refund to user

---

## 6. 🎯 CRITICAL INDEXES

```sql
-- Competition lookups (high frequency)
CREATE INDEX idx_competitions_status ON competitions(status) WHERE status IN ('active', 'upcoming');
CREATE INDEX idx_competitions_end_date ON competitions(end_date) WHERE end_date > NOW();
CREATE INDEX idx_competitions_featured ON competitions(is_featured) WHERE is_featured = true;

-- User/wallet lookups (very high frequency)
CREATE UNIQUE INDEX idx_canonical_users_canonical_id ON canonical_users(canonical_user_id);
CREATE INDEX idx_canonical_users_wallet_lower ON canonical_users(LOWER(wallet_address));
CREATE INDEX idx_canonical_users_privy ON canonical_users(privy_user_id);

-- Entry lookups (very high frequency)
CREATE INDEX idx_joincompetition_user_comp ON joincompetition(userid, competitionid);
CREATE INDEX idx_joincompetition_comp_status ON joincompetition(competitionid, status);

-- Ticket lookups (very high frequency)
CREATE UNIQUE INDEX idx_tickets_comp_number ON tickets(competition_id, ticket_number);
CREATE INDEX idx_tickets_user_comp ON tickets(user_id, competition_id);
CREATE INDEX idx_tickets_reservation ON tickets(reservation_id) WHERE reservation_id IS NOT NULL;

-- Pending ticket lookups (high frequency)
CREATE INDEX idx_pending_tickets_user_comp_status ON pending_tickets(user_id, competition_id, status);
CREATE INDEX idx_pending_tickets_expires ON pending_tickets(expires_at) WHERE status = 'pending';

-- Balance lookups (very high frequency)
CREATE UNIQUE INDEX idx_sub_account_canonical_currency ON sub_account_balances(canonical_user_id, currency);
CREATE INDEX idx_balance_ledger_user_created ON balance_ledger(canonical_user_id, created_at DESC);

-- Winner lookups
CREATE INDEX idx_winners_competition ON winners(competition_id);
CREATE INDEX idx_winners_wallet ON winners(LOWER(wallet_address));
```

---

## 7. 🔐 ROW LEVEL SECURITY (RLS)

**Status:** RLS is DISABLED on most tables due to service role usage.

**Recommendation:** If enabling RLS, use policies like:

```sql
-- Users can read their own data
CREATE POLICY user_read_own ON canonical_users
  FOR SELECT
  USING (auth.uid()::text = id::text OR canonical_user_id = auth.uid()::text);

-- Users can read their own transactions
CREATE POLICY user_read_own_transactions ON user_transactions
  FOR SELECT
  USING (user_id = auth.uid()::text OR canonical_user_id = auth.uid()::text);
```

**Critical:** Frontend uses service role key for most operations, bypassing RLS.

---

## 8. 🔄 REAL-TIME SUBSCRIPTIONS

**Enabled on:**
- `competitions` - Status changes
- `pending_tickets` - Expiration tracking
- `sub_account_balances` - Balance updates
- `user_transactions` - Payment confirmations
- `winners` - New winner announcements

**Configuration:**
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE competitions;
ALTER PUBLICATION supabase_realtime ADD TABLE pending_tickets;
ALTER PUBLICATION supabase_realtime ADD TABLE sub_account_balances;
ALTER PUBLICATION supabase_realtime ADD TABLE user_transactions;
ALTER PUBLICATION supabase_realtime ADD TABLE winners;
```

---

## 9. ⚡ PERFORMANCE CONSIDERATIONS

### High-Frequency Operations
1. **Check ticket availability** - Queries: `tickets`, `pending_tickets`, `joincompetition`
2. **Reserve tickets** - Inserts: `pending_tickets`, `pending_ticket_items`
3. **Confirm purchase** - Updates: `pending_tickets`, Inserts: `tickets`, `joincompetition`, Updates: `sub_account_balances`
4. **Get user entries** - Queries: `joincompetition`, `tickets`, `user_transactions`
5. **Get user balance** - Query: `sub_account_balances`

### Optimization Strategies
- Use `pending_ticket_items` for individual ticket locking
- Use database-level locking in RPC functions (SELECT FOR UPDATE)
- Cache ticket availability for 1-5 seconds
- Use materialized views for expensive aggregations
- Implement connection pooling (PgBouncer)

---

## 10. 🚨 CRITICAL DATA INTEGRITY RULES

### 1. Ticket Numbers Must Be Unique Per Competition
```sql
CREATE UNIQUE INDEX idx_tickets_comp_number ON tickets(competition_id, ticket_number);
```

### 2. Balance Operations Must Be Atomic
- Always use `debit_sub_account_balance` RPC
- Never update balance directly in application code
- Always create `balance_ledger` entry for audit

### 3. Ticket Reservations Must Expire
- Set `expires_at` to NOW() + 10 minutes
- Run cleanup cron job every minute
- Never confirm expired reservations

### 4. User Identity Must Be Canonical
- Always convert to `prize:pid:0x...` format
- Store in `canonical_user_id` field
- Use `canonical_users` table as single source of truth

### 5. Transaction Hashes Must Be Unique
```sql
CREATE UNIQUE INDEX idx_user_transactions_tx_id ON user_transactions(tx_id) WHERE tx_id IS NOT NULL;
```

---

## 11. 📝 MIGRATION CHECKLIST

To align Supabase with frontend expectations:

- [ ] Create all 20+ tables with proper types
- [ ] Create all indexes for performance
- [ ] Implement all 12+ RPC functions
- [ ] Create 2 views for denormalized access
- [ ] Set up foreign key constraints
- [ ] Configure real-time subscriptions on 5 tables
- [ ] Implement cleanup cron for expired reservations
- [ ] Test atomic balance operations
- [ ] Test concurrent ticket reservation (race conditions)
- [ ] Verify all enum/status values are handled
- [ ] Test RPC function error handling
- [ ] Verify NULL handling for optional fields
- [ ] Test case-insensitive wallet address lookups
- [ ] Verify timestamp timezone handling (UTC)

---

## 12. 🐛 COMMON CONSOLE ERRORS

### Error: "Property 'X' does not exist on type 'never'"
**Cause:** Supabase returns `Json` type for RPC functions, TypeScript can't infer structure.  
**Fix:** Cast RPC calls: `(supabase.rpc as any)('function_name', params)`

### Error: "Cannot find type definition file for 'node'"
**Cause:** Missing `@types/node` package.  
**Fix:** `npm install --save-dev @types/node`

### Error: "Reservation not found or expired"
**Cause:** Reservation expired before payment completed.  
**Fix:** Increase `expires_at` to 15 minutes, implement better UX warnings.

### Error: "Some tickets are no longer available"
**Cause:** Race condition - tickets sold between availability check and reservation.  
**Fix:** Use `allocate_lucky_dip_tickets` RPC with database locking.

### Error: "Insufficient balance"
**Cause:** Balance check uses stale data or wrong table.  
**Fix:** Always use `get_user_balance` RPC, query `sub_account_balances` table.

---

## 13. 🎯 NEXT STEPS

1. **Audit existing Supabase schema** against this document
2. **Create missing tables/columns/indexes**
3. **Implement missing RPC functions**
4. **Test all critical paths** (reserve → purchase → confirm)
5. **Fix TypeScript errors** by casting RPC calls
6. **Monitor console for runtime errors**
7. **Set up Sentry/LogRocket** for production error tracking

---

**End of Report**
