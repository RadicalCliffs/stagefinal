# 🔔 Database Triggers Baseline Migration

This document describes the baseline migration for database triggers that complements the initial schema migration.

## 📁 Migration File

**Location:** `supabase/migrations/00000000000001_baseline_triggers.sql`

## 📊 Overview

The baseline schema migration (`00000000000000_initial_schema.sql`) included:
- ✅ 45 tables
- ✅ 43 RPC functions
- ✅ 125+ indexes
- ❌ **Database triggers (MISSING)**

This migration addresses the missing triggers component.

## 🎯 What's Included

### Implemented Triggers (Core Functionality)

#### 1. Timestamp Management (9 triggers)
Automatically updates `updated_at` columns on row modifications:
- `update_user_transactions_updated_at`
- `update_pending_tickets_updated_at`
- `update_sub_account_balances_updated_at`
- `update_canonical_users_updated_at`
- `update_users_updated_at`
- `update_profiles_updated_at`
- `update_orders_updated_at`
- `update_competitions_updated_at`

#### 2. Business Logic (1 trigger)
- `check_reservation_expiry` - Auto-expires pending ticket reservations

### Documented But Not Implemented (42 triggers)

The migration file includes comprehensive documentation for 42 additional triggers that exist in the production database but require extraction and implementation. These are organized into categories:

#### Normalization Triggers (5)
Ensure data consistency across tables:
- `canonical_users_normalize`
- `canonical_users_normalize_before_write`
- `cu_normalize_and_enforce`
- `users_normalize_before_write`
- `normalize_sub_account_currency`

#### Wallet Synchronization Triggers (4)
Maintain wallet address consistency:
- `tickets_sync_wallet`
- `user_transactions_sync_wallet`
- `winners_sync_wallet`
- `joincompetition_sync_wallet`

#### Realtime Broadcast Triggers (2)
Supabase Realtime notifications:
- `bcast_ticket_changes`
- `bcast_winner_changes`

#### Cross-Table Sync Triggers (4)
Synchronize related data across tables:
- `trg_sync_joincompetition_from_tickets`
- `trg_sync_joincompetition_from_pending`
- `sync_identity_columns`
- `sync_competition_status_if_ended`

#### Balance/Payment Triggers (5)
Handle financial operations:
- `trg_provision_sub_account_balance`
- `trg_auto_debit_on_balance_order`
- `trg_finalize_pending_user_transactions`
- `trg_user_transactions_post_to_wallet`
- `trg_balance_ledger_sync_wallet`

#### Ticket Allocation Triggers (4)
Manage ticket reservations and sales:
- `trg_confirm_pending_tickets`
- `trg_tickets_finalize_spend`
- `trg_check_sold_out_on_ticket_insert`
- `trg_expire_hold_on_write`

#### Canonical User ID Triggers (5)
Ensure canonical user IDs are set:
- `trg_tickets_set_cuid`
- `trg_joincompetition_set_cuid`
- `trg_pending_tickets_set_cuid`
- `trg_user_transactions_set_cuid`
- `trg_sub_account_balances_sync_ids`

#### Order/Transaction Triggers (8)
Handle order and transaction processing:
- `trg_orders_to_user_transactions`
- `trg_user_tx_before_insert`
- `trg_user_tx_autocomplete_bi`
- `trg_user_tx_autocomplete_bu`
- `trg_user_tx_post_ai`
- `trg_user_tx_post_au`
- `trg_user_tx_guard_bu`

#### Webhook/Integration Triggers (3)
External system integration:
- `trg_user_transactions_cdp_enqueue`
- `trg_complete_topup_on_webhook_ref_ins`
- `trg_complete_topup_on_webhook_ref_upd`

#### Bonus/Reward Triggers (3)
Manage bonuses and rewards:
- `trg_award_first_topup_bonus`
- `sub_account_balances_award_insert`
- `sub_account_balances_award_update`

#### Competition Sync Triggers (2)
Maintain competition statistics:
- `competitions_sync_num_winners_trg`
- `competitions_sync_tickets_sold_trg`

#### Miscellaneous Triggers (6)
Utility functions:
- `trg_user_transactions_txid_fill`
- `trg_tickets_txid_fill`
- `trg_repair_topup_provider_and_status`
- `trg_email_auth_sessions_verified`
- `trg_users_autolink_before_ins`
- `trg_init_sub_balance`

## 📈 Current Status

### ✅ Completed (Phase 1)
- [x] Core trigger functions defined
- [x] Timestamp management triggers created
- [x] Reservation expiry trigger created
- [x] All 42 additional triggers documented
- [x] Migration file created with idempotent statements
- [x] Verification queries included

### ⏳ Pending (Phase 2)
- [ ] Extract trigger function definitions from production database
- [ ] Implement remaining 42 trigger functions
- [ ] Add corresponding CREATE TRIGGER statements
- [ ] Test in development environment
- [ ] Consolidate duplicate triggers (29 duplicates identified)
- [ ] Resolve conflicts (4 overlapping normalize triggers on canonical_users)

## 🚀 Deployment

### Option 1: Apply via Supabase CLI
```bash
# Apply the migration
supabase db push

# Or apply specific migration
supabase migration up --file 00000000000001_baseline_triggers.sql
```

### Option 2: Manual Application
```bash
# Via psql or Supabase Studio SQL Editor
# Copy and execute the migration file contents
```

### Verification
After applying, verify triggers are created:
```sql
-- Count all triggers
SELECT COUNT(*) 
FROM pg_trigger 
WHERE NOT tgisinternal 
AND tgrelid IN (
  SELECT oid FROM pg_class 
  WHERE relnamespace = (
    SELECT oid FROM pg_namespace WHERE nspname = 'public'
  )
);

-- List all triggers by table
SELECT t.tgname as trigger_name, c.relname as table_name
FROM pg_trigger t 
JOIN pg_class c ON t.tgrelid = c.oid 
WHERE NOT t.tgisinternal 
AND c.relnamespace = (
  SELECT oid FROM pg_namespace WHERE nspname = 'public'
)
ORDER BY c.relname, t.tgname;
```

## 📚 Reference Documentation

### Production Database State
- **Total Trigger Instances:** 83 (51 unique names, 29 duplicates)
- **Trigger Function Count:** ~60+
- **See:** `supabase/diagnostics/current_triggers.csv`

### Related Documentation
- **Payment System Triggers:** `debug/PAYMENT_DATABASE_SCHEMA.md` (Section 5: Triggers)
- **Database Analysis:** `supabase/diagnostics/ACTUAL_DATABASE_ANALYSIS.md`
- **Function Exports:** `supabase/diagnostics/current_functions.csv`
- **Trigger Exports:** `supabase/diagnostics/current_triggers.csv`

## 🔍 Known Issues

### Duplicate Triggers
29 triggers are registered multiple times (e.g., separate INSERT, UPDATE, DELETE):
- `trg_bcast_winner_changes` (winners): 3 instances
- `trg_bcast_ticket_changes` (tickets): 3 instances
- `trg_tickets_sync_joincompetition` (tickets): 3 instances

**Recommendation:** Consolidate using `CREATE TRIGGER ... AFTER INSERT OR UPDATE OR DELETE`

### Conflicting Normalization Triggers
4 overlapping triggers on `canonical_users`:
- `tr_set_canonical_user_id` (2x)
- `trg_canonical_users_normalize` (2x)
- `cu_normalize_and_enforce_trg` (2x)
- `canonical_users_normalize_before_write` (2x)

**Recommendation:** Keep only `cu_normalize_and_enforce_trg`, drop the rest

## 🛠️ Next Steps

### For Developers
1. Extract function definitions from production:
   ```sql
   SELECT pg_get_functiondef(oid) 
   FROM pg_proc 
   WHERE proname = 'function_name' 
   AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
   ```

2. Add extracted functions to migration file
3. Add corresponding CREATE TRIGGER statements
4. Test in development environment

### For DevOps
1. Review migration file for completeness
2. Test in staging environment
3. Monitor trigger performance after deployment
4. Consider trigger consolidation for optimization

### For Product/Management
- This migration provides the foundation for trigger management
- Phase 2 will complete all 42 remaining trigger implementations
- Improves maintainability and reduces technical debt
- Enables fresh environment setup with complete database schema

## 🔒 Safety Features

- Uses `CREATE OR REPLACE FUNCTION` for idempotency
- Uses `DROP TRIGGER IF EXISTS` before creating triggers
- Transaction-wrapped (BEGIN/COMMIT) for atomic operations
- Won't destroy existing triggers (recreates with same logic)
- Safe to run multiple times

## 📞 Support

For questions or issues:
1. Review the migration file comments
2. Check the diagnostics directory for current database state
3. Consult the ACTUAL_DATABASE_ANALYSIS.md for trigger analysis
4. Review PAYMENT_DATABASE_SCHEMA.md for payment-specific triggers

---

**Version:** 1.0 (Phase 1 - Core Triggers)  
**Created:** 2026-01-27  
**Status:** ✅ Partial Implementation (10/51 triggers)  
**Next Phase:** Extract and implement remaining 41 triggers
