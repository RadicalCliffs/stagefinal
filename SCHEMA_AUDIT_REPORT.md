# Database Schema Audit Report

**Date**: 2026-01-31  
**Auditor**: Database Schema Analysis  
**Status**: ⚠️ CRITICAL MISALIGNMENT DETECTED

---

## Executive Summary

### 🔴 Critical Findings

**Production vs Documentation Gap:**
- **Triggers**: 78 in production vs 11 documented in migrations
- **Indexes**: 180+ in production vs 92 documented in migrations
- **Functions**: Production functions not fully inventoried

**Alignment Status**: ❌ **SEVERELY MISALIGNED**

### Impact

- Migration files do NOT reflect production reality
- New deployments could DROP critical production triggers/indexes
- Performance-critical indexes may be undocumented
- Business logic triggers operating without source control

---

## Detailed Analysis

### 1. TRIGGERS - Production State (78 Total)

#### ✅ Documented in Migrations (11 triggers)
These are in the baseline_triggers.sql migration:

1. `update_user_transactions_updated_at` - timestamp management
2. `update_pending_tickets_updated_at` - timestamp management
3. `update_sub_account_balances_updated_at` - timestamp management (⚠️ NOT in production list)
4. `update_canonical_users_updated_at` - timestamp management ✅
5. `update_users_updated_at` - timestamp management (⚠️ NOT in production list)
6. `update_profiles_updated_at` - timestamp management (⚠️ NOT in production list)
7. `update_orders_updated_at` - timestamp management (⚠️ NOT in production list)
8. `update_competitions_updated_at` - timestamp management ✅
9. `check_reservation_expiry` - pending ticket expiry ✅

#### 🆕 Production-Only Triggers (67+ triggers)

**Critical Business Logic Triggers NOT in Migrations:**

##### Data Normalization (5 triggers)
- `canonical_users_normalize_before_write` ✅
- `cu_normalize_and_enforce_trg` ✅
- `trg_canonical_users_normalize` ✅
- `users_normalize_before_write` ✅
- `trg_normalize_sub_account_currency` ✅

##### Realtime Broadcast (15+ triggers)
- `balance_ledger_broadcast` ✅
- `balance_ledger_broadcast_trigger` ✅
- `canonical_users_broadcast` ✅
- `competitions_broadcast` ✅
- `competitions_broadcast_trigger` ✅
- `joincompetition_broadcast` ✅
- `joincompetition_broadcast_trigger` ✅
- `orders_broadcast` ✅
- `payment_webhook_events_broadcast` ✅
- `pending_tickets_broadcast` ✅
- `pending_tickets_broadcast_trigger` ✅
- `sub_account_balances_broadcast_trigger` ✅
- `tickets_broadcast` ✅
- `tickets_broadcast_trigger` ✅
- `user_transactions_broadcast` ✅
- `user_transactions_broadcast_trigger` ✅
- `winners_broadcast_trigger` ✅

##### Balance & Payment Processing (7 triggers)
- `sync_balance_to_canonical_users` - CRITICAL for balance sync ✅
- `sub_account_balances_award_insert` - Bonus awards ✅
- `sub_account_balances_award_update` - Bonus awards ✅
- `trg_auto_debit_on_balance_order` - Auto-debit on orders ✅
- `trg_balance_ledger_sync_wallet` - Ledger to wallet sync ✅
- `trg_user_tx_post_ai` - Transaction posting ✅
- `trg_user_tx_post_au` - Transaction posting ✅

##### Ticket Management (8 triggers)
- `trg_bcast_ticket_changes` - Real-time ticket updates ✅
- `trg_bcast_winner_changes` - Real-time winner updates ✅
- `trg_check_sold_out_on_ticket_insert` - Auto sold-out detection ✅
- `trg_confirm_pending_tickets` - Confirm reservations ✅
- `trg_expire_hold_on_write` - Expire holds ✅
- `trg_tickets_finalize_spend` - Finalize spending ✅
- `trg_tickets_sync_joincompetition` - Sync joined competitions ✅
- `trg_tickets_wallet_bi` - Wallet sync ✅

##### Canonical User ID Management (6 triggers)
- `tr_set_canonical_user_id` - Set canonical ID from wallet ✅
- `trg_joincompetition_set_cuid` - Set on joincompetition ✅
- `trg_pending_tickets_set_cuid` - Set on pending_tickets ✅
- `trg_tickets_set_cuid` - Set on tickets ✅
- `trg_user_transactions_set_cuid` - Set on user_transactions ✅
- `trg_sub_account_balances_sync_ids` - Sync IDs ✅

##### Transaction Processing (13 triggers)
- `trg_complete_topup_on_webhook_ref_ins` - Complete topup on insert ✅
- `trg_complete_topup_on_webhook_ref_upd` - Complete topup on update ✅
- `trg_finalize_pending_user_transactions` - Finalize pending ✅
- `trg_repair_topup_provider_and_status` - Repair data ✅
- `trg_sync_identity_user_tx` - Sync identity ✅
- `trg_user_transactions_cdp_enqueue` - CDP events ✅
- `trg_user_transactions_post_to_wallet` - Post to wallet ✅
- `trg_user_transactions_txid_fill` - Fill transaction ID ✅
- `trg_user_transactions_wallet_bi` - Wallet sync ✅
- `trg_user_tx_autocomplete_bi` - Auto-complete on insert ✅
- `trg_user_tx_autocomplete_bu` - Auto-complete on update ✅
- `trg_user_tx_before_insert` - Pre-insert processing ✅
- `trg_user_tx_guard_bu` - Guard against double-post ✅

##### Wallet Synchronization (5 triggers)
- `trg_joincompetition_wallet_bi` - Sync wallet on joincompetition ✅
- `trg_tickets_wallet_bi` - Sync wallet on tickets ✅
- `trg_user_transactions_wallet_bi` - Sync wallet on transactions ✅
- `trg_winners_wallet_bi` - Sync wallet on winners ✅

##### Other Critical Triggers (8 triggers)
- `competitions_sync_num_winners_trg` - Sync winner count ✅
- `competitions_sync_tickets_sold_trg` - Sync sold count ✅
- `trg_award_first_topup_bonus` - First deposit bonus ✅
- `trg_email_auth_sessions_verified` - Email verification ✅
- `trg_init_sub_balance` - Initialize sub-balance ✅
- `trg_orders_to_user_transactions` - Order to transaction ✅
- `trg_pending_sync_joincompetition` - Pending to joined ✅
- `trg_pending_tickets_enforce_expiry_biu` - Enforce expiry ✅
- `trg_profiles_after_upsert` - Profile processing ✅
- `trg_provision_sub_account_balance` - Provision balance ✅
- `trg_users_autolink_before_ins` - Auto-link users ✅
- `payments_set_updated_at` - Payment timestamp ✅
- `reservations_broadcast` - Reservation updates ✅
- `trigger_instant_win_grids_updated_at` - Instant win timestamp ✅
- `trigger_joincompetition_updated_at` - Join timestamp ✅

---

### 2. INDEXES - Production State (180+ Total)

#### Primary Keys & Unique Constraints (70+ indexes)

**Critical Unique Indexes:**
- `canonical_users_canonical_user_id_key` - CRITICAL ✅
- `canonical_users_wallet_address_key` - CRITICAL ✅
- `sub_account_balances_pkey` - CRITICAL ✅
- `tickets_competition_id_ticket_number_key` - Prevents double-booking ✅
- `balance_ledger_reference_unique` - Idempotency ✅
- `payment_idempotency_idempotency_key_key` - Payment idempotency ✅
- `purchase_idempotency_idempotency_key_key` - Purchase idempotency ✅

#### Performance Indexes (110+ indexes)

**Hot Path Indexes (Critical for Performance):**

1. **User Lookup Indexes:**
   - `idx_canonical_users_canonical_id` ✅
   - `idx_canonical_users_wallet` ✅
   - `idx_canonical_users_privy_user_id` ✅
   - `idx_cu_wallet` ✅

2. **Balance Query Indexes:**
   - `idx_sub_account_balances_canonical` ✅
   - `idx_sub_account_balances_user_id` ✅
   - `idx_sub_account_balances_wallet_address` ✅
   - `idx_sub_balances_cuid_currency` ✅
   - `idx_balance_ledger_canonical` ✅
   - `idx_balance_ledger_user_created` ✅

3. **Ticket Availability Indexes:**
   - `idx_tickets_comp_ticket` ✅
   - `idx_tickets_competition` ✅
   - `idx_pending_items_competition_ticket` ✅
   - `idx_pending_tickets_comp_status_exp` ✅
   - `uq_pending_ticket_items_active` - CRITICAL partial unique ✅

4. **Competition Indexes:**
   - `idx_competitions_status` ✅
   - `idx_competitions_status_dates` ✅
   - `idx_competitions_end_date` ✅
   - `idx_joincompetition_comp_user_wallet` ✅

5. **Transaction Indexes:**
   - `idx_user_transactions_canonical` ✅
   - `idx_user_transactions_user_comp` ✅
   - `idx_user_tx_user_created` ✅
   - `idx_custody_tx_user_status_type_created` ✅

6. **Idempotency & Deduplication:**
   - `idx_payment_idempotency_key` ✅
   - `idx_payments_idem` ✅
   - `u_balance_ledger_reference_id` ✅

#### ⚠️ Composite Indexes NOT in Migrations (30+)

Many production composite indexes are missing from migrations:
- `idx_joincompetition_comp_user_wallet` (4 columns!)
- `idx_custody_tx_user_status_type_created` (4 columns!)
- `idx_pending_tickets_comp_status_exp` (3 columns)
- `idx_tickets_competition_status_tn` (3 columns)
- `idx_sub_bal_wallet_currency` (3 columns)
- And many more...

#### 🔍 Functional Indexes (Case-Insensitive)

Production has several `LOWER()` indexes NOT in migrations:
- `idx_joincompetition_walletaddress_lower` ✅
- `idx_pending_tickets_wallet_lower` ✅
- `idx_tickets_user_id_lower` ✅

---

## 3. FUNCTIONS - Alignment Analysis

### ✅ Core Functions ARE Being Used

**Evidence from codebase grep:**

#### Frontend Usage (30+ RPC calls):
```typescript
// User balance queries
supabase.rpc('get_user_balance')              // dashboardEntriesService.ts
supabase.rpc('update_user_avatar')             // userDataService.ts

// Wallet management  
supabase.rpc('get_user_wallets')              // WalletManagement.tsx
supabase.rpc('set_primary_wallet')            // WalletManagement.tsx
supabase.rpc('update_wallet_nickname')        // WalletManagement.tsx
supabase.rpc('unlink_wallet')                 // WalletManagement.tsx
supabase.rpc('get_linked_external_wallet')    // WalletManagement.tsx
supabase.rpc('unlink_external_wallet')        // WalletManagement.tsx

// Ticket operations
supabase.rpc('get_unavailable_tickets')        // IndividualCompetitionHeroSection.tsx
supabase.rpc('get_competition_entries_bypass_rls') // EntriesWithFilterTabs.tsx

// Identity management
supabase.rpc('attach_identity_after_auth')     // BaseWalletAuthModal.tsx
supabase.rpc('upsert_canonical_user')         // BaseWalletAuthModal.tsx

// Transaction history
supabase.rpc('get_user_transactions')         // notification-service.ts
```

#### Edge Function Usage (100+ table accesses):
- `sub_account_balances` - 106 accesses in edge functions
- `canonical_users` - Heavy usage for user lookups
- `pending_tickets` - Reservation system
- Direct usage of `credit_sub_account_balance` and `debit_sub_account_balance` RPCs

### ⚠️ Functions Documented but NOT in Migrations

Some functions documented may have been:
1. Created manually in production
2. Created via Supabase dashboard
3. Part of older migrations not in repository

**Action Required**: Export production function definitions

---

## 4. CRITICAL MISALIGNMENTS

### 🔴 High Priority Issues

#### Issue #1: Missing Triggers in Migrations
**Impact**: SEVERE  
**Risk**: Database reset would destroy 67+ critical triggers

**Examples of Critical Missing Triggers:**
- `sync_balance_to_canonical_users` - Balance consistency
- `trg_auto_debit_on_balance_order` - Payment automation
- `trg_check_sold_out_on_ticket_insert` - Sold-out detection
- All broadcast triggers for Realtime

**Recommendation**: 
```sql
-- Create migration: 20260201000000_restore_production_triggers.sql
-- Extract ALL trigger definitions from production
-- Document each trigger's purpose
```

#### Issue #2: Missing Indexes in Migrations  
**Impact**: SEVERE  
**Risk**: Database reset would destroy 90+ performance-critical indexes

**Examples of Critical Missing Indexes:**
- Composite indexes on hot paths (tickets, transactions)
- Case-insensitive wallet lookup indexes
- Partial unique indexes for data integrity

**Recommendation**:
```sql
-- Create migration: 20260201000001_restore_production_indexes.sql
-- Extract ALL index definitions from production
-- Categorize by purpose (performance, integrity, lookup)
```

#### Issue #3: Trigger Function Dependencies
**Impact**: HIGH  
**Risk**: Some triggers reference functions not defined in migrations

**Missing Trigger Functions:**
- `broadcast_table_changes` (used by 15+ triggers)
- `trg_set_cuid_from_context` (used by 5+ triggers)
- Many normalization and sync functions

**Recommendation**:
```sql
-- Create migration: 20260201000002_restore_trigger_functions.sql
-- Extract ALL trigger function definitions
```

### ⚠️ Medium Priority Issues

#### Issue #4: Documentation Out of Sync
**Impact**: MEDIUM  
**Risk**: Developers unaware of production database features

**Current State:**
- Functions.md documents 48 functions
- Triggers.md documents 51 triggers (planned)
- Indexes.md documents 126 indexes
- Production has MORE of everything

**Recommendation**: Update documentation to match production exactly

#### Issue #5: Migration History Gap
**Impact**: MEDIUM  
**Risk**: Unknown how production diverged from migrations

**Evidence:**
- Migrations only have 11 triggers
- Production has 78 triggers
- Gap of 67 triggers unaccounted for

**Recommendation**: Audit all manual changes made via Supabase dashboard

---

## 5. VERIFICATION QUERIES

### Production State Extraction

```sql
-- Get all triggers
SELECT 
  trigger_name,
  event_object_table,
  action_statement,
  action_timing,
  event_manipulation
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY event_object_table, trigger_name;

-- Get all indexes
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

-- Get all functions
SELECT
  routine_name,
  routine_type,
  data_type as return_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_type = 'FUNCTION'
ORDER BY routine_name;

-- Get trigger functions
SELECT
  p.proname as function_name,
  pg_get_functiondef(p.oid) as definition
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname LIKE '%trigger%'
OR p.prorettype = 'trigger'::regtype;
```

---

## 6. RECOMMENDED ACTION PLAN

### Phase 1: Emergency Documentation (Week 1)
1. ✅ Export ALL production triggers → new migration file
2. ✅ Export ALL production indexes → new migration file
3. ✅ Export ALL trigger functions → new migration file
4. ✅ Update Functions.md, Triggers.md, Indexes.md to match production
5. ✅ Create schema comparison script

### Phase 2: Schema Source Control (Week 2)
1. Create baseline migration from production state
2. Test migration on fresh database
3. Verify all triggers fire correctly
4. Verify all indexes exist
5. Verify all functions work

### Phase 3: Alignment Verification (Week 3)
1. Compare production vs migration state
2. Document any remaining differences
3. Create process for schema changes (migration-first)
4. Set up automated schema drift detection

### Phase 4: Prevention (Ongoing)
1. Block manual schema changes in production
2. Require all changes via migrations
3. Add pre-deployment schema validation
4. Set up monitoring for schema drift

---

## 7. CONCLUSION

### Current Status: 🔴 CRITICAL

The production database has diverged significantly from the migration files:
- **67+ triggers** exist only in production
- **90+ indexes** exist only in production  
- **Unknown functions** may exist only in production

### Risk Assessment

**Deployment Risk**: 🔴 **EXTREME**
- New deployment could drop critical triggers
- New deployment could drop performance indexes
- Business logic would break

**Data Integrity Risk**: 🟡 **MEDIUM**
- Triggers ensure data consistency
- Missing triggers in migrations = risk on rebuild

**Performance Risk**: 🟡 **MEDIUM**
- Missing indexes in migrations = slow queries on rebuild

### Immediate Actions Required

1. ⚠️ **FREEZE** any database resets until alignment complete
2. ⚠️ **EXPORT** production schema immediately
3. ⚠️ **CREATE** alignment migrations
4. ⚠️ **TEST** migrations on staging
5. ⚠️ **DOCUMENT** all differences

---

## 8. APPENDICES

### Appendix A: Full Production Trigger List (78 triggers)

See new_requirement data provided above for complete list.

### Appendix B: Full Production Index List (180+ indexes)

See new_requirement data provided above for complete list.

### Appendix C: Migration Files Analyzed

1. `00000000000000_initial_schema.sql` - Base schema, 43 functions
2. `00000000000001_baseline_triggers.sql` - 11 triggers only
3. `20260128152400_add_debit_sub_account_balance.sql` - 1 function
4. `20260128152500_secure_credit_sub_account_balance.sql` - 1 function
5. `20260130000000_simplified_balance_payment.sql` - 2 functions

### Appendix D: Codebase Usage Evidence

- 30+ RPC function calls in frontend
- 106+ table accesses in edge functions
- Active usage of balance, ticket, wallet, and identity functions

---

**Report Status**: COMPLETE  
**Next Step**: Create production schema export migrations  
**Owner**: Database Team  
**Due Date**: URGENT - Within 48 hours
