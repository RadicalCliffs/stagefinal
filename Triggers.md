# Database Triggers - Production Reference

**Last Updated:** January 31, 2026  
**Production Status:** 78 Active Triggers (51 Unique)  
**Source:** Supabase Production Database

---

## Table of Contents

- [Overview](#overview)
- [Trigger Categories](#trigger-categories)
  - [1. Timestamp Management (4 triggers)](#1-timestamp-management)
  - [2. Data Normalization (5 triggers)](#2-data-normalization)
  - [3. Realtime Broadcast (17 triggers)](#3-realtime-broadcast)
  - [4. Balance & Payment (7 triggers)](#4-balance--payment)
  - [5. Ticket Management (10 triggers)](#5-ticket-management)
  - [6. Canonical User ID (6 triggers)](#6-canonical-user-id)
  - [7. Transaction Processing (15 triggers)](#7-transaction-processing)
  - [8. Wallet Synchronization (5 triggers)](#8-wallet-synchronization)
  - [9. Competition Sync (2 triggers)](#9-competition-sync)
  - [10. Other Business Logic (7 triggers)](#10-other-business-logic)
- [Migration Status](#migration-status)
- [Best Practices](#best-practices)

---

## Overview

This document catalogs all 78 production database triggers currently active in the ThePrize.io Supabase database. Triggers are organized by functional category with importance ratings and usage notes.

**Key Statistics:**
- **Total Trigger Instances:** 78 (includes multiple events per trigger)
- **Unique Trigger Names:** 51
- **Tables with Triggers:** 20+
- **Critical Business Logic Triggers:** 35
- **Realtime Broadcasting Triggers:** 17

---

## Trigger Categories

### 1. Timestamp Management
**Purpose:** Automatically update `updated_at` timestamps on row modifications  
**Importance:** 🟢 Standard (but critical for data integrity)

| Trigger Name | Table | Events | Status |
|-------------|-------|--------|--------|
| `update_user_transactions_updated_at` | `user_transactions` | BEFORE UPDATE | ✅ Production |
| `update_pending_tickets_updated_at` | `pending_tickets` | BEFORE UPDATE | ✅ Production |
| `update_canonical_users_updated_at` | `canonical_users` | BEFORE UPDATE | ✅ Production |
| `update_competitions_updated_at` | `competitions` | BEFORE UPDATE | ✅ Production |

**Additional Timestamp Triggers:**
- `trigger_instant_win_grids_updated_at`
- `trigger_joincompetition_updated_at`
- `payments_set_updated_at`

**Function Used:** `update_updated_at_column()`

**Notes:**
- These triggers are passive and low-overhead
- Essential for audit trails and change tracking
- Do not modify business logic

---

### 2. Data Normalization
**Purpose:** Ensure data consistency, normalize identifiers, and enforce data quality  
**Importance:** 🔴 Critical

| Trigger Name | Table | Events | Status | Purpose |
|-------------|-------|--------|--------|---------|
| `canonical_users_normalize_before_write` | `canonical_users` | BEFORE INSERT/UPDATE | ✅ Production | Normalize email, wallet addresses |
| `users_normalize_before_write` | `users` | BEFORE INSERT/UPDATE | ✅ Production | Normalize legacy user data |
| `cu_normalize_and_enforce_trg` | `canonical_users` | BEFORE INSERT/UPDATE | ✅ Production | Enforce canonical user rules |
| `trg_canonical_users_normalize` | `canonical_users` | BEFORE INSERT/UPDATE | ✅ Production | Additional normalization layer |
| `trg_normalize_sub_account_currency` | `sub_account_balances` | BEFORE INSERT/UPDATE | ✅ Production | Ensure valid currency codes |

**Functions Used:**
- `canonical_users_normalize_before_write()`
- `cu_normalize_and_enforce()`
- `normalize_sub_account_currency()`

**Notes:**
- ⚠️ **Critical for data integrity** - prevents invalid data entry
- Normalizes wallet addresses to lowercase
- Validates email formats
- Ensures canonical_user_id consistency

---

### 3. Realtime Broadcast
**Purpose:** Enable Supabase Realtime subscriptions for live UI updates  
**Importance:** 🟡 Important (UX)

| Trigger Name | Table | Events | Status |
|-------------|-------|--------|--------|
| `balance_ledger_broadcast` | `balance_ledger` | AFTER INSERT/UPDATE/DELETE | ✅ Production |
| `balance_ledger_broadcast_trigger` | `balance_ledger` | AFTER INSERT/UPDATE/DELETE | ✅ Production |
| `canonical_users_broadcast` | `canonical_users` | AFTER INSERT/UPDATE/DELETE | ✅ Production |
| `competitions_broadcast` | `competitions` | AFTER INSERT/UPDATE/DELETE | ✅ Production |
| `competitions_broadcast_trigger` | `competitions` | AFTER INSERT/UPDATE/DELETE | ✅ Production |
| `joincompetition_broadcast` | `joincompetition` | AFTER INSERT/UPDATE/DELETE | ✅ Production |
| `joincompetition_broadcast_trigger` | `joincompetition` | AFTER INSERT/UPDATE/DELETE | ✅ Production |
| `orders_broadcast` | `orders` | AFTER INSERT/UPDATE/DELETE | ✅ Production |
| `payment_webhook_events_broadcast` | `payment_webhook_events` | AFTER INSERT/UPDATE/DELETE | ✅ Production |
| `payments_broadcast` | `payments` | AFTER INSERT/UPDATE/DELETE | ✅ Production |
| `pending_tickets_broadcast` | `pending_tickets` | AFTER INSERT/UPDATE/DELETE | ✅ Production |
| `pending_tickets_broadcast_trigger` | `pending_tickets` | AFTER INSERT/UPDATE/DELETE | ✅ Production |
| `reservations_broadcast` | `reservations` | AFTER INSERT/UPDATE/DELETE | ✅ Production |
| `sub_account_balances_broadcast_trigger` | `sub_account_balances` | AFTER INSERT/UPDATE/DELETE | ✅ Production |
| `tickets_broadcast` | `tickets` | AFTER INSERT/UPDATE/DELETE | ✅ Production |
| `tickets_broadcast_trigger` | `tickets` | AFTER INSERT/UPDATE/DELETE | ✅ Production |
| `user_transactions_broadcast` | `user_transactions` | AFTER INSERT/UPDATE/DELETE | ✅ Production |
| `user_transactions_broadcast_trigger` | `user_transactions` | AFTER INSERT/UPDATE/DELETE | ✅ Production |
| `winners_broadcast_trigger` | `winners` | AFTER INSERT/UPDATE/DELETE | ✅ Production |

**Additional Broadcast Triggers:**
- `trg_bcast_ticket_changes` (tickets)
- `trg_bcast_winner_changes` (winners)

**Functions Used:**
- Supabase built-in realtime broadcasting
- `bcast_ticket_changes()`
- `bcast_winner_changes()`

**Notes:**
- Enable live dashboard updates without polling
- Low overhead (fires AFTER, doesn't block writes)
- Essential for real-time competition status
- ⚠️ Ensure Realtime is enabled on these tables in Supabase dashboard

---

### 4. Balance & Payment
**Purpose:** Manage user balances, process payments, award bonuses  
**Importance:** 🔴 Critical

| Trigger Name | Table | Events | Status | Purpose |
|-------------|-------|--------|--------|---------|
| `trg_auto_debit_on_balance_order` | `orders` | AFTER INSERT/UPDATE | ✅ Production | Auto-debit balance when order created |
| `trg_balance_ledger_sync_wallet` | `balance_ledger` | BEFORE INSERT/UPDATE | ✅ Production | Sync wallet address in ledger |
| `trg_provision_sub_account_balance` | `canonical_users` | AFTER INSERT | ✅ Production | Create sub-account balances for new users |
| `trg_init_sub_balance` | `canonical_users` | AFTER INSERT | ✅ Production | Initialize balance rows |
| `trg_award_first_topup_bonus` | `custody_transactions` | AFTER INSERT | ✅ Production | Award bonus on first deposit |
| `sub_account_balances_award_insert` | `sub_account_balances` | AFTER INSERT | ✅ Production | Track bonus awards |
| `sub_account_balances_award_update` | `sub_account_balances` | AFTER UPDATE | ✅ Production | Track bonus updates |
| `sync_balance_to_canonical_users` | `sub_account_balances` | AFTER UPDATE | ✅ Production | Sync balance to canonical_users |

**Functions Used:**
- `auto_debit_on_balance_order()`
- `balance_ledger_sync_wallet()`
- `provision_sub_account_balance()`
- `award_first_topup_bonus()`

**Notes:**
- ⚠️ **Mission Critical** - handles all payment processing
- Ensures atomicity of balance operations
- Prevents negative balances
- Must handle concurrent transactions safely

---

### 5. Ticket Management
**Purpose:** Handle ticket reservations, confirmations, and expiration  
**Importance:** 🔴 Critical

| Trigger Name | Table | Events | Status | Purpose |
|-------------|-------|--------|--------|---------|
| `trg_confirm_pending_tickets` | `pending_tickets` | AFTER UPDATE | ✅ Production | Convert pending → sold tickets |
| `trg_expire_hold_on_write` | `pending_ticket_items` | BEFORE INSERT/UPDATE | ✅ Production | Auto-expire held tickets |
| `trg_tickets_finalize_spend` | `tickets` | AFTER INSERT/UPDATE | ✅ Production | Finalize spending on ticket purchase |
| `trg_check_sold_out_on_ticket_insert` | `tickets` | AFTER INSERT | ✅ Production | Mark competition sold out |
| `trg_tickets_sync_joincompetition` | `tickets` | AFTER INSERT/UPDATE/DELETE | ✅ Production | Sync tickets to joincompetition |
| `trg_pending_sync_joincompetition` | `pending_tickets` | AFTER INSERT/UPDATE | ✅ Production | Sync pending tickets |
| `trg_pending_tickets_enforce_expiry_biu` | `pending_tickets` | BEFORE INSERT/UPDATE | ✅ Production | Enforce expiry rules |
| `check_reservation_expiry` | `pending_tickets` | BEFORE INSERT/UPDATE | ✅ Production | Check if reservation expired |

**Additional Ticket Triggers:**
- `trg_tickets_txid_fill` (tickets) - Auto-generate transaction IDs
- `trg_tickets_wallet_bi` (tickets) - Normalize wallet before insert

**Functions Used:**
- `confirm_pending_tickets()`
- `expire_hold_if_needed()`
- `finalize_ticket_spend()`
- `check_and_mark_competition_sold_out()`

**Notes:**
- ⚠️ **Core Business Logic** - handles ticket lifecycle
- Prevents double-booking
- Ensures fair ticket distribution
- Must handle race conditions

---

### 6. Canonical User ID
**Purpose:** Ensure all records have correct canonical_user_id references  
**Importance:** 🔴 Critical

| Trigger Name | Table | Events | Status | Purpose |
|-------------|-------|--------|--------|---------|
| `trg_tickets_set_cuid` | `tickets` | BEFORE INSERT/UPDATE | ✅ Production | Set canonical_user_id on tickets |
| `trg_joincompetition_set_cuid` | `joincompetition` | BEFORE INSERT/UPDATE | ✅ Production | Set canonical_user_id on entries |
| `trg_pending_tickets_set_cuid` | `pending_tickets` | BEFORE INSERT/UPDATE | ✅ Production | Set canonical_user_id on pending |
| `trg_user_transactions_set_cuid` | `user_transactions` | BEFORE INSERT/UPDATE | ✅ Production | Set canonical_user_id on transactions |
| `trg_sub_account_balances_sync_ids` | `sub_account_balances` | BEFORE INSERT/UPDATE | ✅ Production | Sync all identity columns |
| `tr_set_canonical_user_id` | `canonical_users` | BEFORE INSERT/UPDATE | ✅ Production | Ensure canonical_user_id set |

**Functions Used:**
- `_ticket_cuid()` - Derive canonical_user_id from identifiers
- `ensure_canonical_user()` - Get or create canonical user

**Notes:**
- ⚠️ **Critical for User Identity** - enables multi-wallet support
- Ensures data consistency across all user-related tables
- Required for accurate reporting and analytics
- Must be idempotent and handle NULL values

---

### 7. Transaction Processing
**Purpose:** Handle user transaction lifecycle and state management  
**Importance:** 🔴 Critical

| Trigger Name | Table | Events | Status | Purpose |
|-------------|-------|--------|--------|---------|
| `trg_orders_to_user_transactions` | `orders` | AFTER INSERT/UPDATE | ✅ Production | Create transaction from order |
| `trg_user_tx_before_insert` | `user_transactions` | BEFORE INSERT | ✅ Production | Validate transaction data |
| `trg_user_tx_autocomplete_bi` | `user_transactions` | BEFORE INSERT | ✅ Production | Auto-complete transaction fields |
| `trg_user_tx_autocomplete_bu` | `user_transactions` | BEFORE UPDATE | ✅ Production | Auto-complete on update |
| `trg_user_tx_post_ai` | `user_transactions` | AFTER INSERT | ✅ Production | Post-insert processing |
| `trg_user_tx_post_au` | `user_transactions` | AFTER UPDATE | ✅ Production | Post-update processing |
| `trg_user_tx_guard_bu` | `user_transactions` | BEFORE UPDATE | ✅ Production | Prevent invalid state changes |
| `trg_finalize_pending_user_transactions` | `user_transactions` | AFTER UPDATE | ✅ Production | Finalize completed transactions |
| `trg_user_transactions_post_to_wallet` | `user_transactions` | AFTER INSERT/UPDATE | ✅ Production | Update wallet balances |
| `trg_complete_topup_on_webhook_ref_ins` | `user_transactions` | AFTER INSERT | ✅ Production | Complete topup on webhook |
| `trg_complete_topup_on_webhook_ref_upd` | `user_transactions` | AFTER UPDATE | ✅ Production | Complete topup on webhook update |
| `trg_user_transactions_txid_fill` | `user_transactions` | BEFORE INSERT | ✅ Production | Generate transaction IDs |
| `trg_repair_topup_provider_and_status` | `user_transactions` | BEFORE INSERT/UPDATE | ✅ Production | Fix provider/status issues |
| `trg_sync_identity_user_tx` | `user_transactions` | BEFORE INSERT/UPDATE | ✅ Production | Sync identity columns |
| `trg_user_transactions_cdp_enqueue` | `user_transactions` | AFTER INSERT | ✅ Production | Enqueue CDP events |

**Functions Used:**
- `validate_user_transaction()`
- `autocomplete_transaction()`
- `finalize_pending_user_transactions()`
- `post_to_wallet()`
- `complete_topup_on_webhook_ref()`
- `enqueue_cdp_event()`

**Notes:**
- ⚠️ **Mission Critical** - manages all financial transactions
- State machine enforcement (pending → processing → completed)
- Prevents invalid state transitions
- Integrates with payment providers
- Ensures idempotency

---

### 8. Wallet Synchronization
**Purpose:** Keep wallet addresses synchronized across tables  
**Importance:** 🟡 Important

| Trigger Name | Table | Events | Status | Purpose |
|-------------|-------|--------|--------|---------|
| `trg_tickets_wallet_bi` | `tickets` | BEFORE INSERT | ✅ Production | Sync wallet on ticket insert |
| `trg_user_transactions_wallet_bi` | `user_transactions` | BEFORE INSERT | ✅ Production | Sync wallet on transaction |
| `trg_joincompetition_wallet_bi` | `joincompetition` | BEFORE INSERT | ✅ Production | Sync wallet on competition entry |
| `trg_winners_wallet_bi` | `winners` | BEFORE INSERT | ✅ Production | Sync wallet on winner record |
| `trg_balance_ledger_sync_wallet` | `balance_ledger` | BEFORE INSERT/UPDATE | ✅ Production | Sync wallet in ledger |

**Functions Used:**
- `sync_wallet_address()` - Lookup and set wallet from canonical_user_id

**Notes:**
- Ensures wallet address consistency
- Supports multi-wallet users
- Required for analytics and reporting
- Low overhead

---

### 9. Competition Sync
**Purpose:** Keep competition statistics updated in real-time  
**Importance:** 🟡 Important (UX)

| Trigger Name | Table | Events | Status | Purpose |
|-------------|-------|--------|--------|---------|
| `competitions_sync_num_winners_trg` | `competitions` | BEFORE INSERT/UPDATE | ✅ Production | Update winner count |
| `competitions_sync_tickets_sold_trg` | `competitions` | BEFORE INSERT/UPDATE | ✅ Production | Update tickets sold count |

**Functions Used:**
- `competitions_sync_num_winners()`
- `competitions_sync_tickets_sold()`

**Notes:**
- Keeps competition metadata fresh
- Prevents expensive COUNT queries
- Critical for UI display
- Must handle concurrent updates

---

### 10. Other Business Logic
**Purpose:** Miscellaneous business rules and integrations  
**Importance:** 🟡 Important

| Trigger Name | Table | Events | Status | Purpose |
|-------------|-------|--------|--------|---------|
| `trg_email_auth_sessions_verified` | `email_auth_sessions` | AFTER UPDATE | ✅ Production | Process verified email sessions |
| `trg_users_autolink_before_ins` | `users` | BEFORE INSERT | ✅ Production | Auto-link legacy user accounts |
| `trg_profiles_after_upsert` | `profiles` | AFTER INSERT/UPDATE | ✅ Production | Sync profile changes |

**Functions Used:**
- `process_verified_email_session()`
- `autolink_user_account()`
- `sync_profile_data()`

**Notes:**
- Support features like email verification
- Backward compatibility with legacy systems
- Profile synchronization

---

## Migration Status

### ✅ In Baseline Migration (`00000000000001_baseline_triggers.sql`)
- Timestamp management triggers (8 triggers)
- Reservation expiry trigger
- Helper functions documented

### 🔶 Production-Only (Not Yet in Migrations)
The following 43 triggers exist in production but are not yet in migration files:

**High Priority (Must Add):**
- All Balance & Payment triggers (7)
- All Canonical User ID triggers (6)
- All Transaction Processing triggers (15)
- All Ticket Management triggers (10)

**Medium Priority:**
- All Realtime Broadcast triggers (17)
- Wallet Synchronization triggers (5)
- Competition Sync triggers (2)

**Low Priority:**
- Other Business Logic triggers (7)

### 📋 Next Steps
1. Extract trigger function definitions from production
2. Add to new migration file: `00000000000002_production_triggers.sql`
3. Test in development environment
4. Deploy to production (idempotent - uses OR REPLACE)

---

## Best Practices

### Development Guidelines
1. **Always use `OR REPLACE`** for trigger functions to support idempotent migrations
2. **Use `DROP TRIGGER IF EXISTS`** before `CREATE TRIGGER` statements
3. **Test triggers in development** before production deployment
4. **Document purpose and dependencies** in migration comments
5. **Use consistent naming**: `trg_<action>_<table>` format

### Performance Considerations
1. **BEFORE vs AFTER triggers**:
   - Use BEFORE for data validation and normalization
   - Use AFTER for side effects (broadcasts, logging)
2. **Avoid expensive operations** in triggers (external API calls, complex queries)
3. **Consider batch operations** - triggers fire per row
4. **Index foreign keys** used in trigger functions
5. **Monitor trigger execution time** with `pg_stat_statements`

### Security Considerations
1. **Validate all inputs** in trigger functions
2. **Use SECURITY DEFINER cautiously** - prefer SECURITY INVOKER
3. **Audit sensitive operations** (balance changes, user modifications)
4. **Prevent infinite trigger loops** - check for actual changes
5. **Handle NULL values** explicitly

### Debugging Triggers
```sql
-- View all triggers on a table
SELECT tgname, tgtype, tgenabled 
FROM pg_trigger 
WHERE tgrelid = 'table_name'::regclass;

-- View trigger function definition
SELECT pg_get_functiondef(oid) 
FROM pg_proc 
WHERE proname = 'function_name';

-- Temporarily disable a trigger
ALTER TABLE table_name DISABLE TRIGGER trigger_name;

-- Re-enable a trigger
ALTER TABLE table_name ENABLE TRIGGER trigger_name;
```

---

## Related Documentation
- [Functions.md](./Functions.md) - Database function reference
- [Indexes.md](./Indexes.md) - Database index reference
- [BASELINE_MIGRATION_README.md](./BASELINE_MIGRATION_README.md) - Migration guide
- [SCHEMA_AUDIT_REPORT.md](./SCHEMA_AUDIT_REPORT.md) - Schema audit results

---

**Document Version:** 1.0  
**Maintainer:** Database Team  
**Last Audit:** January 31, 2026
