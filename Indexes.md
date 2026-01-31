# Database Indexes Documentation

## Table of Contents

- [Overview](#overview)
- [Index Categories](#index-categories)
- [Indexes by Table](#indexes-by-table)
- [Performance Optimization](#performance-optimization)
- [Index Maintenance](#index-maintenance)
- [Best Practices](#best-practices)

---

## Overview

This document catalogs all database indexes in the ThePrize.io Supabase schema. Indexes are critical for query performance, foreign key constraints, and data integrity.

**Total Indexes:** 126  
**Primary Migration:** `00000000000000_initial_schema.sql`

**Index Types:**
- **B-tree indexes** - Default, used for equality and range queries
- **Functional indexes** - Indexes on expressions (e.g., LOWER(email))
- **Unique indexes** - Enforce uniqueness constraints
- **Composite indexes** - Multi-column indexes

---

## Index Categories

### 1. User Identity Indexes (13 indexes)
Optimize user lookups by canonical ID, wallet, email, Privy ID

### 2. Transaction & Payment Indexes (20 indexes)
Fast transaction history, payment status, and order lookups

### 3. Competition & Entry Indexes (16 indexes)
Competition discovery, entry tracking, winner management

### 4. Ticket Management Indexes (15 indexes)
Ticket availability, reservations, and allocation

### 5. Balance & Ledger Indexes (9 indexes)
Balance lookups and audit trail queries

### 6. Admin & Management Indexes (11 indexes)
Admin user management, sessions, and audit logs

### 7. Webhook & Integration Indexes (9 indexes)
Payment webhooks, CDP events, job processing

### 8. Content & Display Indexes (12 indexes)
FAQs, testimonials, partners, site content

### 9. Notification Indexes (6 indexes)
User notifications and messaging

### 10. Utility & Reference Indexes (15 indexes)
Various supporting indexes

---

## Indexes by Table

### canonical_users (7 indexes)

Primary user identity table with comprehensive indexing.

#### `idx_canonical_users_canonical_user_id`
```sql
CREATE INDEX idx_canonical_users_canonical_user_id 
ON canonical_users(canonical_user_id);
```
**Purpose:** Primary user lookup  
**Type:** B-tree  
**Cardinality:** High (unique per user)  
**Query Pattern:** `WHERE canonical_user_id = '...'`  
**Usage:** User authentication, profile queries, balance lookups

---

#### `idx_canonical_users_uid`
```sql
CREATE INDEX idx_canonical_users_uid 
ON canonical_users(uid);
```
**Purpose:** Legacy user ID lookup  
**Type:** B-tree  
**Query Pattern:** `WHERE uid = '...'`  
**Usage:** Backwards compatibility, user resolution

---

#### `idx_canonical_users_privy_user_id`
```sql
CREATE INDEX idx_canonical_users_privy_user_id 
ON canonical_users(privy_user_id);
```
**Purpose:** Privy authentication lookup  
**Type:** B-tree  
**Query Pattern:** `WHERE privy_user_id = '...'`  
**Usage:** Privy login, user session validation

---

#### `idx_canonical_users_wallet_address`
```sql
CREATE INDEX idx_canonical_users_wallet_address 
ON canonical_users(LOWER(wallet_address));
```
**Purpose:** Case-insensitive wallet lookup  
**Type:** Functional (B-tree on LOWER())  
**Query Pattern:** `WHERE LOWER(wallet_address) = LOWER('0x...')`  
**Usage:** Wallet authentication, user resolution  
**Performance:** Critical for wallet-based lookups

---

#### `idx_canonical_users_base_wallet_address`
```sql
CREATE INDEX idx_canonical_users_base_wallet_address 
ON canonical_users(LOWER(base_wallet_address));
```
**Purpose:** Base chain wallet lookup  
**Type:** Functional (B-tree on LOWER())  
**Query Pattern:** `WHERE LOWER(base_wallet_address) = LOWER('0x...')`  
**Usage:** Base network authentication

---

#### `idx_canonical_users_eth_wallet_address`
```sql
CREATE INDEX idx_canonical_users_eth_wallet_address 
ON canonical_users(LOWER(eth_wallet_address));
```
**Purpose:** Ethereum wallet lookup  
**Type:** Functional (B-tree on LOWER())  
**Query Pattern:** `WHERE LOWER(eth_wallet_address) = LOWER('0x...')`  
**Usage:** Ethereum network authentication

---

#### `idx_canonical_users_email`
```sql
CREATE INDEX idx_canonical_users_email 
ON canonical_users(LOWER(email));
```
**Purpose:** Case-insensitive email lookup  
**Type:** Functional (B-tree on LOWER())  
**Query Pattern:** `WHERE LOWER(email) = LOWER('user@example.com')`  
**Usage:** Email authentication, user search

---

### users (2 indexes)

Legacy users table (being phased out).

#### `idx_users_wallet_address`
```sql
CREATE INDEX idx_users_wallet_address 
ON users(LOWER(wallet_address));
```
**Purpose:** Legacy wallet lookup  
**Type:** Functional  
**Status:** Legacy, migrate to canonical_users

---

#### `idx_users_user_id`
```sql
CREATE INDEX idx_users_user_id 
ON users(user_id);
```
**Purpose:** Legacy user ID lookup  
**Type:** B-tree

---

### profiles (2 indexes)

User profile information.

#### `idx_profiles_user_id`
```sql
CREATE INDEX idx_profiles_user_id 
ON profiles(user_id);
```
**Purpose:** Profile lookup by user ID  
**Type:** B-tree  
**Query Pattern:** `WHERE user_id = '...'`

---

#### `idx_profiles_wallet_address`
```sql
CREATE INDEX idx_profiles_wallet_address 
ON profiles(LOWER(wallet_address));
```
**Purpose:** Profile lookup by wallet  
**Type:** Functional

---

### sub_account_balances (3 indexes)

User balance management.

#### `idx_sub_account_balances_canonical_user_id`
```sql
CREATE INDEX idx_sub_account_balances_canonical_user_id 
ON sub_account_balances(canonical_user_id);
```
**Purpose:** **Critical** - Balance lookup by user  
**Type:** B-tree  
**Query Pattern:** `WHERE canonical_user_id = '...'`  
**Usage:** Balance queries, payment validation  
**Performance:** Hot index, frequently accessed

---

#### `idx_sub_account_balances_user_id`
```sql
CREATE INDEX idx_sub_account_balances_user_id 
ON sub_account_balances(user_id);
```
**Purpose:** Legacy user ID balance lookup  
**Type:** B-tree

---

#### `idx_sub_account_balances_currency`
```sql
CREATE INDEX idx_sub_account_balances_currency 
ON sub_account_balances(currency);
```
**Purpose:** Currency filtering  
**Type:** B-tree  
**Query Pattern:** `WHERE currency = 'USD'`  
**Usage:** Multi-currency balance queries

---

### balance_ledger (5 indexes)

Audit trail for all balance operations.

#### `idx_balance_ledger_canonical_user_id`
```sql
CREATE INDEX idx_balance_ledger_canonical_user_id 
ON balance_ledger(canonical_user_id);
```
**Purpose:** User transaction history  
**Type:** B-tree  
**Query Pattern:** `WHERE canonical_user_id = '...'`  
**Usage:** Balance history, audit queries

---

#### `idx_balance_ledger_reference_id`
```sql
CREATE INDEX idx_balance_ledger_reference_id 
ON balance_ledger(reference_id);
```
**Purpose:** Transaction reference lookup  
**Type:** B-tree  
**Query Pattern:** `WHERE reference_id = '...'`  
**Usage:** Payment reconciliation, idempotency

---

#### `idx_balance_ledger_transaction_id`
```sql
CREATE INDEX idx_balance_ledger_transaction_id 
ON balance_ledger(transaction_id);
```
**Purpose:** Transaction ID lookup  
**Type:** B-tree  
**Usage:** Transaction tracking

---

#### `idx_balance_ledger_created_at`
```sql
CREATE INDEX idx_balance_ledger_created_at 
ON balance_ledger(created_at DESC);
```
**Purpose:** Chronological queries  
**Type:** B-tree (DESC order)  
**Query Pattern:** `ORDER BY created_at DESC`  
**Usage:** Recent transaction history

---

#### `idx_balance_ledger_source`
```sql
CREATE INDEX idx_balance_ledger_source 
ON balance_ledger(source);
```
**Purpose:** Filter by transaction source  
**Type:** B-tree  
**Query Pattern:** `WHERE source = 'stripe'`  
**Usage:** Source-specific reports

---

### bonus_award_audit (2 indexes)

Bonus tracking and audit.

#### `idx_bonus_award_audit_canonical_user_id`
```sql
CREATE INDEX idx_bonus_award_audit_canonical_user_id 
ON bonus_award_audit(canonical_user_id);
```
**Purpose:** User bonus history  
**Type:** B-tree

---

#### `idx_bonus_award_audit_wallet_address`
```sql
CREATE INDEX idx_bonus_award_audit_wallet_address 
ON bonus_award_audit(LOWER(wallet_address));
```
**Purpose:** Wallet-based bonus lookup  
**Type:** Functional

---

### user_transactions (6 indexes)

User payment and transaction records.

#### `idx_user_transactions_user_id`
```sql
CREATE INDEX idx_user_transactions_user_id 
ON user_transactions(user_id);
```
**Purpose:** User transaction history  
**Type:** B-tree  
**Query Pattern:** `WHERE user_id = '...'`

---

#### `idx_user_transactions_canonical_user_id`
```sql
CREATE INDEX idx_user_transactions_canonical_user_id 
ON user_transactions(canonical_user_id);
```
**Purpose:** **Primary** transaction lookup  
**Type:** B-tree  
**Query Pattern:** `WHERE canonical_user_id = '...'`  
**Usage:** Transaction history, payment tracking

---

#### `idx_user_transactions_competition_id`
```sql
CREATE INDEX idx_user_transactions_competition_id 
ON user_transactions(competition_id);
```
**Purpose:** Competition-specific transactions  
**Type:** B-tree  
**Query Pattern:** `WHERE competition_id = '...'`  
**Usage:** Competition revenue reports

---

#### `idx_user_transactions_status`
```sql
CREATE INDEX idx_user_transactions_status 
ON user_transactions(status);
```
**Purpose:** Filter by transaction status  
**Type:** B-tree  
**Query Pattern:** `WHERE status = 'completed'`  
**Usage:** Pending transaction queries

---

#### `idx_user_transactions_created_at`
```sql
CREATE INDEX idx_user_transactions_created_at 
ON user_transactions(created_at DESC);
```
**Purpose:** Chronological ordering  
**Type:** B-tree (DESC)  
**Query Pattern:** `ORDER BY created_at DESC`

---

#### `idx_user_transactions_payment_status`
```sql
CREATE INDEX idx_user_transactions_payment_status 
ON user_transactions(payment_status);
```
**Purpose:** Payment status filtering  
**Type:** B-tree  
**Query Pattern:** `WHERE payment_status = 'pending'`  
**Usage:** Payment reconciliation

---

### competitions (6 indexes)

Competition discovery and management.

#### `idx_competitions_uid`
```sql
CREATE INDEX idx_competitions_uid 
ON competitions(uid);
```
**Purpose:** Competition UID lookup  
**Type:** B-tree

---

#### `idx_competitions_status`
```sql
CREATE INDEX idx_competitions_status 
ON competitions(status);
```
**Purpose:** **Critical** - Filter active/ended competitions  
**Type:** B-tree  
**Query Pattern:** `WHERE status = 'active'`  
**Usage:** Homepage, competition listings  
**Performance:** Hot index

---

#### `idx_competitions_is_featured`
```sql
CREATE INDEX idx_competitions_is_featured 
ON competitions(is_featured);
```
**Purpose:** Featured competition queries  
**Type:** B-tree  
**Query Pattern:** `WHERE is_featured = true`  
**Usage:** Hero sections, featured listings

---

#### `idx_competitions_start_time`
```sql
CREATE INDEX idx_competitions_start_time 
ON competitions(start_time);
```
**Purpose:** Time-based filtering  
**Type:** B-tree  
**Query Pattern:** `WHERE start_time > NOW()`  
**Usage:** Upcoming competitions

---

#### `idx_competitions_end_time`
```sql
CREATE INDEX idx_competitions_end_time 
ON competitions(end_time);
```
**Purpose:** Expiry checks  
**Type:** B-tree  
**Query Pattern:** `WHERE end_time < NOW()`  
**Usage:** Ended competition detection

---

#### `idx_competitions_category`
```sql
CREATE INDEX idx_competitions_category 
ON competitions(category);
```
**Purpose:** Category filtering  
**Type:** B-tree  
**Query Pattern:** `WHERE category = 'luxury'`  
**Usage:** Category pages

---

### competition_entries (4 indexes)

Competition participation tracking.

#### `idx_competition_entries_canonical_user_id`
```sql
CREATE INDEX idx_competition_entries_canonical_user_id 
ON competition_entries(canonical_user_id);
```
**Purpose:** User's competition entries  
**Type:** B-tree  
**Query Pattern:** `WHERE canonical_user_id = '...'`  
**Usage:** User dashboard

---

#### `idx_competition_entries_competition_id`
```sql
CREATE INDEX idx_competition_entries_competition_id 
ON competition_entries(competition_id);
```
**Purpose:** Competition participant list  
**Type:** B-tree  
**Query Pattern:** `WHERE competition_id = '...'`  
**Usage:** Leaderboards, participant counts

---

#### `idx_competition_entries_is_winner`
```sql
CREATE INDEX idx_competition_entries_is_winner 
ON competition_entries(is_winner);
```
**Purpose:** Winner filtering  
**Type:** B-tree  
**Query Pattern:** `WHERE is_winner = true`  
**Usage:** Winner announcements

---

#### `idx_competition_entries_latest_purchase_at`
```sql
CREATE INDEX idx_competition_entries_latest_purchase_at 
ON competition_entries(latest_purchase_at DESC);
```
**Purpose:** Recent activity sorting  
**Type:** B-tree (DESC)  
**Query Pattern:** `ORDER BY latest_purchase_at DESC`  
**Usage:** "Recent entries" displays

---

### tickets (6 indexes)

Individual ticket records.

#### `idx_tickets_competition_id`
```sql
CREATE INDEX idx_tickets_competition_id 
ON tickets(competition_id);
```
**Purpose:** **Critical** - Competition tickets  
**Type:** B-tree  
**Query Pattern:** `WHERE competition_id = '...'`  
**Usage:** Ticket availability checks  
**Performance:** Hot index

---

#### `idx_tickets_user_id`
```sql
CREATE INDEX idx_tickets_user_id 
ON tickets(user_id);
```
**Purpose:** User's tickets  
**Type:** B-tree  
**Query Pattern:** `WHERE user_id = '...'`

---

#### `idx_tickets_canonical_user_id`
```sql
CREATE INDEX idx_tickets_canonical_user_id 
ON tickets(canonical_user_id);
```
**Purpose:** **Primary** user ticket lookup  
**Type:** B-tree  
**Query Pattern:** `WHERE canonical_user_id = '...'`  
**Usage:** User ticket displays

---

#### `idx_tickets_wallet_address`
```sql
CREATE INDEX idx_tickets_wallet_address 
ON tickets(LOWER(wallet_address));
```
**Purpose:** Wallet-based ticket lookup  
**Type:** Functional

---

#### `idx_tickets_status`
```sql
CREATE INDEX idx_tickets_status 
ON tickets(status);
```
**Purpose:** Status filtering  
**Type:** B-tree  
**Query Pattern:** `WHERE status = 'sold'`  
**Usage:** Available ticket calculations

---

#### `idx_tickets_is_winner`
```sql
CREATE INDEX idx_tickets_is_winner 
ON tickets(is_winner);
```
**Purpose:** Winner ticket identification  
**Type:** B-tree  
**Query Pattern:** `WHERE is_winner = true`

---

### tickets_sold (2 indexes)

Legacy sold tickets tracking.

#### `idx_tickets_sold_competition_id`
```sql
CREATE INDEX idx_tickets_sold_competition_id 
ON tickets_sold(competition_id);
```
**Purpose:** Sold tickets by competition  
**Type:** B-tree

---

#### `idx_tickets_sold_purchaser_id`
```sql
CREATE INDEX idx_tickets_sold_purchaser_id 
ON tickets_sold(purchaser_id);
```
**Purpose:** Purchaser lookup  
**Type:** B-tree

---

### pending_tickets (4 indexes)

Ticket reservations and holds.

#### `idx_pending_tickets_user_id`
```sql
CREATE INDEX idx_pending_tickets_user_id 
ON pending_tickets(user_id);
```
**Purpose:** User's pending tickets  
**Type:** B-tree

---

#### `idx_pending_tickets_competition_id`
```sql
CREATE INDEX idx_pending_tickets_competition_id 
ON pending_tickets(competition_id);
```
**Purpose:** Competition's pending tickets  
**Type:** B-tree  
**Usage:** Availability calculations

---

#### `idx_pending_tickets_status`
```sql
CREATE INDEX idx_pending_tickets_status 
ON pending_tickets(status);
```
**Purpose:** Status filtering  
**Type:** B-tree  
**Query Pattern:** `WHERE status = 'pending'`

---

#### `idx_pending_tickets_expires_at`
```sql
CREATE INDEX idx_pending_tickets_expires_at 
ON pending_tickets(expires_at);
```
**Purpose:** Expiry checks  
**Type:** B-tree  
**Query Pattern:** `WHERE expires_at < NOW()`  
**Usage:** Cleanup jobs, expiry triggers

---

### pending_ticket_items (3 indexes)

Individual pending ticket numbers.

#### `idx_pending_ticket_items_pending_ticket_id`
```sql
CREATE INDEX idx_pending_ticket_items_pending_ticket_id 
ON pending_ticket_items(pending_ticket_id);
```
**Purpose:** Items by reservation  
**Type:** B-tree

---

#### `idx_pending_ticket_items_competition_id`
```sql
CREATE INDEX idx_pending_ticket_items_competition_id 
ON pending_ticket_items(competition_id);
```
**Purpose:** Competition-specific pending items  
**Type:** B-tree

---

#### `idx_pending_ticket_items_unique`
```sql
CREATE UNIQUE INDEX idx_pending_ticket_items_unique 
ON pending_ticket_items(competition_id, ticket_number);
```
**Purpose:** **Critical** - Prevent double-booking  
**Type:** Unique composite index  
**Constraint:** Ensures ticket can't be reserved twice  
**Performance:** Essential for data integrity

---

### winners (5 indexes)

Winner records and announcements.

#### `idx_winners_competition_id`
```sql
CREATE INDEX idx_winners_competition_id 
ON winners(competition_id);
```
**Purpose:** Competition winners  
**Type:** B-tree

---

#### `idx_winners_user_id`
```sql
CREATE INDEX idx_winners_user_id 
ON winners(user_id);
```
**Purpose:** User's wins  
**Type:** B-tree

---

#### `idx_winners_canonical_user_id`
```sql
CREATE INDEX idx_winners_canonical_user_id 
ON winners(canonical_user_id);
```
**Purpose:** **Primary** winner lookup  
**Type:** B-tree

---

#### `idx_winners_wallet_address`
```sql
CREATE INDEX idx_winners_wallet_address 
ON winners(LOWER(wallet_address));
```
**Purpose:** Wallet-based winner lookup  
**Type:** Functional

---

#### `idx_winners_won_at`
```sql
CREATE INDEX idx_winners_won_at 
ON winners(won_at DESC);
```
**Purpose:** Recent winners  
**Type:** B-tree (DESC)  
**Query Pattern:** `ORDER BY won_at DESC`

---

### Prize_Instantprizes (3 indexes)

Instant win prizes (case-sensitive table name).

#### `idx_prize_instantprizes_competitionId`
```sql
CREATE INDEX idx_prize_instantprizes_competitionId 
ON "Prize_Instantprizes"("competitionId");
```
**Purpose:** Instant prizes by competition  
**Type:** B-tree

---

#### `idx_prize_instantprizes_winningWalletAddress`
```sql
CREATE INDEX idx_prize_instantprizes_winningWalletAddress 
ON "Prize_Instantprizes"(LOWER("winningWalletAddress"));
```
**Purpose:** Winner wallet lookup  
**Type:** Functional

---

#### `idx_prize_instantprizes_winningUserId`
```sql
CREATE INDEX idx_prize_instantprizes_winningUserId 
ON "Prize_Instantprizes"("winningUserId");
```
**Purpose:** Winner user lookup  
**Type:** B-tree

---

### orders (4 indexes)

Order management.

#### `idx_orders_user_id`
```sql
CREATE INDEX idx_orders_user_id 
ON orders(user_id);
```
**Purpose:** User's orders  
**Type:** B-tree

---

#### `idx_orders_competition_id`
```sql
CREATE INDEX idx_orders_competition_id 
ON orders(competition_id);
```
**Purpose:** Competition orders  
**Type:** B-tree

---

#### `idx_orders_payment_status`
```sql
CREATE INDEX idx_orders_payment_status 
ON orders(payment_status);
```
**Purpose:** Payment status filtering  
**Type:** B-tree  
**Query Pattern:** `WHERE payment_status = 'pending'`

---

#### `idx_orders_created_at`
```sql
CREATE INDEX idx_orders_created_at 
ON orders(created_at DESC);
```
**Purpose:** Chronological ordering  
**Type:** B-tree (DESC)

---

### order_tickets (1 index)

Order line items.

#### `idx_order_tickets_order_id`
```sql
CREATE INDEX idx_order_tickets_order_id 
ON order_tickets(order_id);
```
**Purpose:** Tickets by order  
**Type:** B-tree

---

### payment_idempotency (3 indexes)

Idempotency key management.

#### `idx_payment_idempotency_key`
```sql
CREATE INDEX idx_payment_idempotency_key 
ON payment_idempotency(idempotency_key);
```
**Purpose:** **Critical** - Duplicate prevention  
**Type:** B-tree  
**Query Pattern:** `WHERE idempotency_key = '...'`  
**Performance:** Hot index for payment validation

---

#### `idx_payment_idempotency_expires`
```sql
CREATE INDEX idx_payment_idempotency_expires 
ON payment_idempotency(expires_at);
```
**Purpose:** Cleanup expired keys  
**Type:** B-tree  
**Usage:** Scheduled cleanup jobs

---

#### `idx_payment_idempotency_user_id`
```sql
CREATE INDEX idx_payment_idempotency_user_id 
ON payment_idempotency(user_id);
```
**Purpose:** User-specific idempotency  
**Type:** B-tree

---

### payment_webhook_events (4 indexes)

Payment webhook processing.

#### `idx_payment_webhook_events_provider`
```sql
CREATE INDEX idx_payment_webhook_events_provider 
ON payment_webhook_events(provider);
```
**Purpose:** Provider-specific webhooks  
**Type:** B-tree  
**Query Pattern:** `WHERE provider = 'stripe'`

---

#### `idx_payment_webhook_events_event_type`
```sql
CREATE INDEX idx_payment_webhook_events_event_type 
ON payment_webhook_events(event_type);
```
**Purpose:** Event type filtering  
**Type:** B-tree

---

#### `idx_payment_webhook_events_processed`
```sql
CREATE INDEX idx_payment_webhook_events_processed 
ON payment_webhook_events(processed);
```
**Purpose:** Unprocessed webhook queries  
**Type:** B-tree  
**Query Pattern:** `WHERE processed = false`  
**Usage:** Webhook processing jobs

---

#### `idx_payment_webhook_events_created_at`
```sql
CREATE INDEX idx_payment_webhook_events_created_at 
ON payment_webhook_events(created_at DESC);
```
**Purpose:** Chronological ordering  
**Type:** B-tree (DESC)

---

### payments_jobs (3 indexes)

Background job management.

#### `idx_payments_jobs_status`
```sql
CREATE INDEX idx_payments_jobs_status 
ON payments_jobs(status);
```
**Purpose:** Job status filtering  
**Type:** B-tree  
**Query Pattern:** `WHERE status = 'pending'`

---

#### `idx_payments_jobs_scheduled_at`
```sql
CREATE INDEX idx_payments_jobs_scheduled_at 
ON payments_jobs(scheduled_at);
```
**Purpose:** Job scheduling  
**Type:** B-tree  
**Query Pattern:** `WHERE scheduled_at <= NOW()`

---

#### `idx_payments_jobs_job_type`
```sql
CREATE INDEX idx_payments_jobs_job_type 
ON payments_jobs(job_type);
```
**Purpose:** Job type filtering  
**Type:** B-tree

---

### custody_transactions (3 indexes)

Custody wallet transactions.

#### `idx_custody_transactions_user_id`
```sql
CREATE INDEX idx_custody_transactions_user_id 
ON custody_transactions(user_id);
```
**Purpose:** User custody transactions  
**Type:** B-tree

---

#### `idx_custody_transactions_provider`
```sql
CREATE INDEX idx_custody_transactions_provider 
ON custody_transactions(provider);
```
**Purpose:** Provider filtering  
**Type:** B-tree

---

#### `idx_custody_transactions_status`
```sql
CREATE INDEX idx_custody_transactions_status 
ON custody_transactions(status);
```
**Purpose:** Status filtering  
**Type:** B-tree

---

### internal_transfers (3 indexes)

Internal balance transfers.

#### `idx_internal_transfers_from_user_id`
```sql
CREATE INDEX idx_internal_transfers_from_user_id 
ON internal_transfers(from_user_id);
```
**Purpose:** Outgoing transfers  
**Type:** B-tree

---

#### `idx_internal_transfers_to_user_id`
```sql
CREATE INDEX idx_internal_transfers_to_user_id 
ON internal_transfers(to_user_id);
```
**Purpose:** Incoming transfers  
**Type:** B-tree

---

#### `idx_internal_transfers_status`
```sql
CREATE INDEX idx_internal_transfers_status 
ON internal_transfers(status);
```
**Purpose:** Status filtering  
**Type:** B-tree

---

### purchase_requests (3 indexes)

Purchase request tracking.

#### `idx_purchase_requests_user_id`
```sql
CREATE INDEX idx_purchase_requests_user_id 
ON purchase_requests(user_id);
```
**Purpose:** User purchase requests  
**Type:** B-tree

---

#### `idx_purchase_requests_competition_id`
```sql
CREATE INDEX idx_purchase_requests_competition_id 
ON purchase_requests(competition_id);
```
**Purpose:** Competition requests  
**Type:** B-tree

---

#### `idx_purchase_requests_status`
```sql
CREATE INDEX idx_purchase_requests_status 
ON purchase_requests(status);
```
**Purpose:** Status filtering  
**Type:** B-tree

---

### joincompetition (2 indexes)

Competition entries (legacy table).

#### `idx_joincompetition_userid`
```sql
CREATE INDEX idx_joincompetition_userid 
ON joincompetition(userid);
```
**Purpose:** User entries  
**Type:** B-tree

---

#### `idx_joincompetition_competitionid`
```sql
CREATE INDEX idx_joincompetition_competitionid 
ON joincompetition(competitionid);
```
**Purpose:** Competition entries  
**Type:** B-tree

---

### joined_competitions (2 indexes)

User competition participation.

#### `idx_joined_competitions_user_uid`
```sql
CREATE INDEX idx_joined_competitions_user_uid 
ON joined_competitions(user_uid);
```
**Purpose:** User's competitions  
**Type:** B-tree

---

#### `idx_joined_competitions_competition_id`
```sql
CREATE INDEX idx_joined_competitions_competition_id 
ON joined_competitions(competition_id);
```
**Purpose:** Competition participants  
**Type:** B-tree

---

### participants (3 indexes)

Competition participant records.

#### `idx_participants_competition_id`
```sql
CREATE INDEX idx_participants_competition_id 
ON participants(competition_id);
```
**Purpose:** Competition participants  
**Type:** B-tree

---

#### `idx_participants_user_id`
```sql
CREATE INDEX idx_participants_user_id 
ON participants(user_id);
```
**Purpose:** User participation  
**Type:** B-tree

---

#### `idx_participants_wallet_address`
```sql
CREATE INDEX idx_participants_wallet_address 
ON participants(LOWER(wallet_address));
```
**Purpose:** Wallet-based participant lookup  
**Type:** Functional

---

### Admin Tables (11 indexes)

#### admin_users (2 indexes)
```sql
CREATE INDEX idx_admin_users_email ON admin_users(LOWER(email));
CREATE INDEX idx_admin_users_is_active ON admin_users(is_active);
```

#### admin_sessions (3 indexes)
```sql
CREATE INDEX idx_admin_sessions_admin_id ON admin_sessions(admin_id);
CREATE INDEX idx_admin_sessions_token ON admin_sessions(token);
CREATE INDEX idx_admin_sessions_expires_at ON admin_sessions(expires_at);
```

#### admin_users_audit (2 indexes)
```sql
CREATE INDEX idx_admin_users_audit_admin_id ON admin_users_audit(admin_id);
CREATE INDEX idx_admin_users_audit_created_at ON admin_users_audit(created_at DESC);
```

#### confirmation_incident_log (2 indexes)
```sql
CREATE INDEX idx_confirmation_incident_log_source ON confirmation_incident_log(source);
CREATE INDEX idx_confirmation_incident_log_created_at ON confirmation_incident_log(created_at DESC);
```

#### email_auth_sessions (3 indexes)
```sql
CREATE INDEX idx_email_auth_sessions_email ON email_auth_sessions(LOWER(email));
CREATE INDEX idx_email_auth_sessions_verification_code ON email_auth_sessions(verification_code);
CREATE INDEX idx_email_auth_sessions_expires_at ON email_auth_sessions(expires_at);
```

---

### Content Tables (12 indexes)

#### faqs (2 indexes)
```sql
CREATE INDEX idx_faqs_display_order ON faqs(display_order);
CREATE INDEX idx_faqs_category ON faqs(category);
```

#### hero_competitions (2 indexes)
```sql
CREATE INDEX idx_hero_competitions_display_order ON hero_competitions(display_order);
CREATE INDEX idx_hero_competitions_is_active ON hero_competitions(is_active);
```

#### partners (2 indexes)
```sql
CREATE INDEX idx_partners_display_order ON partners(display_order);
CREATE INDEX idx_partners_is_active ON partners(is_active);
```

#### testimonials (2 indexes)
```sql
CREATE INDEX idx_testimonials_display_order ON testimonials(display_order);
CREATE INDEX idx_testimonials_is_active ON testimonials(is_active);
```

#### site_stats (1 index)
```sql
CREATE INDEX idx_site_stats_display_order ON site_stats(display_order);
```

#### site_metadata (1 index)
```sql
CREATE INDEX idx_site_metadata_category ON site_metadata(category);
```

#### platform_statistics (1 index)
```sql
CREATE INDEX idx_platform_statistics_stat_date ON platform_statistics(stat_date DESC);
```

---

### Notification Tables (6 indexes)

#### notifications (3 indexes)
```sql
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_read ON notifications(read);
CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);
```

#### user_notifications (3 indexes)
```sql
CREATE INDEX idx_user_notifications_user_id ON user_notifications(user_id);
CREATE INDEX idx_user_notifications_read ON user_notifications(read);
CREATE INDEX idx_user_notifications_created_at ON user_notifications(created_at DESC);
```

---

### Integration Tables (3 indexes)

#### cdp_event_queue (2 indexes)
```sql
CREATE INDEX idx_cdp_event_queue_status ON cdp_event_queue(status);
CREATE INDEX idx_cdp_event_queue_created_at ON cdp_event_queue(created_at);
```

#### enqueue_cdp_event (1 index)
```sql
CREATE INDEX idx_enqueue_cdp_event_status ON enqueue_cdp_event(status);
```

---

## Performance Optimization

### Critical Hot Indexes

These indexes are accessed most frequently and critical for performance:

1. **`idx_canonical_users_canonical_user_id`** - User lookups
2. **`idx_canonical_users_wallet_address`** - Wallet authentication
3. **`idx_sub_account_balances_canonical_user_id`** - Balance checks
4. **`idx_tickets_competition_id`** - Ticket availability
5. **`idx_competitions_status`** - Active competition filtering
6. **`idx_payment_idempotency_key`** - Payment duplicate prevention
7. **`idx_pending_ticket_items_unique`** - Ticket reservation integrity

### Index Maintenance

#### Check Index Usage
```sql
SELECT 
  schemaname,
  tablename,
  indexname,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_scan DESC;
```

#### Find Unused Indexes
```sql
SELECT 
  schemaname || '.' || tablename AS table,
  indexname AS index,
  pg_size_pretty(pg_relation_size(indexrelid)) AS index_size,
  idx_scan AS scans
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
  AND idx_scan = 0
  AND indexrelname NOT LIKE 'pg_toast%'
ORDER BY pg_relation_size(indexrelid) DESC;
```

#### Index Size Report
```sql
SELECT 
  tablename,
  indexname,
  pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY pg_relation_size(indexrelid) DESC
LIMIT 20;
```

#### Rebuild Bloated Indexes
```sql
-- Check for bloat
SELECT 
  schemaname,
  tablename,
  indexname,
  pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_stat_user_indexes
WHERE schemaname = 'public';

-- Rebuild if needed
REINDEX INDEX CONCURRENTLY idx_name;
```

---

## Best Practices

### Index Design Principles

1. **Index Selectivity** - High cardinality columns make better indexes
2. **Composite Index Order** - Most selective column first
3. **Covering Indexes** - Include frequently accessed columns
4. **Functional Indexes** - For case-insensitive searches (LOWER())
5. **Partial Indexes** - For filtered queries (WHERE status = 'active')

### When to Add Indexes

✅ **DO Index:**
- Foreign key columns
- Columns in WHERE clauses
- Columns in JOIN conditions
- Columns in ORDER BY clauses
- High-cardinality columns
- Case-insensitive search columns (LOWER())

❌ **DON'T Index:**
- Small tables (< 1000 rows)
- Low-cardinality columns (true/false, status with few values)
- Frequently updated columns
- Columns never used in queries

### Index Costs

**Benefits:**
- Faster SELECT queries
- Faster JOIN operations
- Faster sorting (ORDER BY)
- Constraint enforcement (UNIQUE)

**Costs:**
- Slower INSERT/UPDATE/DELETE
- Additional storage space
- Maintenance overhead
- Query planner complexity

### Monitoring Index Performance

```sql
-- Index hit rate (should be > 99%)
SELECT 
  sum(idx_blks_hit) / nullif(sum(idx_blks_hit + idx_blks_read), 0) * 100 AS index_hit_rate
FROM pg_statio_user_indexes;

-- Table scan vs index scan ratio
SELECT 
  schemaname,
  tablename,
  seq_scan,
  idx_scan,
  CASE 
    WHEN seq_scan + idx_scan > 0 
    THEN round((100.0 * idx_scan / (seq_scan + idx_scan))::numeric, 2)
    ELSE 0
  END AS index_scan_pct
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY seq_scan DESC;
```

---

## Index Maintenance Schedule

### Daily
- Monitor index usage statistics
- Check for long-running queries
- Review slow query logs

### Weekly
- Analyze index hit rates
- Identify missing indexes from slow queries
- Check for unused indexes

### Monthly
- Review index sizes
- Analyze index bloat
- Consider REINDEX for heavily updated indexes

### Quarterly
- Full index audit
- Remove unused indexes
- Add indexes for new query patterns
- Optimize composite index order

---

## Query Optimization Tips

### Use EXPLAIN ANALYZE
```sql
EXPLAIN ANALYZE
SELECT * FROM tickets
WHERE competition_id = 'comp-id'
  AND status = 'sold';
```

### Check Index Usage
```sql
-- Should show "Index Scan" not "Seq Scan"
EXPLAIN
SELECT * FROM canonical_users
WHERE canonical_user_id = 'prize:pid:0x...';
```

### Optimize Joins
```sql
-- Good: Uses indexes on both sides
SELECT t.*, c.title
FROM tickets t
JOIN competitions c ON t.competition_id = c.id
WHERE t.canonical_user_id = 'user-id';
```

### Avoid Index Pitfalls
```sql
-- BAD: Function prevents index use
WHERE upper(email) = 'USER@EXAMPLE.COM'

-- GOOD: Use functional index
WHERE LOWER(email) = lower('user@example.com')
-- With: CREATE INDEX ON table(LOWER(email))
```

---

## Future Index Considerations

### Potential Additions

1. **Composite indexes for common query patterns:**
   ```sql
   CREATE INDEX idx_tickets_comp_user ON tickets(competition_id, canonical_user_id);
   CREATE INDEX idx_user_tx_user_status ON user_transactions(canonical_user_id, status);
   ```

2. **Partial indexes for active records:**
   ```sql
   CREATE INDEX idx_competitions_active ON competitions(id) WHERE status = 'active';
   CREATE INDEX idx_pending_tickets_active ON pending_tickets(id) WHERE status = 'pending';
   ```

3. **Expression indexes for computed values:**
   ```sql
   CREATE INDEX idx_competitions_active_soon ON competitions(start_time) 
   WHERE status = 'active' AND start_time > NOW();
   ```

---

**Last Updated:** 2026-01-30  
**Schema Version:** 1.5  
**Total Indexes:** 126  
**Most Critical:** 7 hot indexes for core operations
