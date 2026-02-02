# Production Schema Reference

**Source:** `Substage Schema, functions, triggers & indexes.md` (15,995 lines)
**Last Updated:** 2026-02-02

## Critical Tables

### user_transactions (Lines 705-745)
**37 columns total** - Used for all transaction history, orders tab, top-ups

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| user_id | text | Legacy identifier |
| canonical_user_id | text | Current user identifier format: `prize:pid:0x...` |
| wallet_address | text | User's wallet |
| type | text | Transaction type (top_up, purchase, etc) |
| amount | numeric | Transaction amount |
| currency | text | Default 'USDC' |
| balance_before | numeric | Balance before transaction |
| balance_after | numeric | Balance after transaction |
| competition_id | uuid | FK to competitions |
| order_id | uuid | Order reference |
| description | text | Human readable description |
| status | text | Default 'completed' |
| created_at | timestamptz | When created |
| user_privy_id | text | Privy ID |
| metadata | jsonb | Additional data |
| provider | text | **GENERATED from metadata** |
| tx_ref | text | **GENERATED from metadata** |
| payment_provider | text | Payment provider used |
| payment_status | text | Payment status |
| ticket_count | integer | Number of tickets |
| webhook_ref | text | Webhook reference (UNIQUE) |
| charge_id | text | Charge ID (UNIQUE) |
| charge_code | text | Charge code |
| checkout_url | text | Checkout URL |
| updated_at | timestamptz | When updated |
| primary_provider | text | Primary payment provider |
| fallback_provider | text | Fallback provider |
| provider_attempts | integer | Number of attempts (default 0) |
| provider_error | text | Error message |
| posted_to_balance | boolean | Posted to balance (default false) |
| completed_at | timestamptz | When completed |
| expires_at | timestamptz | When expires |
| method | text | Payment method |
| tx_id | text | **Transaction hash/ID** |
| network | text | Network used |
| notes | text | Additional notes |

**CRITICAL:**
- ❌ `ticket_numbers` does NOT exist
- ❌ `transaction_hash` does NOT exist
- ✅ Use `tx_id` for transaction hash
- ✅ Use `ticket_count` for number of tickets

### competition_entries (Lines 129-146)
**14 columns** - Aggregated user entries per competition

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| canonical_user_id | text | User identifier (NOT NULL) |
| competition_id | uuid | FK to competitions (NOT NULL) |
| wallet_address | text | User's wallet |
| tickets_count | integer | Total tickets (NOT NULL, default 0) |
| ticket_numbers_csv | text | CSV of ticket numbers |
| amount_spent | numeric | Total spent on this competition |
| payment_methods | text | Payment methods used |
| latest_purchase_at | timestamptz | Most recent purchase time |
| is_winner | boolean | Whether user won |
| prize_tiers | text | Prize tiers won |
| created_at | timestamptz | NOT NULL |
| updated_at | timestamptz | NOT NULL |
| username | text | User's username |

**CRITICAL:**
- ✅ `tickets_count` (plural) is correct
- ❌ `ticket_count` (singular) does NOT exist in this table

### sub_account_balances (Lines 635-647)
**10 columns** - User balance tracking

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| user_id | text | Legacy ID |
| currency | text | Currency type |
| available_balance | numeric | Available balance |
| pending_balance | numeric | Pending balance |
| last_updated | timestamptz | Last update time |
| canonical_user_id | text | Current user ID |
| privy_user_id | text | Privy ID |
| wallet_address | text | Wallet address |
| canonical_user_id_norm | text | Normalized ID |

### canonical_users (Lines 93-120)
**25 columns** - Main user table

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| canonical_user_id | text | UNIQUE format: `prize:pid:0x[40 hex]` or `prize:pid:temp[N]` |
| uid | text | UNIQUE, auto-generated |
| privy_user_id | text | Privy ID |
| email | text | UNIQUE |
| wallet_address | text | UNIQUE |
| base_wallet_address | text | UNIQUE |
| eth_wallet_address | text | UNIQUE |
| username | text | Display name |
| avatar_url | text | Avatar image |
| usdc_balance | numeric | USDC balance (default 0) |
| bonus_balance | numeric | Bonus balance (default 0) |
| has_used_new_user_bonus | boolean | First deposit bonus used (default false) |
| created_at | timestamptz | NOT NULL |
| updated_at | timestamptz | NOT NULL |
| smart_wallet_address | text | Smart wallet |
| country | text | User country |
| first_name | text | First name |
| last_name | text | Last name |
| telegram_handle | text | Telegram |
| is_admin | boolean | Admin flag (default false) |
| auth_provider | text | Auth provider |
| wallet_linked | text | Wallet link status |
| linked_wallets | jsonb | Array of linked wallets (default []) |
| primary_wallet_address | text | Primary wallet |

## Critical RPC Functions

### _get_user_competition_entries_unified
**Signature:** `public._get_user_competition_entries_unified(p_user_identifier text)`
**Returns:** 24-column record
**Purpose:** Gets all user entries unified across tables

**Parameter Name:** `p_user_identifier` (with p_ prefix!)

### apply_wallet_mutation
**Signature:** `public.apply_wallet_mutation(p_canonical_user_id text, p_currency text, p_amount numeric, p_reference_id text DEFAULT NULL, p_description text DEFAULT NULL, p_top_up_tx_id text DEFAULT NULL)`
**Returns:** Record with ledger_id, canonical_user_id, currency, amount, balance_before, balance_after, available_balance, top_up_tx_id
**Purpose:** Apply balance change with ledger entry

**Parameter Names:** All start with `p_` prefix!

### award_first_topup_bonus
**Signature:** `public.award_first_topup_bonus(p_canonical_user_id text, p_topup_amount numeric, p_bonus_amount numeric, p_currency text DEFAULT 'USDC', p_provider text DEFAULT 'topup', p_tx_ref text DEFAULT NULL)`
**Returns:** Record with balance_before, balance_after, bonus_applied, bonus_amount
**Purpose:** Award first deposit bonus

**Parameter Names:** All start with `p_` prefix!

## Critical Notes

1. **Parameter Naming Convention:**
   - Production functions use `p_` prefix: `p_user_identifier`, `p_canonical_user_id`
   - Do NOT use: `user_identifier`, `canonical_user_id` (without prefix)

2. **Column Naming:**
   - user_transactions: `tx_id` NOT `transaction_hash`
   - user_transactions: `ticket_count` NOT `ticket_numbers`
   - competition_entries: `tickets_count` NOT `ticket_count`

3. **Type Casing:**
   - PostgreSQL treats `TEXT` and `text` as same type
   - But function signatures must match EXACTLY
   - Production uses lowercase: `text`, `numeric`, `uuid`

4. **Generated Columns:**
   - user_transactions.provider (from metadata)
   - user_transactions.tx_ref (from metadata)
   - These are computed, not stored

5. **Balance Tables:**
   - canonical_users.usdc_balance - legacy/cache
   - sub_account_balances.available_balance - current source of truth
   - Both should be kept in sync

## Common Mistakes to Avoid

❌ **Wrong:** `transaction_hash` column
✅ **Right:** `tx_id` column

❌ **Wrong:** `ticket_numbers` column  
✅ **Right:** `ticket_count` column (user_transactions) or `tickets_count` (competition_entries)

❌ **Wrong:** `user_identifier text` parameter
✅ **Right:** `p_user_identifier text` parameter

❌ **Wrong:** Assuming columns exist without checking
✅ **Right:** Always verify against this document first

❌ **Wrong:** Creating function with different parameter name than production
✅ **Right:** Match production signature EXACTLY
