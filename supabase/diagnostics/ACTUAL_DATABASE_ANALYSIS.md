# ACTUAL DATABASE STATE ANALYSIS
## Based on CSV Exports from Production Database

**Analysis Date:** 2026-01-27  
**Source:** Supabase production database exports

---

## 📊 Summary Statistics

### Functions
- **Total Functions:** 272 (including PostgreSQL extensions)
- **Unique Function Names:** 234
- **Overloaded Functions:** 34 (multiple signatures)
- **Internal Helper Functions:** 9 (prefixed with `_`)
- **PostgreSQL Extension Functions:** 32 (built-in, not custom)
- **Custom Functions to Review:** ~200

### Triggers
- **Total Trigger Instances:** 83
- **Unique Trigger Names:** 51
- **Duplicate Triggers:** 29 (same trigger fired multiple times)

### Indexes
- **Total Indexes:** 100
- **All Unique:** Yes (no exact duplicates by name)
- **Heavy Tables:** pending_tickets (25), joincompetition (15), pending_ticket_items (15)

---

## 🔍 DETAILED FINDINGS

### 1. DUPLICATE TRIGGERS (Critical Issue)

Many triggers are registered multiple times on the same table, likely for different events (INSERT/UPDATE/DELETE). This is inefficient:

**High-Priority Duplicates:**
```
trg_bcast_winner_changes (winners): 3 instances
trg_bcast_ticket_changes (tickets): 3 instances  
trg_tickets_sync_joincompetition (tickets): 3 instances
```

**Recommendation:** Consolidate into single triggers with `AFTER INSERT OR UPDATE OR DELETE`

**Medium-Priority Duplicates (2 instances each):**
- `trg_orders_to_user_transactions` on orders
- `competitions_sync_num_winners_trg` on competitions
- `competitions_sync_tickets_sold_trg` on competitions
- `trg_auto_debit_on_balance_order` on orders
- `trg_normalize_sub_account_currency` on sub_account_balances
- `trg_profiles_after_upsert` on profiles
- `tr_set_canonical_user_id` on canonical_users
- `trg_canonical_users_normalize` on canonical_users
- `cu_normalize_and_enforce_trg` on canonical_users
- `users_normalize_before_write` on users
- `canonical_users_normalize_before_write` on canonical_users
- `trg_pending_sync_joincompetition` on pending_tickets
- `trg_tickets_wallet_bi` on tickets
- `trg_tickets_finalize_spend` on tickets
- `trg_repair_topup_provider_and_status` on user_transactions
- `trg_user_transactions_wallet_bi` on user_transactions

**Multiple Normalization Triggers on canonical_users (CONFLICT RISK):**
- `tr_set_canonical_user_id` (2x)
- `trg_canonical_users_normalize` (2x)
- `cu_normalize_and_enforce_trg` (2x)
- `canonical_users_normalize_before_write` (2x)

**Recommendation:** Keep only `cu_normalize_and_enforce_trg`, drop the rest

---

### 2. OVERLOADED FUNCTIONS (Multiple Signatures)

**Functions with 3+ versions:**
- `get_user_balance` (3 versions) - Consolidate
- `pgp_pub_decrypt` (3 versions) - PostgreSQL extension, ignore
- `pgp_pub_decrypt_bytea` (3 versions) - PostgreSQL extension, ignore
- `update_user_profile_by_identifier` (3 versions) - Keep most complete

**Functions with 2 versions (need review):**
- `armor`, `dearmor` - PostgreSQL crypto extension
- `award_first_topup_bonus` - Keep `award_first_topup_bonus_via_webhook`
- `award_welcome_bonus` - Review which version is used
- `check_and_mark_competition_sold_out` - Keep TEXT version
- `confirm_pending_to_sold` - Consolidate
- `credit_sub_account_balance` - Keep version with most params
- `credit_user_balance` - Consolidate
- `debit_balance_and_confirm` - Consolidate  
- `debit_user_balance` - Consolidate
- `digest`, `hmac` - PostgreSQL crypto extension
- `ensure_canonical_user` - Keep version with all params
- `finalize_order` - Keep version with all params
- `gen_salt` - PostgreSQL crypto extension
- `get_competition_unavailable_tickets` - Consolidate
- `get_comprehensive_user_dashboard_entries` - Consolidate
- `get_user_dashboard_entries` - Consolidate

---

### 3. POSTGRESQL EXTENSION FUNCTIONS (32 total)

**These are built-in, not custom functions. Should NOT be dropped:**
- Crypto: `armor`, `dearmor`, `crypt`, `encrypt`, `decrypt`, `decrypt_iv`, `encrypt_iv`
- Hashing: `digest`, `hmac`, `gen_salt`
- PGP: `pgp_*` (16 functions)
- UUID: `uuid_generate_v1`, `uuid_generate_v1mc`, `uuid_generate_v3`, `uuid_generate_v4`, `uuid_generate_v5`
- UUID Namespaces: `uuid_nil`, `uuid_ns_dns`, `uuid_ns_oid`, `uuid_ns_url`, `uuid_ns_x500`
- Random: `gen_random_bytes`, `gen_random_uuid`

---

### 4. INTERNAL/HELPER FUNCTIONS (9 total)

Prefixed with `_`, these are internal helpers:
- `_apply_wallet_delta`
- `_deduct_sub_account_balance`
- `_get_competition_price`
- `_get_user_competition_entries_unified`
- `_insert_user_spend_tx`
- `_run_backfill_now` ⚠️ Test function - DELETE
- `_test_block` ⚠️ Test function - DELETE
- `_ticket_cuid`
- `_wallet_delta_from_txn`

**Recommendation:** Delete test functions, keep others if used by public functions

---

### 5. DEPRECATED/STALE FUNCTIONS TO REMOVE

**Old Migration/Backfill Functions:**
- `migrate_privy_users`
- `migrate_user_balance`
- `sync_completed_deposits_to_usdc`
- `convert_specific_deposit`
- `invoke_backfill_comp_entries` (2 versions)
- `run_competition_entries_batch`
- `upsert_joincompetition_by_tx`

**Old Purchase/Confirmation Functions (superseded):**
- `confirm_payment_and_issue_tickets`
- `confirm_pending_tickets` (old version)
- `confirm_tickets`
- `confirm_ticket_purchase`
- `confirm_purchase_by_ref`
- `process_ticket_purchase` (multiple versions)
- `process_ticket_purchase_flex`
- `process_ticket_purchase_safe`
- `purchase_tickets` (2 versions - superseded by reservation flow)

**Old Balance/Wallet Functions:**
- `add_pending_balance` (if exists)
- `post_deposit_and_update_balance`
- `check_external_usdc_balance`
- `credit_balance_topup` (superseded by apply_wallet_mutation)
- `get_balance_by_any_id`

**Old Entry/Competition Functions:**
- `enter_competition`
- `enter_competition_and_deduct`
- `get_user_dashboard_entries` (2 versions - superseded by get_comprehensive_user_dashboard_entries)

**Old Finalization Functions:**
- `finalize_purchase`
- `finalize_purchase2`
- `finalize_ticket_hold`

**Old Ticket/Availability Functions:**
- `get_available_tickets` (superseded)
- `get_ticket_availability` (superseded)
- `check_ticket_availability`
- `count_sold_tickets_for_competition`
- `get_user_ticket_count`

**Old Reserve Functions:**
- `reserve_competition_tickets`
- `reserve_selected_tickets`
- `create_ticket_hold`

**Old RPC/Order Functions:**
- `rpc_debit_balance_for_order`
- `create_entry_charge`
- `create_order_for_reservation`
- `debit_balance_and_confirm_tickets`
- `debit_balance_confirm_tickets`

**Old User/Profile Functions:**
- `update_avatar_flex`
- `update_profile_flex`
- `update_user_avatar_by_uid` (2 versions)
- `create_user_if_not_exists`

**Old Wallet Functions:**
- `link_external_wallet` (superseded by link_additional_wallet)

**Old Resolver Functions:**
- `normalize_user_identifier`
- `resolve_canonical_user_id`
- `to_canonical_user_id`

**Old Bonus Functions:**
- `award_welcome_bonus` (2 versions)
- `credit_sub_account_with_bonus` (if separate from main flow)

**Old Upsert Functions:**
- `upsert_canonical_user_by_username`
- `upsert_canonical_user_with_wallet`
- `upsert_sub_account_topup`

**Diagnostic/Debug Functions:**
- `check_database_health`
- `get_active_competitions_for_draw`

**VRF/Winner Functions (if not using on-chain VRF):**
- `end_competition_and_select_winners`
- `record_vrf_callback`
- `insert_rng_log`
- `get_vrf_history`

**Custody Wallet Functions (if not using):**
- `update_custody_balance`
- `get_custody_wallet_summary`
- `sync_external_wallet_balances`
- `sync_all_external_wallet_balances`

**Helper Functions (may be unused):**
- `link_pending_reservation_to_session`
- `gen_deterministic_tx_id`
- `gen_ticket_tx_id`
- `ensure_sub_account_balance_row`

**Stats Functions:**
- `get_user_stats`
- `get_user_by_wallet`

**Claim Prize:**
- `claim_prize` (if not used)

**Sub-account Functions (if superseded):**
- `debit_sub_account_balance_with_entry`

---

### 6. INDEX ANALYSIS

**Tables with Many Indexes (may have duplicates/overlaps):**

**pending_tickets (25 indexes):**
- Multiple indexes on `competition_id`: `idx_pending_tickets_competition`, `idx_pending_tickets_comp_id`
- Multiple indexes on `canonical_user_id`: `idx_pending_tickets_canonical_user_id`, `idx_pending_tickets_canonical_user`
- Multiple indexes on `reservation_id`: `idx_pt_reservation`, `idx_pending_tickets_reservation`
- Multiple composite indexes with overlapping coverage
- **Recommendation:** Consolidate overlapping indexes

**joincompetition (15 indexes):**
- Multiple on `competitionid`: `idx_joincompetition_competitionid`, `idx_joincompetition_comp`, `idx_joincompetition_competition`, `idx_joincompetition_competitionid_tickets`
- Multiple on `canonical_user_id`: `idx_joincompetition_canonical_user_id`, `idx_joincompetition_cuid`
- Multiple on `wallet_address`: `idx_joincompetition_wallet`, `idx_joincompetition_wallet_lower`, `idx_joincompetition_walletaddress_lower`
- **Recommendation:** Keep only case-insensitive versions, drop exact duplicates

**pending_ticket_items (15 indexes):**
- Multiple on `competition_id, ticket_number`: 5 different indexes
- **Recommendation:** Consolidate to 1-2 indexes

**user_transactions (15 indexes):**
- Some overlap between `idx_ut_status_type` and individual status/type indexes
- **Recommendation:** Keep composite, evaluate if individual needed

---

## 🎯 RECOMMENDED ACTIONS

### Phase 1: Remove Test/Debug Functions (Safe)
```sql
DROP FUNCTION IF EXISTS _run_backfill_now() CASCADE;
DROP FUNCTION IF EXISTS _test_block(integer) CASCADE;
```

### Phase 2: Consolidate Duplicate Triggers
For each duplicate trigger, combine into single trigger with multiple events.

### Phase 3: Remove Deprecated Migration Functions
After confirming no active migrations reference them.

### Phase 4: Consolidate Overloaded Functions
Keep most complete version, drop others after testing.

### Phase 5: Optimize Indexes
Remove exact duplicates and consolidate overlapping coverage.

---

## 📝 NOTES

1. **Do NOT drop PostgreSQL extension functions** (32 total) - they're built-in
2. **Test in staging first** before applying to production
3. **Monitor application logs** after each phase for errors
4. **Backup database** before making changes
5. **Some functions may be called by edge functions or external services** - verify before dropping

---

## ✅ VERIFICATION CHECKLIST

After cleanup:
- [ ] All frontend API calls work
- [ ] Ticket purchase flow works
- [ ] Balance operations work
- [ ] User profile updates work
- [ ] Competition queries work
- [ ] Dashboard loads correctly
- [ ] No console errors
- [ ] Performance is acceptable
