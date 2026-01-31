# Database Indexes - Production Reference

**Last Updated:** January 31, 2026  
**Production Status:** 180+ Active Indexes  
**Source:** Supabase Production Database + Migration Files

---

## Table of Contents

- [Overview](#overview)
- [Index Categories](#index-categories)
  - [User & Identity Tables](#1-user--identity-tables)
  - [Balance & Financial Tables](#2-balance--financial-tables)
  - [Competition Tables](#3-competition-tables)
  - [Ticket Tables](#4-ticket-tables)
  - [Transaction Tables](#5-transaction-tables)
  - [Payment & Webhook Tables](#6-payment--webhook-tables)
  - [Order & Purchase Tables](#7-order--purchase-tables)
  - [Administrative Tables](#8-administrative-tables)
  - [Content & Metadata Tables](#9-content--metadata-tables)
  - [Integration Tables](#10-integration-tables)
- [Index Best Practices](#index-best-practices)
- [Maintenance & Monitoring](#maintenance--monitoring)
- [Performance Guidelines](#performance-guidelines)

---

## Overview

This document catalogs all production database indexes for ThePrize.io. Indexes are organized by table category with performance notes and recommendations.

**Key Statistics:**
- **Total Indexes:** 180+
- **Tables with Indexes:** 35+
- **Primary Keys:** 45
- **Unique Constraints:** 25+
- **Composite Indexes:** 40+
- **Partial Indexes:** 5+

**Naming Convention:**
- Primary Keys: `{table}_pkey`
- Regular Indexes: `idx_{table}_{column(s)}`
- Unique Indexes: `uniq_{table}_{column(s)}` or `ux_{table}_{column(s)}`
- Composite: `idx_{table}_{col1}_{col2}`

---

## Index Categories

### 1. User & Identity Tables

#### **canonical_users** (The Core User Table)
**Purpose:** Single source of truth for all user identities  
**Importance:** 🔴 Critical

| Index Name | Columns | Type | Purpose | Performance Impact |
|-----------|---------|------|---------|-------------------|
| `canonical_users_pkey` | `id` | PK | Primary key | ⚡ Essential |
| `idx_canonical_users_canonical_user_id` | `canonical_user_id` | BTREE | User lookups | 🟢 High |
| `idx_canonical_users_uid` | `uid` | BTREE | Legacy compatibility | 🟡 Medium |
| `idx_canonical_users_privy_user_id` | `privy_user_id` | UNIQUE | Privy integration | 🟢 High |
| `idx_canonical_users_wallet_address` | `LOWER(wallet_address)` | BTREE | Case-insensitive wallet lookup | 🟢 High |
| `idx_canonical_users_base_wallet_address` | `LOWER(base_wallet_address)` | BTREE | Base chain lookup | 🟢 High |
| `idx_canonical_users_eth_wallet_address` | `LOWER(eth_wallet_address)` | BTREE | ETH chain lookup | 🟢 High |
| `idx_canonical_users_email` | `LOWER(email)` | BTREE | Email login | 🟢 High |

**Notes:**
- All wallet addresses use `LOWER()` for case-insensitive matching
- Multiple wallet columns support multi-chain users
- Email index enables fast auth lookups
- ⚠️ Critical for all user operations - do not drop

#### **users** (Legacy User Table)
**Purpose:** Backward compatibility with old system  
**Importance:** 🟡 Medium (deprecated)

| Index Name | Columns | Type | Purpose |
|-----------|---------|------|---------|
| `users_pkey` | `id` | PK | Primary key |
| `idx_users_user_id` | `user_id` | BTREE | Legacy ID lookup |
| `idx_users_wallet_address` | `LOWER(wallet_address)` | BTREE | Wallet lookup |
| `update_users_updated_at` | - | TRIGGER | Auto-update timestamp |

#### **profiles** (User Profile Data)
| Index Name | Columns | Type | Purpose |
|-----------|---------|------|---------|
| `profiles_pkey` | `id` | PK | Primary key |
| `idx_profiles_user_id` | `user_id` | BTREE | Profile lookups |
| `idx_profiles_wallet_address` | `LOWER(wallet_address)` | BTREE | Wallet lookup |

---

### 2. Balance & Financial Tables

#### **sub_account_balances** (User Sub-Account Balances)
**Purpose:** Track USDC and BONUS balances per user  
**Importance:** 🔴 Critical

| Index Name | Columns | Type | Purpose | Performance |
|-----------|---------|------|---------|-------------|
| `sub_account_balances_pkey` | `id` | PK | Primary key | ⚡ Essential |
| `idx_sub_account_balances_canonical_user_id` | `canonical_user_id` | BTREE | User balance lookups | 🟢 High |
| `idx_sub_account_balances_user_id` | `user_id` | BTREE | Legacy user lookup | 🟡 Medium |
| `idx_sub_account_balances_currency` | `currency` | BTREE | Currency filtering | 🟢 High |
| `uniq_sub_account_canonical_currency` | `canonical_user_id, currency` | UNIQUE | One balance per currency | ⚡ Essential |

**Notes:**
- Composite unique index prevents duplicate balance rows
- Currency index enables fast "all USDC balances" queries
- Critical for balance payment flow

#### **balance_ledger** (Audit Trail for Balance Changes)
**Purpose:** Immutable log of all balance transactions  
**Importance:** 🔴 Critical

| Index Name | Columns | Type | Purpose |
|-----------|---------|------|---------|
| `balance_ledger_pkey` | `id` | PK | Primary key |
| `idx_balance_ledger_canonical_user_id` | `canonical_user_id` | BTREE | User transaction history |
| `idx_balance_ledger_reference_id` | `reference_id` | BTREE | Link to source transaction |
| `idx_balance_ledger_transaction_id` | `transaction_id` | BTREE | Transaction lookup |
| `idx_balance_ledger_created_at` | `created_at DESC` | BTREE | Recent transactions first |
| `idx_balance_ledger_source` | `source` | BTREE | Filter by source type |

**Notes:**
- DESC index on created_at optimizes recent transaction queries
- Reference_id links to orders, deposits, etc.
- Source column distinguishes transaction types

#### **bonus_award_audit** (Bonus Award Tracking)
| Index Name | Columns | Type | Purpose |
|-----------|---------|------|---------|
| `bonus_award_audit_pkey` | `id` | PK | Primary key |
| `idx_bonus_award_audit_canonical_user_id` | `canonical_user_id` | BTREE | User bonus history |
| `idx_bonus_award_audit_wallet_address` | `LOWER(wallet_address)` | BTREE | Wallet bonus lookup |

---

### 3. Competition Tables

#### **competitions** (Competition Definitions)
**Purpose:** Core competition data  
**Importance:** 🔴 Critical

| Index Name | Columns | Type | Purpose | Performance |
|-----------|---------|------|---------|-------------|
| `competitions_pkey` | `uid` | PK | Primary key | ⚡ Essential |
| `idx_competitions_uid` | `uid` | BTREE | Competition lookup | 🟢 High |
| `idx_competitions_status` | `status` | BTREE | Filter by status | 🟢 High |
| `idx_competitions_is_featured` | `is_featured` | BTREE | Homepage featured | 🟡 Medium |
| `idx_competitions_start_time` | `start_time` | BTREE | Upcoming competitions | 🟢 High |
| `idx_competitions_end_time` | `end_time` | BTREE | Ending soon | 🟢 High |
| `idx_competitions_category` | `category` | BTREE | Category filtering | 🟡 Medium |
| `idx_competitions_sold_tickets` | `sold_tickets` | BTREE | Sold out check | 🟢 High |

**Notes:**
- Status index critical for "active competitions" queries
- Time indexes support date-range queries
- Sold_tickets index optimizes sold-out checks

#### **competition_entries** (User Competition Participation)
| Index Name | Columns | Type | Purpose |
|-----------|---------|------|---------|
| `competition_entries_pkey` | `id` | PK | Primary key |
| `idx_competition_entries_canonical_user_id` | `canonical_user_id` | BTREE | User's entries |
| `idx_competition_entries_competition_id` | `competition_id` | BTREE | Competition participants |
| `idx_competition_entries_is_winner` | `is_winner` | BTREE | Winner lookups |
| `idx_competition_entries_latest_purchase_at` | `latest_purchase_at DESC` | BTREE | Recent entries |

---

### 4. Ticket Tables

#### **tickets** (Sold Tickets)
**Purpose:** All confirmed ticket purchases  
**Importance:** 🔴 Critical

| Index Name | Columns | Type | Purpose | Performance |
|-----------|---------|------|---------|-------------|
| `tickets_pkey` | `id` | PK | Primary key | ⚡ Essential |
| `idx_tickets_competition_id` | `competition_id` | BTREE | Competition tickets | 🟢 High |
| `idx_tickets_user_id` | `user_id` | BTREE | User tickets (legacy) | 🟡 Medium |
| `idx_tickets_canonical_user_id` | `canonical_user_id` | BTREE | User tickets (current) | 🟢 High |
| `idx_tickets_wallet_address` | `LOWER(wallet_address)` | BTREE | Wallet tickets | 🟢 High |
| `idx_tickets_status` | `status` | BTREE | Status filtering | 🟢 High |
| `idx_tickets_is_winner` | `is_winner` | BTREE | Winner tickets | 🟢 High |
| `idx_tickets_competition_user` | `competition_id, user_id` | COMPOSITE | User's tickets per comp | 🟢 High |

**Notes:**
- Composite index optimizes "user's tickets in competition X" queries
- Wallet address index supports multi-wallet users
- Is_winner index critical for winner displays

#### **tickets_sold** (Ticket Sales Record)
| Index Name | Columns | Type | Purpose |
|-----------|---------|------|---------|
| `tickets_sold_pkey` | `id` | PK | Primary key |
| `idx_tickets_sold_competition_id` | `competition_id` | BTREE | Competition sales |
| `idx_tickets_sold_purchaser_id` | `purchaser_id` | BTREE | Purchaser history |

#### **pending_tickets** (Reserved/Pending Tickets)
**Purpose:** Tickets held during checkout  
**Importance:** 🔴 Critical

| Index Name | Columns | Type | Purpose | Performance |
|-----------|---------|------|---------|-------------|
| `pending_tickets_pkey` | `id` | PK | Primary key | ⚡ Essential |
| `idx_pending_tickets_id` | `id` | BTREE | Explicit ID lookup | 🟢 High |
| `idx_pending_tickets_user_id` | `user_id` | BTREE | User pending tickets | 🟡 Medium |
| `idx_pending_tickets_canonical_user_id` | `canonical_user_id` | BTREE | User pending (current) | 🟢 High |
| `idx_pending_tickets_competition_id` | `competition_id` | BTREE | Competition pending | 🟢 High |
| `idx_pending_tickets_status` | `status` | BTREE | Status filtering | 🟢 High |
| `idx_pending_tickets_expires_at` | `expires_at` | BTREE | Expiry cleanup | 🟢 High |
| `idx_pending_tickets_user_status` | `user_id, status` | COMPOSITE | User active pending | 🟢 High |
| `idx_pending_tickets_comp_status_user` | `competition_id, status, user_id` | COMPOSITE | Complex queries | 🟢 High |
| `idx_pending_tickets_competition_status` | `competition_id, status` | COMPOSITE | Comp pending count | 🟢 High |
| `idx_pending_tickets_comp_status_exp` | `competition_id, status, expires_at` | COMPOSITE | Expiry queries | 🟢 High |
| `idx_pending_tickets_comp_status` | `competition_id, status` | COMPOSITE | Simple status query | 🟢 High |
| `idx_pending_tickets_identifiers` | `user_id, wallet_address, privy_user_id` | COMPOSITE | Multi-identifier lookup | 🟢 High |
| `idx_pending_tickets_wallet_lower` | `LOWER(wallet_address)` | BTREE | Case-insensitive wallet | 🟢 High |
| `idx_pending_tickets_user_id_lower` | `LOWER(user_id)` | BTREE | Case-insensitive user | 🟡 Medium |
| `idx_pending_tickets_idempotency` | `idempotency_key` | BTREE | Prevent duplicates | 🟢 High |
| `idx_pt_reservation` | `reservation_id` | BTREE | Reservation lookup | 🟢 High |
| `idx_pending_tickets_comp_id` | `competition_id` | BTREE | Competition pending | 🟢 High |
| `idx_pending_tickets_reservation` | `reservation_id` | BTREE | Reservation link | 🟢 High |
| `idx_pending_tickets_comp_user` | `competition_id, user_id` | COMPOSITE | User comp pending | 🟢 High |
| `idx_pending_tickets_active` | `status, expires_at` | COMPOSITE | Active tickets | 🟢 High |
| `idx_pending_tickets_canonical_user` | `canonical_user_id` | BTREE | Canonical user pending | 🟢 High |
| `idx_pending_tickets_wallet` | `wallet_address` | BTREE | Wallet pending | 🟢 High |
| `idx_pending_tickets_privy` | `privy_user_id` | BTREE | Privy user pending | 🟢 High |
| `idx_pending_tickets_active_partial` | `status, expires_at` WHERE `status='pending'` | PARTIAL | Active pending only | 🟢 High |
| `ux_pending_tickets_reservation_id` | `reservation_id` | UNIQUE | One header per reservation | ⚡ Essential |

**Notes:**
- ⚠️ **Most indexed table** - critical for performance
- Multiple composite indexes optimize complex queries
- Partial index reduces index size for common queries
- Idempotency key prevents duplicate reservations
- Expires_at indexes support cleanup jobs

#### **pending_ticket_items** (Individual Ticket Numbers in Reservation)
**Purpose:** The actual ticket numbers being held  
**Importance:** 🔴 Critical

| Index Name | Columns | Type | Purpose | Performance |
|-----------|---------|------|---------|-------------|
| `pending_ticket_items_pkey` | `id` | PK | Primary key | ⚡ Essential |
| `idx_pending_ticket_items_comp_ticket` | `competition_id, ticket_number` | COMPOSITE | Ticket availability | 🟢 High |
| `idx_pending_ticket_items_comp_expires` | `competition_id, expires_at` | COMPOSITE | Expiry by comp | 🟢 High |
| `idx_pending_ticket_items_status_expires` | `status, expires_at` | COMPOSITE | Expired items | 🟢 High |
| `idx_pending_ticket_items_header` | `pending_ticket_id` | BTREE | Items in reservation | 🟢 High |
| `idx_pending_items_competition_ticket` | `competition_id, ticket_number` | COMPOSITE | Duplicate check | 🟢 High |
| `idx_pending_items_comp_status_expires` | `competition_id, status, expires_at` | COMPOSITE | Complex queries | 🟢 High |
| `idx_pti_comp_tn` | `competition_id, ticket_number` | COMPOSITE | Quick lookup | 🟢 High |
| `idx_pti_pending_not_exp` | `status, expires_at` WHERE `status='pending'` | PARTIAL | Active holds | 🟢 High |
| `idx_pending_ticket_items_competition` | `competition_id` | BTREE | Competition items | 🟢 High |
| `ux_pending_ticket_items_comp_ticket_pending` | `competition_id, ticket_number` WHERE `status='pending'` | UNIQUE PARTIAL | No double-booking | ⚡ Essential |
| `ux_pending_pending_hold` | `competition_id, ticket_number, status` | UNIQUE | Enforce single hold | ⚡ Essential |
| `uq_pending_ticket_items_active` | `competition_id, ticket_number` WHERE `status='pending'` | UNIQUE PARTIAL | Active uniqueness | ⚡ Essential |
| `ux_pending_item_comp_ticket` | `competition_id, ticket_number` | UNIQUE | Global uniqueness | ⚡ Essential |
| `ux_pending_ticket_items_comp_ticket` | `competition_id, ticket_number` | UNIQUE | Prevent duplicates | ⚡ Essential |

**Notes:**
- ⚠️ **Multiple unique constraints prevent double-booking**
- Partial unique indexes are more efficient
- Critical for ticket availability checks
- Must be highly optimized (queried on every purchase)

---

### 5. Transaction Tables

#### **user_transactions** (User Financial Transactions)
**Purpose:** All user deposits, purchases, withdrawals  
**Importance:** 🔴 Critical

| Index Name | Columns | Type | Purpose | Performance |
|-----------|---------|------|---------|-------------|
| `user_transactions_pkey` | `id` | PK | Primary key | ⚡ Essential |
| `idx_user_transactions_user_id` | `user_id` | BTREE | User transaction history | 🟡 Medium |
| `idx_user_transactions_canonical_user_id` | `canonical_user_id` | BTREE | User history (current) | 🟢 High |
| `idx_user_transactions_competition_id` | `competition_id` | BTREE | Competition transactions | 🟢 High |
| `idx_user_transactions_webhook_ref` | `webhook_reference_id` | BTREE | Webhook lookup | 🟢 High |
| `idx_user_transactions_charge_id` | `charge_id` | BTREE | Charge lookup | 🟢 High |
| `idx_user_transactions_type` | `type` | BTREE | Transaction type filter | 🟢 High |
| `idx_user_transactions_status` | `status` | BTREE | Status filtering | 🟢 High |
| `idx_user_transactions_user_comp` | `user_id, competition_id` | COMPOSITE | User comp transactions | 🟢 High |
| `idx_user_transactions_created_at` | `created_at DESC` | BTREE | Recent transactions | 🟢 High |
| `idx_user_transactions_updated_at` | `updated_at DESC` | BTREE | Recently updated | 🟢 High |
| `idx_user_transactions_payment_status` | `payment_status` | BTREE | Payment filtering | 🟢 High |
| `idx_ut_canonical_created` | `canonical_user_id, created_at DESC` | COMPOSITE | User recent history | 🟢 High |
| `idx_ut_status_type` | `status, type` | COMPOSITE | Status+type queries | 🟢 High |
| `idx_user_transactions_privy` | `privy_user_id` | BTREE | Privy user transactions | 🟢 High |
| `idx_user_transactions_type_status` | `type, status` | COMPOSITE | Type+status filtering | 🟢 High |
| `user_transactions_webhook_ref_key` | `webhook_reference_id` | UNIQUE | Idempotency | ⚡ Essential |
| `user_transactions_charge_id_key` | `charge_id` | UNIQUE | Charge uniqueness | ⚡ Essential |
| `uniq_user_tx_reservation_desc` | `reservation_id, description` | UNIQUE | Prevent duplicate orders | ⚡ Essential |

**Notes:**
- DESC indexes optimize "recent transactions" queries
- Unique constraints ensure payment idempotency
- Multiple composite indexes for dashboard queries
- Critical for financial reporting

---

### 6. Payment & Webhook Tables

#### **payment_idempotency** (Payment Deduplication)
**Purpose:** Prevent duplicate payment processing  
**Importance:** 🔴 Critical

| Index Name | Columns | Type | Purpose |
|-----------|---------|------|---------|
| `payment_idempotency_pkey` | `id` | PK | Primary key |
| `payment_idempotency_idempotency_key_key` | `idempotency_key` | UNIQUE | Idempotency enforcement |
| `idx_payment_idempotency_key` | `idempotency_key` | BTREE | Fast key lookup |
| `idx_payment_idempotency_expires` | `expires_at` | BTREE | Cleanup expired keys |
| `idx_payment_idempotency_user_id` | `user_id` | BTREE | User idempotency history |
| `idx_payment_idempotency_cuid` | `canonical_user_id` | BTREE | Canonical user lookup |

**Notes:**
- Unique constraint prevents duplicate payments
- TTL-based expiry cleanup

#### **payment_webhook_events** (Payment Provider Webhooks)
| Index Name | Columns | Type | Purpose |
|-----------|---------|------|---------|
| `payment_webhook_events_pkey` | `id` | PK | Primary key |
| `idx_payment_webhook_events_provider` | `provider` | BTREE | Provider filtering |
| `idx_payment_webhook_events_event_type` | `event_type` | BTREE | Event type filtering |
| `idx_payment_webhook_events_processed` | `processed` | BTREE | Unprocessed events |
| `idx_payment_webhook_events_created_at` | `created_at DESC` | BTREE | Recent events |

#### **payments_jobs** (Background Payment Jobs)
| Index Name | Columns | Type | Purpose |
|-----------|---------|------|---------|
| `payments_jobs_pkey` | `id` | PK | Primary key |
| `idx_payments_jobs_status` | `status` | BTREE | Job status filtering |
| `idx_payments_jobs_scheduled_at` | `scheduled_at` | BTREE | Scheduled jobs |
| `idx_payments_jobs_job_type` | `job_type` | BTREE | Job type filtering |
| `idx_payments_jobs_status_run` | `status, scheduled_at` | COMPOSITE | Runnable jobs |

#### **custody_transactions** (Custody Wallet Transactions)
| Index Name | Columns | Type | Purpose |
|-----------|---------|------|---------|
| `custody_transactions_pkey` | `id` | PK | Primary key |
| `idx_custody_transactions_user_id` | `user_id` | BTREE | User custody history |
| `idx_custody_transactions_provider` | `provider` | BTREE | Provider filtering |
| `idx_custody_transactions_status` | `status` | BTREE | Status filtering |

---

### 7. Order & Purchase Tables

#### **orders** (Purchase Orders)
**Purpose:** Order records for ticket purchases  
**Importance:** 🔴 Critical

| Index Name | Columns | Type | Purpose |
|-----------|---------|------|---------|
| `orders_pkey` | `id` | PK | Primary key |
| `idx_orders_user_id` | `user_id` | BTREE | User orders |
| `idx_orders_status` | `status` | BTREE | Order status |
| `idx_orders_competition` | `competition_id` | BTREE | Competition orders |
| `idx_orders_completed_at` | `completed_at` | BTREE | Completed orders |
| `idx_orders_competition_status` | `competition_id, status` | COMPOSITE | Comp orders by status |
| `idx_orders_status_created` | `status, created_at` | COMPOSITE | Recent by status |
| `idx_orders_user_comp` | `user_id, competition_id` | COMPOSITE | User comp orders |
| `idx_orders_cuid` | `canonical_user_id` | BTREE | Canonical user orders |
| `idx_orders_payment_status` | `payment_status` | BTREE | Payment filtering |
| `idx_orders_created_at` | `created_at DESC` | BTREE | Recent orders |

#### **order_tickets** (Tickets in Order)
| Index Name | Columns | Type | Purpose |
|-----------|---------|------|---------|
| `order_tickets_pkey` | `id` | PK | Primary key |
| `idx_order_tickets_order_id` | `order_id` | BTREE | Order's tickets |

#### **purchase_requests** (Purchase Request Queue)
| Index Name | Columns | Type | Purpose |
|-----------|---------|------|---------|
| `purchase_requests_pkey` | `id` | PK | Primary key |
| `idx_purchase_requests_user_id` | `user_id` | BTREE | User requests |
| `idx_purchase_requests_competition_id` | `competition_id` | BTREE | Competition requests |
| `idx_purchase_requests_status` | `status` | BTREE | Status filtering |

#### **internal_transfers** (Internal Balance Transfers)
| Index Name | Columns | Type | Purpose |
|-----------|---------|------|---------|
| `internal_transfers_pkey` | `id` | PK | Primary key |
| `internal_transfers_transfer_id_key` | `transfer_id` | UNIQUE | Transfer uniqueness |
| `idx_internal_transfers_from_user_id` | `from_user_id` | BTREE | Sender history |
| `idx_internal_transfers_to_user_id` | `to_user_id` | BTREE | Recipient history |
| `idx_internal_transfers_status` | `status` | BTREE | Status filtering |

---

### 8. Administrative Tables

#### **admin_sessions** (Admin Authentication)
| Index Name | Columns | Type | Purpose |
|-----------|---------|------|---------|
| `admin_sessions_pkey` | `id` | PK | Primary key |
| `admin_sessions_token_key` | `token` | UNIQUE | Session token uniqueness |
| `idx_admin_sessions_token` | `token` | BTREE | Token lookup |
| `idx_admin_sessions_admin_id` | `admin_id` | BTREE | Admin's sessions |
| `idx_admin_sessions_expires_at` | `expires_at` | BTREE | Expired session cleanup |

#### **admin_users** (Admin User Accounts)
| Index Name | Columns | Type | Purpose |
|-----------|---------|------|---------|
| `admin_users_pkey` | `id` | PK | Primary key |
| `idx_admin_users_email` | `LOWER(email)` | BTREE | Email login |
| `idx_admin_users_is_active` | `is_active` | BTREE | Active admins |

#### **admin_users_audit** (Admin Action Audit Log)
| Index Name | Columns | Type | Purpose |
|-----------|---------|------|---------|
| `admin_users_audit_pkey` | `id` | PK | Primary key |
| `idx_admin_users_audit_admin_id` | `admin_id` | BTREE | Admin's actions |
| `idx_admin_users_audit_created_at` | `created_at DESC` | BTREE | Recent actions |

#### **email_auth_sessions** (Email Authentication)
| Index Name | Columns | Type | Purpose |
|-----------|---------|------|---------|
| `email_auth_sessions_pkey` | `id` | PK | Primary key |
| `idx_email_auth_sessions_email` | `LOWER(email)` | BTREE | Email lookup |
| `idx_email_auth_sessions_expires_at` | `expires_at` | BTREE | Expired cleanup |
| `idx_email_auth_sessions_verification_code` | `verification_code` | BTREE | Code verification |

---

### 9. Content & Metadata Tables

#### **joincompetition** (Competition Participation - Legacy)
| Index Name | Columns | Type | Purpose |
|-----------|---------|------|---------|
| `joincompetition_pkey` | `id` | PK | Primary key |
| `idx_joincompetition_userid` | `userid` | BTREE | User entries |
| `idx_joincompetition_wallet` | `walletaddress` | BTREE | Wallet entries |
| `idx_joincompetition_competition` | `competitionid` | BTREE | Competition entries |
| `idx_joincompetition_user_comp` | `userid, competitionid` | COMPOSITE | User comp entries |
| `idx_joincompetition_uid` | `uid` | BTREE | UID lookup |
| `idx_joincompetition_competitionid_tickets` | `competitionid, numberoftickets` | COMPOSITE | Ticket count queries |
| `idx_joincompetition_competitionid` | `competitionid` | BTREE | Competition lookup |
| `idx_joincompetition_comp` | `competitionid` | BTREE | Alias |
| `idx_joincompetition_wallet_lower` | `LOWER(walletaddress)` | BTREE | Case-insensitive |
| `idx_joincompetition_walletaddress_lower` | `LOWER(walletaddress)` | BTREE | Case-insensitive |
| `idx_joincompetition_canonical_user_id` | `canonical_user_id` | BTREE | Canonical user |
| `idx_joincompetition_cuid` | `canonical_user_id` | BTREE | Alias |
| `idx_joincompetition_privy_user_id` | `privy_user_id` | BTREE | Privy user |
| `uniq_joincompetition_tx_comp` | `transaction_id, competitionid` | UNIQUE | Prevent duplicates |

#### **Prize_Instantprizes** (Instant Win Prizes)
| Index Name | Columns | Type | Purpose |
|-----------|---------|------|---------|
| `Prize_Instantprizes_pkey` | `id` | PK | Primary key |
| `idx_instant_prizes_competition` | `competitionId` | BTREE | Competition prizes |
| `idx_instant_prizes_winning_ticket` | `winningTicketNumber` | BTREE | Winning ticket lookup |
| `idx_instant_prizes_unclaimed` | `claimed` | BTREE | Unclaimed prizes |
| `idx_prize_instantprizes_competitionId` | `competitionId` | BTREE | Competition filter |
| `idx_prize_instantprizes_winningWalletAddress` | `LOWER(winningWalletAddress)` | BTREE | Winner lookup |
| `idx_prize_instantprizes_winningUserId` | `winningUserId` | BTREE | User prizes |

#### **winners** (Competition Winners)
| Index Name | Columns | Type | Purpose |
|-----------|---------|------|---------|
| `winners_pkey` | `id` | PK | Primary key |
| `idx_winners_competition_id` | `competition_id` | BTREE | Competition winners |
| `idx_winners_user_id` | `user_id` | BTREE | User wins |
| `idx_winners_canonical_user_id` | `canonical_user_id` | BTREE | Canonical user wins |
| `idx_winners_wallet_address` | `LOWER(wallet_address)` | BTREE | Wallet wins |
| `idx_winners_won_at` | `won_at DESC` | BTREE | Recent winners |

#### **joined_competitions** (User Competition History)
| Index Name | Columns | Type | Purpose |
|-----------|---------|------|---------|
| `joined_competitions_pkey` | `id` | PK | Primary key |
| `idx_joined_competitions_user_uid` | `user_uid` | BTREE | User history |
| `idx_joined_competitions_competition_id` | `competition_id` | BTREE | Competition participants |

#### **participants** (Competition Participants)
| Index Name | Columns | Type | Purpose |
|-----------|---------|------|---------|
| `participants_pkey` | `id` | PK | Primary key |
| `idx_participants_competition_id` | `competition_id` | BTREE | Competition participants |
| `idx_participants_user_id` | `user_id` | BTREE | User participations |
| `idx_participants_wallet_address` | `LOWER(wallet_address)` | BTREE | Wallet participations |

#### **notifications** & **user_notifications**
| Index Name | Columns | Type | Purpose |
|-----------|---------|------|---------|
| `notifications_pkey` | `id` | PK | Primary key |
| `idx_notifications_user_id` | `user_id` | BTREE | User notifications |
| `idx_notifications_read` | `read` | BTREE | Unread filter |
| `idx_notifications_created_at` | `created_at DESC` | BTREE | Recent notifications |
| `user_notifications_pkey` | `id` | PK | Primary key |
| `idx_user_notifications_user_id` | `user_id` | BTREE | User notifications |
| `idx_user_notifications_read` | `read` | BTREE | Unread filter |
| `idx_user_notifications_created_at` | `created_at DESC` | BTREE | Recent notifications |

#### **Content Tables** (FAQs, Partners, Testimonials, etc.)
| Table | Key Indexes | Purpose |
|-------|------------|---------|
| `faqs` | `display_order`, `category` | FAQ management |
| `hero_competitions` | `display_order`, `is_active` | Homepage display |
| `partners` | `display_order`, `is_active` | Partner showcase |
| `testimonials` | `display_order`, `is_active` | Testimonial display |
| `site_stats` | `display_order` | Stats display |
| `site_metadata` | `category` | Metadata filtering |
| `platform_statistics` | `stat_date DESC` | Historical stats |

---

### 10. Integration Tables

#### **cdp_event_queue** (Customer Data Platform Events)
| Index Name | Columns | Type | Purpose |
|-----------|---------|------|---------|
| `cdp_event_queue_pkey` | `id` | PK | Primary key |
| `idx_cdp_event_queue_status` | `status` | BTREE | Pending events |
| `idx_cdp_event_queue_created_at` | `created_at` | BTREE | Event age |

#### **enqueue_cdp_event** (CDP Event Queue - Alternate)
| Index Name | Columns | Type | Purpose |
|-----------|---------|------|---------|
| `enqueue_cdp_event_pkey` | `id` | PK | Primary key |
| `idx_enqueue_cdp_event_status` | `status` | BTREE | Status filtering |

#### **confirmation_incident_log** (Incident Logging)
| Index Name | Columns | Type | Purpose |
|-----------|---------|------|---------|
| `confirmation_incident_log_pkey` | `id` | PK | Primary key |
| `idx_confirmation_incident_log_source` | `source` | BTREE | Source filtering |
| `idx_confirmation_incident_log_created_at` | `created_at DESC` | BTREE | Recent incidents |

---

## Index Best Practices

### When to Add Indexes

✅ **DO index:**
- Foreign key columns (e.g., `competition_id`, `user_id`)
- Columns used in WHERE clauses frequently
- Columns used in JOIN conditions
- Columns used in ORDER BY (consider DESC)
- Unique constraints for business rules
- Columns used in GROUP BY

❌ **DON'T index:**
- Small tables (< 1000 rows)
- Columns with very low cardinality (e.g., boolean flags)
- Columns that change frequently
- Columns never used in queries

### Index Types

1. **BTREE (Default)**: Best for most queries, supports `=`, `<`, `>`, `BETWEEN`, `IN`
2. **UNIQUE**: Enforces uniqueness, also speeds up lookups
3. **COMPOSITE**: Multiple columns, order matters (most selective first)
4. **PARTIAL**: Indexes subset of rows with WHERE clause
5. **EXPRESSION**: Index on computed values (e.g., `LOWER(email)`)

### Composite Index Guidelines

**Column Order Matters:**
```sql
-- Good: Most selective column first
CREATE INDEX idx_orders_comp_status_user ON orders(competition_id, status, user_id);

-- This index can satisfy:
-- WHERE competition_id = X
-- WHERE competition_id = X AND status = Y
-- WHERE competition_id = X AND status = Y AND user_id = Z

-- But NOT:
-- WHERE status = Y
-- WHERE user_id = Z
```

### Partial Index Examples

```sql
-- Index only active pending tickets (saves space)
CREATE INDEX idx_pending_tickets_active_partial 
ON pending_tickets(status, expires_at) 
WHERE status = 'pending';

-- Index only unclaimed prizes
CREATE INDEX idx_instant_prizes_unclaimed 
ON Prize_Instantprizes(competitionId, winningTicketNumber) 
WHERE claimed = false;
```

---

## Maintenance & Monitoring

### Index Health Checks

```sql
-- Find unused indexes (run in production periodically)
SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read, idx_tup_fetch
FROM pg_stat_user_indexes
WHERE idx_scan = 0
AND indexrelname NOT LIKE '%_pkey'
ORDER BY pg_relation_size(indexrelid) DESC;

-- Find duplicate indexes
SELECT pg_size_pretty(sum(pg_relation_size(idx))::bigint) as size,
       (array_agg(idx))[1] as idx1, (array_agg(idx))[2] as idx2,
       (array_agg(idx))[3] as idx3, (array_agg(idx))[4] as idx4
FROM (
    SELECT indexrelid::regclass as idx, indrelid::regclass as tbl,
           array_agg(indkey::text) as cols
    FROM pg_index
    GROUP BY indexrelid, indrelid, indkey
) sub
GROUP BY tbl, cols
HAVING count(*) > 1;

-- Check index bloat
SELECT schemaname, tablename, indexname,
       pg_size_pretty(pg_relation_size(indexrelid)) as index_size
FROM pg_stat_user_indexes
ORDER BY pg_relation_size(indexrelid) DESC
LIMIT 20;

-- Monitor index usage efficiency
SELECT relname, 
       idx_scan as index_scans,
       idx_tup_read as tuples_read,
       idx_tup_fetch as tuples_fetched,
       CASE WHEN idx_tup_read > 0 
            THEN round((idx_tup_fetch::numeric / idx_tup_read) * 100, 2)
            ELSE 0 
       END as efficiency_pct
FROM pg_stat_user_tables
WHERE idx_scan > 0
ORDER BY efficiency_pct ASC;
```

### Reindexing (When Needed)

```sql
-- Reindex a single index (use CONCURRENTLY to avoid locking)
REINDEX INDEX CONCURRENTLY idx_tickets_competition_id;

-- Reindex an entire table
REINDEX TABLE CONCURRENTLY tickets;

-- Reindex all indexes in schema (caution: time-consuming)
REINDEX SCHEMA public;
```

**When to Reindex:**
- After large bulk updates/deletes
- Index bloat detected (>50% dead tuples)
- Query performance degraded over time
- After major data migrations

---

## Performance Guidelines

### Query Optimization

1. **Use EXPLAIN ANALYZE** to verify index usage:
```sql
EXPLAIN ANALYZE
SELECT * FROM tickets 
WHERE competition_id = '123' 
AND canonical_user_id = 'user_abc';
```

2. **Check for Index Scans vs Sequential Scans:**
   - `Index Scan` = Good ✅
   - `Bitmap Index Scan` = Good ✅
   - `Seq Scan` on large tables = Bad ❌

3. **Watch for Index vs Index Only Scans:**
   - `Index Only Scan` = Best (data in index)
   - `Index Scan` = Good (needs table lookup)

### Index Maintenance Schedule

| Task | Frequency | Purpose |
|------|-----------|---------|
| Analyze tables | Daily | Update statistics |
| Check index usage | Weekly | Find unused indexes |
| Check bloat | Monthly | Identify reindex candidates |
| Reindex if needed | Quarterly | Reduce bloat |

### Auto-vacuum Configuration

Ensure auto-vacuum is properly configured:
```sql
-- Check current settings
SHOW autovacuum;
SHOW autovacuum_vacuum_scale_factor;
SHOW autovacuum_analyze_scale_factor;

-- For high-write tables, consider more aggressive settings
ALTER TABLE user_transactions 
SET (autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE pending_tickets 
SET (autovacuum_vacuum_scale_factor = 0.05);
```

---

## Related Documentation
- [Triggers.md](./Triggers.md) - Database trigger reference
- [Functions.md](./Functions.md) - Database function reference
- [SCHEMA_AUDIT_REPORT.md](./SCHEMA_AUDIT_REPORT.md) - Schema audit results
- [BASELINE_MIGRATION_README.md](./BASELINE_MIGRATION_README.md) - Migration guide

---

**Document Version:** 1.0  
**Maintainer:** Database Team  
**Last Audit:** January 31, 2026
