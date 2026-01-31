# Database Triggers Documentation

## Table of Contents

- [Overview](#overview)
- [Trigger Categories](#trigger-categories)
- [Implemented Triggers](#implemented-triggers)
- [Planned Triggers](#planned-triggers)
- [Trigger Functions Reference](#trigger-functions-reference)
- [Migration Status](#migration-status)

---

## Overview

This document catalogs all database triggers in the ThePrize.io Supabase schema. Triggers automate critical operations including timestamp updates, data normalization, synchronization, business logic enforcement, and real-time notifications.

**Total Triggers Identified:** 51 unique triggers  
**Currently Implemented:** 11 triggers (21.6%)  
**Pending Implementation:** 40 triggers (78.4%)

**Migration Files:**
- `00000000000001_baseline_triggers.sql` - Baseline trigger definitions and placeholders

---

## Trigger Categories

### 1. Timestamp Management (9 triggers)
Auto-update `updated_at` columns on row modifications

### 2. Data Normalization (5 triggers)
Ensure data consistency and format standardization

### 3. Wallet Synchronization (4 triggers)
Maintain wallet address consistency across tables

### 4. Balance & Payment Operations (6 triggers)
Handle balance operations, payments, and ledger synchronization

### 5. Ticket Allocation (4 triggers)
Manage ticket reservations, allocations, and sold-out status

### 6. Canonical User ID Management (5 triggers)
Ensure canonical_user_id is properly set and synchronized

### 7. Transaction Management (7 triggers)
Handle user transactions, auto-completion, and validation

### 8. Webhook Integration (3 triggers)
CDP event queueing and payment webhook processing

### 9. Bonus & Rewards (3 triggers)
Award bonuses and rewards based on triggers

### 10. Real-time Notifications (2 triggers)
Supabase Realtime broadcasts for live updates

### 11. Competition Synchronization (2 triggers)
Keep competition aggregates in sync

### 12. Miscellaneous Utility (3 triggers)
Various helper triggers

---

## Implemented Triggers

### ✅ Timestamp Update Triggers

#### `update_user_transactions_updated_at`
**Table:** `user_transactions`  
**Event:** BEFORE UPDATE  
**Function:** `update_updated_at_column()`  
**Purpose:** Auto-update `updated_at` timestamp on row updates

```sql
CREATE TRIGGER update_user_transactions_updated_at
  BEFORE UPDATE ON user_transactions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

**Status:** ✅ Implemented  
**Migration:** `00000000000001_baseline_triggers.sql`

---

#### `update_pending_tickets_updated_at`
**Table:** `pending_tickets`  
**Event:** BEFORE UPDATE  
**Function:** `update_updated_at_column()`  
**Purpose:** Auto-update `updated_at` timestamp on pending ticket updates

```sql
CREATE TRIGGER update_pending_tickets_updated_at
  BEFORE UPDATE ON pending_tickets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

**Status:** ✅ Implemented

---

#### `update_sub_account_balances_updated_at`
**Table:** `sub_account_balances`  
**Event:** BEFORE UPDATE  
**Function:** `update_updated_at_column()`  
**Purpose:** Auto-update `updated_at` timestamp on balance updates

```sql
CREATE TRIGGER update_sub_account_balances_updated_at
  BEFORE UPDATE ON sub_account_balances
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

**Status:** ✅ Implemented

---

#### `update_canonical_users_updated_at`
**Table:** `canonical_users`  
**Event:** BEFORE UPDATE  
**Function:** `update_updated_at_column()`  
**Purpose:** Auto-update `updated_at` timestamp on user profile updates

```sql
CREATE TRIGGER update_canonical_users_updated_at
  BEFORE UPDATE ON canonical_users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

**Status:** ✅ Implemented

---

#### `update_users_updated_at`
**Table:** `users`  
**Event:** BEFORE UPDATE  
**Function:** `update_updated_at_column()`  
**Purpose:** Auto-update `updated_at` timestamp on legacy users table

```sql
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

**Status:** ✅ Implemented

---

#### `update_profiles_updated_at`
**Table:** `profiles`  
**Event:** BEFORE UPDATE  
**Function:** `update_updated_at_column()`  
**Purpose:** Auto-update `updated_at` timestamp on profile updates

```sql
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

**Status:** ✅ Implemented

---

#### `update_orders_updated_at`
**Table:** `orders`  
**Event:** BEFORE UPDATE  
**Function:** `update_updated_at_column()`  
**Purpose:** Auto-update `updated_at` timestamp on order updates

```sql
CREATE TRIGGER update_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

**Status:** ✅ Implemented

---

#### `update_competitions_updated_at`
**Table:** `competitions`  
**Event:** BEFORE UPDATE  
**Function:** `update_updated_at_column()`  
**Purpose:** Auto-update `updated_at` timestamp on competition updates

```sql
CREATE TRIGGER update_competitions_updated_at
  BEFORE UPDATE ON competitions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

**Status:** ✅ Implemented

---

### ✅ Reservation Management Triggers

#### `check_reservation_expiry`
**Table:** `pending_tickets`  
**Event:** BEFORE INSERT OR UPDATE  
**Function:** `auto_expire_reservations()`  
**Purpose:** Auto-expire pending ticket reservations if past `expires_at`

```sql
CREATE TRIGGER check_reservation_expiry
  BEFORE INSERT OR UPDATE ON pending_tickets
  FOR EACH ROW
  EXECUTE FUNCTION auto_expire_reservations();
```

**Logic:**
- Checks if `expires_at < NOW()` and `status = 'pending'`
- Automatically sets `status = 'expired'`
- Prevents expired reservations from being inserted/updated as pending

**Status:** ✅ Implemented  
**Migration:** `00000000000001_baseline_triggers.sql`

---

## Planned Triggers

The following 40 triggers exist in the production database but need to be extracted and implemented in migrations:

### 🔄 Data Normalization Triggers

#### `canonical_users_normalize`
**Table:** `canonical_users`  
**Event:** BEFORE INSERT OR UPDATE  
**Purpose:** Normalize canonical user data (lowercase emails, format wallet addresses)

**Status:** 📋 Planned  
**Priority:** High  
**Implementation Required:**
1. Extract function definition from production
2. Add to migration file
3. Test normalization logic

---

#### `canonical_users_normalize_before_write`
**Table:** `canonical_users`  
**Event:** BEFORE INSERT OR UPDATE  
**Purpose:** Additional normalization before write operations

**Status:** 📋 Planned  
**Priority:** High

---

#### `cu_normalize_and_enforce`
**Table:** `canonical_users`  
**Event:** BEFORE INSERT OR UPDATE  
**Purpose:** Normalize and enforce business rules on canonical users

**Status:** 📋 Planned  
**Priority:** High

---

#### `users_normalize_before_write`
**Table:** `users`  
**Event:** BEFORE INSERT OR UPDATE  
**Purpose:** Normalize legacy users table data

**Status:** 📋 Planned  
**Priority:** Medium

---

#### `normalize_sub_account_currency`
**Table:** `sub_account_balances`  
**Event:** BEFORE INSERT OR UPDATE  
**Purpose:** Normalize currency codes (uppercase, validate)

**Status:** 📋 Planned  
**Priority:** Medium

---

### 🔄 Wallet Synchronization Triggers

#### `tickets_sync_wallet`
**Table:** `tickets`  
**Event:** BEFORE INSERT OR UPDATE  
**Purpose:** Sync wallet address from canonical_users to tickets

**Status:** 📋 Planned  
**Priority:** High  
**Business Logic:** Ensures tickets.wallet_address matches canonical_users.wallet_address

---

#### `user_transactions_sync_wallet`
**Table:** `user_transactions`  
**Event:** BEFORE INSERT OR UPDATE  
**Purpose:** Sync wallet address from canonical_users to transactions

**Status:** 📋 Planned  
**Priority:** High

---

#### `winners_sync_wallet`
**Table:** `winners`  
**Event:** BEFORE INSERT OR UPDATE  
**Purpose:** Sync wallet address from canonical_users to winners

**Status:** 📋 Planned  
**Priority:** High

---

#### `joincompetition_sync_wallet`
**Table:** `joincompetition`  
**Event:** BEFORE INSERT OR UPDATE  
**Purpose:** Sync wallet address to joincompetition entries

**Status:** 📋 Planned  
**Priority:** High

---

### 🔄 Real-time Broadcast Triggers

#### `bcast_ticket_changes`
**Table:** `tickets`  
**Event:** AFTER INSERT OR UPDATE OR DELETE  
**Purpose:** Broadcast ticket changes to Supabase Realtime subscribers

**Status:** 📋 Planned  
**Priority:** High  
**Used By:** Live ticket availability updates on frontend

**Implementation:**
```sql
-- Example structure (needs production definition)
CREATE OR REPLACE FUNCTION bcast_ticket_changes()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('ticket_changes', json_build_object(
    'competition_id', NEW.competition_id,
    'ticket_number', NEW.ticket_number,
    'status', NEW.status
  )::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

---

#### `bcast_winner_changes`
**Table:** `winners`  
**Event:** AFTER INSERT OR UPDATE  
**Purpose:** Broadcast winner announcements to Realtime subscribers

**Status:** 📋 Planned  
**Priority:** High  
**Used By:** Live winner notifications

---

### 🔄 Synchronization Triggers

#### `trg_sync_joincompetition_from_tickets`
**Table:** `tickets`  
**Event:** AFTER INSERT OR UPDATE  
**Purpose:** Sync joincompetition aggregates when tickets change

**Status:** 📋 Planned  
**Priority:** High  
**Business Logic:**
- Updates joincompetition.ticketcount
- Updates joincompetition.amountspent
- Maintains data consistency between tickets and joincompetition

---

#### `trg_sync_joincompetition_from_pending`
**Table:** `pending_tickets`  
**Event:** AFTER INSERT OR UPDATE OR DELETE  
**Purpose:** Sync joincompetition when pending tickets change

**Status:** 📋 Planned  
**Priority:** Medium

---

#### `sync_identity_columns`
**Table:** Multiple (canonical_users, users, profiles)  
**Event:** AFTER INSERT OR UPDATE  
**Purpose:** Keep identity columns synchronized across tables

**Status:** 📋 Planned  
**Priority:** Medium

---

#### `sync_competition_status_if_ended`
**Table:** `competitions`  
**Event:** AFTER UPDATE  
**Purpose:** Auto-update competition status when end_time reached

**Status:** 📋 Planned  
**Priority:** Medium  
**Note:** Function exists, trigger needs implementation

---

### 🔄 Balance & Payment Triggers

#### `trg_provision_sub_account_balance`
**Table:** `canonical_users`  
**Event:** AFTER INSERT  
**Purpose:** Auto-create sub_account_balance record for new users

**Status:** 📋 Planned  
**Priority:** High  
**Business Logic:**
- Creates initial USD balance record with 0.00
- Ensures every user has a balance entry

---

#### `trg_auto_debit_on_balance_order`
**Table:** `orders`  
**Event:** AFTER INSERT  
**Purpose:** Auto-debit balance when order is created with balance payment

**Status:** 📋 Planned  
**Priority:** High  
**Note:** May be deprecated by simplified_balance_payment

---

#### `trg_finalize_pending_user_transactions`
**Table:** `user_transactions`  
**Event:** AFTER UPDATE  
**Purpose:** Finalize pending transactions when payment confirmed

**Status:** 📋 Planned  
**Priority:** High

---

#### `trg_user_transactions_post_to_wallet`
**Table:** `user_transactions`  
**Event:** AFTER INSERT OR UPDATE  
**Purpose:** Post completed transactions to wallet/balance

**Status:** 📋 Planned  
**Priority:** High

---

#### `trg_balance_ledger_sync_wallet`
**Table:** `balance_ledger`  
**Event:** BEFORE INSERT OR UPDATE  
**Purpose:** Sync wallet address in balance ledger entries

**Status:** 📋 Planned  
**Priority:** Medium

---

### 🔄 Ticket Allocation Triggers

#### `trg_confirm_pending_tickets`
**Table:** `pending_tickets`  
**Event:** AFTER UPDATE  
**Purpose:** Confirm pending tickets when payment completes

**Status:** 📋 Planned  
**Priority:** High  
**Business Logic:**
- Moves tickets from pending_tickets to tickets
- Updates status to 'sold'
- Creates joincompetition entry

---

#### `trg_tickets_finalize_spend`
**Table:** `tickets`  
**Event:** AFTER INSERT  
**Purpose:** Finalize spend tracking when tickets are created

**Status:** 📋 Planned  
**Priority:** Medium

---

#### `trg_check_sold_out_on_ticket_insert`
**Table:** `tickets`  
**Event:** AFTER INSERT  
**Purpose:** Check if competition is sold out after ticket insert

**Status:** 📋 Planned  
**Priority:** High  
**Business Logic:**
- Counts total sold tickets
- Compares to competition.total_tickets
- Updates competition.status to 'sold_out' if full

---

#### `trg_expire_hold_on_write`
**Table:** `pending_tickets`  
**Event:** BEFORE UPDATE  
**Purpose:** Expire holds that are past expiry time

**Status:** 📋 Planned  
**Priority:** Medium  
**Note:** Similar to `auto_expire_reservations` - may consolidate

---

### 🔄 Canonical User ID Triggers

#### `trg_tickets_set_cuid`
**Table:** `tickets`  
**Event:** BEFORE INSERT OR UPDATE  
**Purpose:** Set canonical_user_id based on user_id

**Status:** 📋 Planned  
**Priority:** High

---

#### `trg_joincompetition_set_cuid`
**Table:** `joincompetition`  
**Event:** BEFORE INSERT OR UPDATE  
**Purpose:** Set canonical_user_id for competition entries

**Status:** 📋 Planned  
**Priority:** High

---

#### `trg_pending_tickets_set_cuid`
**Table:** `pending_tickets`  
**Event:** BEFORE INSERT OR UPDATE  
**Purpose:** Set canonical_user_id for pending tickets

**Status:** 📋 Planned  
**Priority:** High

---

#### `trg_user_transactions_set_cuid`
**Table:** `user_transactions`  
**Event:** BEFORE INSERT OR UPDATE  
**Purpose:** Set canonical_user_id for transactions

**Status:** 📋 Planned  
**Priority:** High

---

#### `trg_sub_account_balances_sync_ids`
**Table:** `sub_account_balances`  
**Event:** BEFORE INSERT OR UPDATE  
**Purpose:** Sync user IDs with canonical_user_id

**Status:** 📋 Planned  
**Priority:** High

---

### 🔄 Transaction Management Triggers

#### `trg_orders_to_user_transactions`
**Table:** `orders`  
**Event:** AFTER INSERT  
**Purpose:** Create user_transaction record from order

**Status:** 📋 Planned  
**Priority:** High

---

#### `trg_user_tx_before_insert`
**Table:** `user_transactions`  
**Event:** BEFORE INSERT  
**Purpose:** Validate and prepare transaction before insert

**Status:** 📋 Planned  
**Priority:** High

---

#### `trg_user_tx_autocomplete_bi`
**Table:** `user_transactions`  
**Event:** BEFORE INSERT  
**Purpose:** Auto-complete transaction fields on insert

**Status:** 📋 Planned  
**Priority:** Medium

---

#### `trg_user_tx_autocomplete_bu`
**Table:** `user_transactions`  
**Event:** BEFORE UPDATE  
**Purpose:** Auto-complete transaction fields on update

**Status:** 📋 Planned  
**Priority:** Medium

---

#### `trg_user_tx_post_ai`
**Table:** `user_transactions`  
**Event:** AFTER INSERT  
**Purpose:** Post-processing after transaction insert

**Status:** 📋 Planned  
**Priority:** Medium

---

#### `trg_user_tx_post_au`
**Table:** `user_transactions`  
**Event:** AFTER UPDATE  
**Purpose:** Post-processing after transaction update

**Status:** 📋 Planned  
**Priority:** Medium

---

#### `trg_user_tx_guard_bu`
**Table:** `user_transactions`  
**Event:** BEFORE UPDATE  
**Purpose:** Guard against invalid transaction updates

**Status:** 📋 Planned  
**Priority:** High

---

### 🔄 Webhook Integration Triggers

#### `trg_user_transactions_cdp_enqueue`
**Table:** `user_transactions`  
**Event:** AFTER INSERT OR UPDATE  
**Purpose:** Enqueue CDP (Customer Data Platform) events

**Status:** 📋 Planned  
**Priority:** Medium  
**Used By:** Analytics and marketing automation

---

#### `trg_complete_topup_on_webhook_ref_ins`
**Table:** `payment_webhook_events`  
**Event:** AFTER INSERT  
**Purpose:** Complete top-up when webhook reference inserted

**Status:** 📋 Planned  
**Priority:** High  
**Used By:** Stripe/payment webhook processing

---

#### `trg_complete_topup_on_webhook_ref_upd`
**Table:** `payment_webhook_events`  
**Event:** AFTER UPDATE  
**Purpose:** Complete top-up when webhook reference updated

**Status:** 📋 Planned  
**Priority:** High

---

### 🔄 Bonus & Reward Triggers

#### `trg_award_first_topup_bonus`
**Table:** `user_transactions`  
**Event:** AFTER INSERT  
**Purpose:** Award 20% bonus on first top-up

**Status:** 📋 Planned  
**Priority:** High  
**Business Logic:**
- Checks if user has used first deposit bonus
- Awards 20% to bonus_balance
- Logs in bonus_award_audit
- Marks bonus as used

**Note:** Function `credit_balance_with_first_deposit_bonus` exists

---

#### `sub_account_balances_award_insert`
**Table:** `sub_account_balances`  
**Event:** AFTER INSERT  
**Purpose:** Award bonuses on balance creation

**Status:** 📋 Planned  
**Priority:** Medium

---

#### `sub_account_balances_award_update`
**Table:** `sub_account_balances`  
**Event:** AFTER UPDATE  
**Purpose:** Award bonuses on balance updates

**Status:** 📋 Planned  
**Priority:** Medium

---

### 🔄 Miscellaneous Utility Triggers

#### `trg_user_transactions_txid_fill`
**Table:** `user_transactions`  
**Event:** BEFORE INSERT  
**Purpose:** Auto-generate transaction ID if not provided

**Status:** 📋 Planned  
**Priority:** Medium

---

#### `trg_tickets_txid_fill`
**Table:** `tickets`  
**Event:** BEFORE INSERT  
**Purpose:** Auto-generate transaction ID for tickets

**Status:** 📋 Planned  
**Priority:** Medium

---

#### `trg_repair_topup_provider_and_status`
**Table:** `user_transactions`  
**Event:** BEFORE INSERT OR UPDATE  
**Purpose:** Repair inconsistent provider and status values

**Status:** 📋 Planned  
**Priority:** Low

---

#### `trg_email_auth_sessions_verified`
**Table:** `email_auth_sessions`  
**Event:** AFTER UPDATE  
**Purpose:** Handle post-verification actions

**Status:** 📋 Planned  
**Priority:** Medium

---

#### `trg_users_autolink_before_ins`
**Table:** `users`  
**Event:** BEFORE INSERT  
**Purpose:** Auto-link users to canonical_users

**Status:** 📋 Planned  
**Priority:** Medium

---

#### `trg_init_sub_balance`
**Table:** `canonical_users`  
**Event:** AFTER INSERT  
**Purpose:** Initialize sub_account_balance for new users

**Status:** 📋 Planned  
**Priority:** High  
**Note:** May be same as `trg_provision_sub_account_balance`

---

### 🔄 Competition Synchronization Triggers

#### `competitions_sync_num_winners_trg`
**Table:** `winners`  
**Event:** AFTER INSERT OR DELETE  
**Purpose:** Keep competitions.num_winners count synchronized

**Status:** 📋 Planned  
**Priority:** Medium

---

#### `competitions_sync_tickets_sold_trg`
**Table:** `tickets`  
**Event:** AFTER INSERT OR DELETE  
**Purpose:** Keep competitions.tickets_sold count synchronized

**Status:** 📋 Planned  
**Priority:** High  
**Business Logic:**
- Count tickets with status='sold'
- Update competitions.tickets_sold
- Check if sold_out condition met

---

## Trigger Functions Reference

### Implemented Functions

#### `update_updated_at_column()`
**Returns:** TRIGGER  
**Purpose:** Sets NEW.updated_at = NOW()

```sql
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

**Used By:** 8 timestamp update triggers  
**Status:** ✅ Implemented

---

#### `auto_expire_reservations()`
**Returns:** TRIGGER  
**Purpose:** Auto-expire pending reservations past expiry time

```sql
CREATE OR REPLACE FUNCTION auto_expire_reservations()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.expires_at IS NOT NULL 
     AND NEW.expires_at < NOW() 
     AND NEW.status = 'pending' THEN
    NEW.status := 'expired';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

**Used By:** `check_reservation_expiry` trigger  
**Status:** ✅ Implemented

---

### Planned Functions

The following 40+ trigger functions need to be extracted from production and implemented:

**Normalization Functions:**
- `canonical_users_normalize()`
- `canonical_users_normalize_before_write()`
- `cu_normalize_and_enforce()`
- `users_normalize_before_write()`
- `normalize_sub_account_currency()`

**Wallet Sync Functions:**
- `tickets_sync_wallet()`
- `user_transactions_sync_wallet()`
- `winners_sync_wallet()`
- `joincompetition_sync_wallet()`

**Broadcast Functions:**
- `bcast_ticket_changes()`
- `bcast_winner_changes()`

**Sync Functions:**
- `trg_sync_joincompetition_from_tickets_fn()`
- `trg_sync_joincompetition_from_pending_fn()`
- `sync_identity_columns_fn()`

**Balance Functions:**
- `trg_provision_sub_account_balance_fn()`
- `trg_auto_debit_on_balance_order_fn()`
- `trg_finalize_pending_user_transactions_fn()`
- `trg_user_transactions_post_to_wallet_fn()`
- `trg_balance_ledger_sync_wallet_fn()`

**Ticket Functions:**
- `trg_confirm_pending_tickets_fn()`
- `trg_tickets_finalize_spend_fn()`
- `trg_check_sold_out_on_ticket_insert_fn()`
- `trg_expire_hold_on_write_fn()`

**Canonical ID Functions:**
- `trg_tickets_set_cuid_fn()`
- `trg_joincompetition_set_cuid_fn()`
- `trg_pending_tickets_set_cuid_fn()`
- `trg_user_transactions_set_cuid_fn()`
- `trg_sub_account_balances_sync_ids_fn()`

**Transaction Functions:**
- `trg_orders_to_user_transactions_fn()`
- `trg_user_tx_before_insert_fn()`
- `trg_user_tx_autocomplete_bi_fn()`
- `trg_user_tx_autocomplete_bu_fn()`
- `trg_user_tx_post_ai_fn()`
- `trg_user_tx_post_au_fn()`
- `trg_user_tx_guard_bu_fn()`

**Webhook Functions:**
- `trg_user_transactions_cdp_enqueue_fn()`
- `trg_complete_topup_on_webhook_ref_ins_fn()`
- `trg_complete_topup_on_webhook_ref_upd_fn()`

**Bonus Functions:**
- `trg_award_first_topup_bonus_fn()`
- `sub_account_balances_award_insert_fn()`
- `sub_account_balances_award_update_fn()`

---

## Migration Status

### Completed Migrations

| Migration | Date | Triggers Added | Status |
|-----------|------|----------------|--------|
| `00000000000001_baseline_triggers.sql` | 2026-01-27 | 11 triggers | ✅ Complete |

### Pending Migrations

| Priority | Trigger Category | Count | Target Date |
|----------|-----------------|-------|-------------|
| 🔴 High | Wallet Synchronization | 4 | TBD |
| 🔴 High | Canonical User ID | 5 | TBD |
| 🔴 High | Balance & Payment | 6 | TBD |
| 🔴 High | Ticket Allocation | 4 | TBD |
| 🟡 Medium | Data Normalization | 5 | TBD |
| 🟡 Medium | Synchronization | 4 | TBD |
| 🟢 Low | Utility | 12 | TBD |

---

## Implementation Roadmap

### Phase 1: Critical Business Logic (High Priority)
**Target:** Q1 2026  
**Triggers:** 19 triggers

1. Wallet synchronization (4)
2. Canonical user ID management (5)
3. Balance & payment operations (6)
4. Ticket allocation (4)

### Phase 2: Data Consistency (Medium Priority)
**Target:** Q2 2026  
**Triggers:** 9 triggers

1. Data normalization (5)
2. Cross-table synchronization (4)

### Phase 3: Enhanced Features (Low Priority)
**Target:** Q2-Q3 2026  
**Triggers:** 12 triggers

1. Real-time broadcasts (2)
2. Webhook integration (3)
3. Bonus & rewards (3)
4. Utility functions (4)

---

## Extraction Process

To extract trigger definitions from production:

### Step 1: List All Triggers
```sql
SELECT 
  t.tgname AS trigger_name,
  c.relname AS table_name,
  p.proname AS function_name
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_proc p ON t.tgfoid = p.oid
WHERE NOT t.tgisinternal
  AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
ORDER BY c.relname, t.tgname;
```

### Step 2: Get Function Definition
```sql
SELECT pg_get_functiondef(oid) 
FROM pg_proc 
WHERE proname = 'function_name';
```

### Step 3: Get Trigger Definition
```sql
SELECT pg_get_triggerdef(oid, true)
FROM pg_trigger
WHERE tgname = 'trigger_name';
```

### Step 4: Create Migration
1. Add function definition with `CREATE OR REPLACE FUNCTION`
2. Add `DROP TRIGGER IF EXISTS` statement
3. Add `CREATE TRIGGER` statement
4. Test in development environment
5. Apply to production

---

## Testing Triggers

### Test Timestamp Triggers
```sql
-- Test updated_at trigger
UPDATE canonical_users 
SET username = 'newname' 
WHERE canonical_user_id = 'prize:pid:0x...';

-- Verify updated_at changed
SELECT updated_at FROM canonical_users 
WHERE canonical_user_id = 'prize:pid:0x...';
```

### Test Reservation Expiry
```sql
-- Create expired reservation
INSERT INTO pending_tickets (
  user_id,
  competition_id,
  ticket_numbers,
  expires_at,
  status
) VALUES (
  'user-id',
  'comp-id',
  ARRAY[1,2,3],
  NOW() - INTERVAL '1 hour',
  'pending'
);

-- Verify status is 'expired'
SELECT status FROM pending_tickets WHERE id = ...;
```

---

## Verification Queries

### Count All Triggers
```sql
SELECT COUNT(*) 
FROM pg_trigger 
WHERE NOT tgisinternal 
  AND tgrelid IN (
    SELECT oid FROM pg_class 
    WHERE relnamespace = (
      SELECT oid FROM pg_namespace WHERE nspname = 'public'
    )
  );
```

### List Triggers by Table
```sql
SELECT 
  c.relname AS table_name,
  t.tgname AS trigger_name,
  t.tgenabled AS enabled
FROM pg_trigger t 
JOIN pg_class c ON t.tgrelid = c.oid 
WHERE NOT t.tgisinternal 
  AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
ORDER BY c.relname, t.tgname;
```

### Check Trigger Function Exists
```sql
SELECT proname, prosrc 
FROM pg_proc 
WHERE proname LIKE '%trigger%' 
  AND prokind = 'f';
```

---

## Best Practices

### Trigger Design
1. **Keep Triggers Simple** - Complex logic should be in functions
2. **Avoid Cascading Triggers** - Prevent infinite loops
3. **Use BEFORE for Validation** - Modify NEW before insert/update
4. **Use AFTER for Side Effects** - Create related records, send notifications
5. **Handle NULL Values** - Always check for NULL in conditions
6. **Document Business Logic** - Comment why trigger exists

### Performance
1. **Minimize Trigger Work** - Only do essential operations
2. **Avoid Expensive Queries** - Use indexes, limit subqueries
3. **Batch Operations** - Use AFTER STATEMENT triggers for bulk operations
4. **Profile Trigger Performance** - Use EXPLAIN ANALYZE

### Security
1. **SECURITY DEFINER Functions** - Set proper permissions
2. **Validate Inputs** - Don't trust NEW values
3. **Audit Sensitive Operations** - Log to audit tables
4. **Row-Level Security** - Triggers respect RLS policies

---

## Dependencies

### Trigger Dependencies
- Triggers depend on their functions existing first
- Functions must be created with `CREATE OR REPLACE` before triggers
- Dropping a function will fail if triggers depend on it

### Table Dependencies
- Some triggers depend on related tables existing
- Foreign key constraints must exist before sync triggers
- Indexes should exist on commonly-queried columns

---

## Troubleshooting

### Trigger Not Firing
1. Check trigger is enabled: `SELECT tgenabled FROM pg_trigger WHERE tgname = 'trigger_name';`
2. Verify function exists: `SELECT proname FROM pg_proc WHERE proname = 'function_name';`
3. Check event matches: BEFORE vs AFTER, INSERT vs UPDATE vs DELETE
4. Test function independently with test data

### Infinite Loop
1. Identify circular trigger dependencies
2. Add guard conditions to prevent recursion
3. Use trigger depth tracking: `pg_trigger_depth()`
4. Disable problematic trigger temporarily

### Performance Issues
1. Check trigger execution time in logs
2. Profile trigger function with EXPLAIN ANALYZE
3. Add indexes on frequently-accessed columns
4. Consider async processing for heavy operations

---

**Last Updated:** 2026-01-30  
**Schema Version:** 1.5  
**Implemented Triggers:** 11 / 51 (21.6%)  
**Next Migration:** TBD
