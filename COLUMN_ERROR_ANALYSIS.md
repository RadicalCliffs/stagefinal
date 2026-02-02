# COMPREHENSIVE COLUMN ERROR ANALYSIS

## Production user_transactions Table - ACTUAL Columns

Based on "Substage Schema, functions, triggers & indexes.md" lines 705-745:

```
id uuid
user_id text
canonical_user_id text
wallet_address text
type text
amount numeric
currency text
balance_before numeric
balance_after numeric
competition_id uuid
order_id uuid
description text
status text
created_at timestamp
user_privy_id text
metadata jsonb
provider text (generated from metadata)
tx_ref text (generated from metadata)
payment_provider text
payment_status text
ticket_count integer
webhook_ref text
charge_id text
charge_code text
checkout_url text
updated_at timestamp
primary_provider text
fallback_provider text
provider_attempts integer
provider_error text
posted_to_balance boolean
completed_at timestamp
expires_at timestamp
method text
tx_id text
network text
notes text
```

## Columns That DON'T EXIST (but are referenced in migrations)

### ❌ ticket_numbers
- **Status:** DOES NOT EXIST
- **Referenced in:**
  - 20260201073000_fix_dashboard_include_joincompetition.sql:96
  - 00000000000000_initial_schema.sql:2561
  - 20260202095000_fix_dashboard_data_issues.sql:324

### ❌ transaction_hash
- **Status:** DOES NOT EXIST
- **Should use:** `tx_id` instead
- **Referenced in:**
  - 20260201073000_fix_dashboard_include_joincompetition.sql:100
  - 00000000000000_initial_schema.sql:2565
  - 20260202095000_fix_dashboard_data_issues.sql:330
  - 20260202100000_emergency_fix_rpc_and_balance.sql:64 (JUST CREATED!)

## All Migrations With Column Errors

### Migration: 00000000000000_initial_schema.sql
**Functions affected:**
- get_user_transactions (line 2222)
- get_user_competition_entries (line 2425)
- get_comprehensive_user_dashboard_entries (line 2478)

**Errors:**
- References `ut.ticket_numbers` (doesn't exist)
- References `ut.transaction_hash` (doesn't exist, should use `ut.tx_id`)

### Migration: 20260201073000_fix_dashboard_include_joincompetition.sql
**Functions affected:**
- get_comprehensive_user_dashboard_entries (line 11)
- get_user_competition_entries (line 168)

**Errors:**
- References `ut.ticket_numbers` (line 96)
- References `ut.transaction_hash` (line 100)

### Migration: 20260202095000_fix_dashboard_data_issues.sql
**Functions affected:**
- get_user_competition_entries (line 22)
- get_comprehensive_user_dashboard_entries (line 126)
- get_user_transactions (line 287)

**Errors:**
- Line 215: `COALESCE(ut.tx_id, ut.transaction_hash)` - transaction_hash doesn't exist
- Line 324: `ut.ticket_numbers` - doesn't exist
- Line 330: `ut.transaction_hash` - doesn't exist

### Migration: 20260202100000_emergency_fix_rpc_and_balance.sql
**Functions affected:**
- get_user_transactions (line 21)

**Errors:**
- Line 64: `'transaction_hash', ut.transaction_hash` - doesn't exist, should use `ut.tx_id`

### Migration: 20260202090000_fix_dashboard_production_schema.sql
**Status:** ✅ CORRECT
- Line 97: Uses `ut.tx_id AS transaction_hash` (correct mapping)

## Correct Field Mappings

For fields that don't exist, use these alternatives:

| ❌ Wrong (doesn't exist) | ✅ Correct (exists) |
|-------------------------|---------------------|
| `ut.ticket_numbers` | Remove entirely (doesn't exist) |
| `ut.transaction_hash` | `ut.tx_id` |
| `ut.transaction_id` | `ut.tx_id` |

## All Functions That Need Fixing

### 1. get_user_transactions
- **Versions:** 4 (initial, 20260201, 20260202095000, 20260202100000)
- **Current error:** References `ut.transaction_hash` (doesn't exist)
- **Fix:** Change to `ut.tx_id`

### 2. get_comprehensive_user_dashboard_entries
- **Versions:** 3 (initial, 20260201, 20260202095000)
- **Current errors:** References `ut.ticket_numbers`, `ut.transaction_hash`
- **Fix:** Remove `ticket_numbers`, change `transaction_hash` to `tx_id`

### 3. get_user_competition_entries
- **Versions:** 3 (initial, 20260201, 20260202095000)
- **Current errors:** References `ut.ticket_numbers`, `ut.transaction_hash` 
- **Fix:** Remove `ticket_numbers`, change `transaction_hash` to `tx_id`

## Summary

**Total column errors found:** 11+ instances across 5 migrations
**Functions affected:** 3 different RPC functions
**Root cause:** Migrations reference columns that don't exist in production schema

**Pattern:** The errors suggest:
1. `ticket_numbers` column was planned but never created
2. `transaction_hash` was renamed to `tx_id` but old references weren't updated
3. Multiple migrations stacked on top without checking production schema
