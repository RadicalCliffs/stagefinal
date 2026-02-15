-- ============================================================================
-- CLEANUP STALE DATABASE OBJECTS - BASED ON ACTUAL PRODUCTION STATE
-- ============================================================================
-- This script removes stale functions and consolidates duplicate triggers
-- based on actual CSV exports from production database (2026-01-27)
--
-- IMPORTANT: 
-- 1. Review ACTUAL_DATABASE_ANALYSIS.md before running
-- 2. Test in staging environment first
-- 3. Backup database before applying
-- 4. Apply in phases, testing after each phase
-- ============================================================================

BEGIN;

-- ============================================================================
-- PHASE 1: REMOVE TEST/DEBUG FUNCTIONS (SAFE)
-- ============================================================================

DROP FUNCTION IF EXISTS _test_block(integer) CASCADE;
DROP FUNCTION IF EXISTS _run_backfill_now() CASCADE;

-- ============================================================================
-- PHASE 2: REMOVE DEPRECATED MIGRATION/BACKFILL FUNCTIONS
-- ============================================================================

DROP FUNCTION IF EXISTS migrate_privy_users(jsonb) CASCADE;
DROP FUNCTION IF EXISTS migrate_user_balance(text, text) CASCADE;
DROP FUNCTION IF EXISTS sync_completed_deposits_to_usdc(text) CASCADE;
DROP FUNCTION IF EXISTS convert_specific_deposit(text, numeric, text) CASCADE;
DROP FUNCTION IF EXISTS invoke_backfill_comp_entries(text, text) CASCADE;
DROP FUNCTION IF EXISTS invoke_backfill_comp_entries() CASCADE;
DROP FUNCTION IF EXISTS run_competition_entries_batch(integer, boolean) CASCADE;
DROP FUNCTION IF EXISTS upsert_joincompetition_by_tx(text) CASCADE;

-- ============================================================================
-- PHASE 3: REMOVE OLD PURCHASE/CONFIRMATION FUNCTIONS (SUPERSEDED)
-- ============================================================================

DROP FUNCTION IF EXISTS confirm_payment_and_issue_tickets(uuid, text, numeric, text) CASCADE;
DROP FUNCTION IF EXISTS confirm_pending_tickets(uuid, uuid, text) CASCADE;
DROP FUNCTION IF EXISTS confirm_tickets(uuid, text, text, numeric) CASCADE;
DROP FUNCTION IF EXISTS confirm_ticket_purchase(uuid, text) CASCADE;
DROP FUNCTION IF EXISTS confirm_purchase_by_ref(text, text, numeric, text, timestamp with time zone) CASCADE;
DROP FUNCTION IF EXISTS process_ticket_purchase_flex(uuid, text, text, integer[], integer, numeric, text) CASCADE;
DROP FUNCTION IF EXISTS process_ticket_purchase_safe(uuid, uuid, text, integer[], integer, numeric, text) CASCADE;

-- Keep only the current version of process_ticket_purchase
-- Note: Check which signature is actually used before dropping

-- ============================================================================
-- PHASE 4: REMOVE OLD BALANCE/WALLET FUNCTIONS
-- ============================================================================

DROP FUNCTION IF EXISTS post_deposit_and_update_balance(text, numeric, text, text) CASCADE;
DROP FUNCTION IF EXISTS check_external_usdc_balance(text) CASCADE;
DROP FUNCTION IF EXISTS credit_balance_topup(text, numeric, text, text, text, text, text, text) CASCADE;
DROP FUNCTION IF EXISTS get_balance_by_any_id(text) CASCADE;

-- ============================================================================
-- PHASE 5: REMOVE OLD ENTRY/DASHBOARD FUNCTIONS
-- ============================================================================

DROP FUNCTION IF EXISTS enter_competition(text, uuid, integer[], numeric) CASCADE;
DROP FUNCTION IF EXISTS enter_competition_and_deduct(uuid, text, integer) CASCADE;

-- Keep get_comprehensive_user_dashboard_entries, drop old versions
-- Note: Verify which version of get_user_dashboard_entries is needed
DROP FUNCTION IF EXISTS get_user_dashboard_entries(text) CASCADE;
DROP FUNCTION IF EXISTS get_user_dashboard_entries(text, boolean) CASCADE;

-- ============================================================================
-- PHASE 6: REMOVE OLD FINALIZATION FUNCTIONS
-- ============================================================================

DROP FUNCTION IF EXISTS finalize_purchase(uuid) CASCADE;
DROP FUNCTION IF EXISTS finalize_purchase2(uuid, text, integer) CASCADE;
DROP FUNCTION IF EXISTS finalize_ticket_hold(uuid) CASCADE;

-- ============================================================================
-- PHASE 7: REMOVE OLD TICKET/AVAILABILITY FUNCTIONS
-- ============================================================================

DROP FUNCTION IF EXISTS get_available_tickets(uuid) CASCADE;
DROP FUNCTION IF EXISTS get_ticket_availability(uuid) CASCADE;
DROP FUNCTION IF EXISTS check_ticket_availability(uuid, integer[]) CASCADE;
DROP FUNCTION IF EXISTS count_sold_tickets_for_competition(uuid) CASCADE;
DROP FUNCTION IF EXISTS get_user_ticket_count(text) CASCADE;

-- ============================================================================
-- PHASE 8: REMOVE OLD RESERVE FUNCTIONS
-- ============================================================================

DROP FUNCTION IF EXISTS reserve_competition_tickets(text, uuid, integer[], integer) CASCADE;
DROP FUNCTION IF EXISTS reserve_selected_tickets(text, uuid, integer[], numeric, integer, text) CASCADE;
DROP FUNCTION IF EXISTS create_ticket_hold(uuid, uuid, integer[], integer) CASCADE;

-- ============================================================================
-- PHASE 9: REMOVE OLD RPC/ORDER FUNCTIONS
-- ============================================================================

DROP FUNCTION IF EXISTS rpc_debit_balance_for_order(uuid) CASCADE;
DROP FUNCTION IF EXISTS create_entry_charge(text, uuid, numeric, integer, text, text, jsonb) CASCADE;
DROP FUNCTION IF EXISTS create_order_for_reservation(uuid, text, text) CASCADE;
DROP FUNCTION IF EXISTS debit_balance_and_confirm_tickets(text, uuid, uuid, numeric, text, text) CASCADE;
DROP FUNCTION IF EXISTS debit_balance_confirm_tickets(text, uuid, uuid, numeric, text, text) CASCADE;

-- ============================================================================
-- PHASE 10: REMOVE OLD USER/PROFILE FUNCTIONS
-- ============================================================================

DROP FUNCTION IF EXISTS update_avatar_flex(jsonb) CASCADE;
DROP FUNCTION IF EXISTS update_profile_flex(jsonb) CASCADE;
DROP FUNCTION IF EXISTS update_user_avatar_by_uid(text, text) CASCADE;
DROP FUNCTION IF EXISTS update_user_avatar_by_uid(uuid, text) CASCADE;
DROP FUNCTION IF EXISTS create_user_if_not_exists(text, text, text) CASCADE;

-- ============================================================================
-- PHASE 11: REMOVE OLD WALLET FUNCTIONS
-- ============================================================================

DROP FUNCTION IF EXISTS link_external_wallet(text, text) CASCADE;

-- ============================================================================
-- PHASE 12: REMOVE OLD RESOLVER FUNCTIONS
-- ============================================================================

DROP FUNCTION IF EXISTS normalize_user_identifier(text) CASCADE;
DROP FUNCTION IF EXISTS resolve_canonical_user_id(text) CASCADE;
DROP FUNCTION IF EXISTS to_canonical_user_id(text) CASCADE;

-- ============================================================================
-- PHASE 13: REMOVE OLD BONUS FUNCTIONS
-- ============================================================================

-- Keep award_first_topup_bonus_via_webhook, drop older versions
DROP FUNCTION IF EXISTS award_first_topup_bonus(text, numeric, numeric, text, text, text) CASCADE;
DROP FUNCTION IF EXISTS award_welcome_bonus(text, numeric, numeric) CASCADE;
DROP FUNCTION IF EXISTS award_welcome_bonus(text, numeric) CASCADE;

-- ============================================================================
-- PHASE 14: REMOVE OLD UPSERT FUNCTIONS
-- ============================================================================

DROP FUNCTION IF EXISTS upsert_canonical_user_by_username(text, text, text, text, text, text, text, text, text, text, text, text, uuid) CASCADE;
DROP FUNCTION IF EXISTS upsert_canonical_user_with_wallet(text, text, text, text, text, text, text, text, text, text) CASCADE;
DROP FUNCTION IF EXISTS upsert_sub_account_topup(text, numeric, text) CASCADE;

-- ============================================================================
-- PHASE 15: REMOVE DIAGNOSTIC/DEBUG FUNCTIONS
-- ============================================================================

DROP FUNCTION IF EXISTS check_database_health() CASCADE;
DROP FUNCTION IF EXISTS get_active_competitions_for_draw() CASCADE;

-- ============================================================================
-- PHASE 16: REMOVE VRF/WINNER FUNCTIONS (IF NOT USING ON-CHAIN VRF)
-- ============================================================================
-- Uncomment if you're not using on-chain VRF:
-- DROP FUNCTION IF EXISTS end_competition_and_select_winners(uuid, text) CASCADE;
-- DROP FUNCTION IF EXISTS record_vrf_callback(uuid, text, text[], integer[], text[], bigint, text, jsonb) CASCADE;
-- DROP FUNCTION IF EXISTS insert_rng_log(timestamp with time zone, text, text, uuid, text, text, text, boolean, text) CASCADE;
-- DROP FUNCTION IF EXISTS get_vrf_history(uuid, integer) CASCADE;

-- ============================================================================
-- PHASE 17: REMOVE CUSTODY WALLET FUNCTIONS (IF NOT USING)
-- ============================================================================
-- Uncomment if you're not using custody wallet integration:
-- DROP FUNCTION IF EXISTS update_custody_balance(text, numeric, text, text) CASCADE;
-- DROP FUNCTION IF EXISTS get_custody_wallet_summary(text) CASCADE;
-- DROP FUNCTION IF EXISTS sync_external_wallet_balances(text) CASCADE;
-- DROP FUNCTION IF EXISTS sync_all_external_wallet_balances() CASCADE;

-- ============================================================================
-- PHASE 18: REMOVE HELPER FUNCTIONS (IF UNUSED)
-- ============================================================================

DROP FUNCTION IF EXISTS link_pending_reservation_to_session(uuid, text) CASCADE;
DROP FUNCTION IF EXISTS gen_deterministic_tx_id(uuid, text, text, text, text, text, numeric, text, timestamp with time zone) CASCADE;
DROP FUNCTION IF EXISTS gen_ticket_tx_id(uuid, uuid, bigint, text, text, text, numeric, text, timestamp with time zone) CASCADE;
DROP FUNCTION IF EXISTS ensure_sub_account_balance_row(text, text) CASCADE;

-- ============================================================================
-- PHASE 19: REMOVE STATS FUNCTIONS
-- ============================================================================

DROP FUNCTION IF EXISTS get_user_stats(text) CASCADE;
DROP FUNCTION IF EXISTS get_user_by_wallet(text) CASCADE;

-- ============================================================================
-- PHASE 20: REMOVE CLAIM PRIZE (IF NOT USED)
-- ============================================================================

DROP FUNCTION IF EXISTS claim_prize(uuid, text) CASCADE;

-- ============================================================================
-- PHASE 21: CONSOLIDATE DUPLICATE FUNCTIONS (KEEP ONE VERSION)
-- ============================================================================

-- Keep TEXT version of check_and_mark_competition_sold_out, drop UUID version
DROP FUNCTION IF EXISTS check_and_mark_competition_sold_out(uuid) CASCADE;

-- Consolidate confirm_pending_to_sold - keep the version with most parameters
-- Note: Check which signature is actually used before dropping

-- Consolidate credit/debit functions - keep versions with most parameters
-- Note: Verify usage before dropping

-- Consolidate get_user_balance - keep the most complete version
-- Note: Check types.ts to see which signature frontend expects

-- Consolidate get_competition_unavailable_tickets
DROP FUNCTION IF EXISTS get_competition_unavailable_tickets(uuid) CASCADE;

-- Consolidate get_comprehensive_user_dashboard_entries
-- Keep the TEXT version, drop JSONB version if exists
DROP FUNCTION IF EXISTS get_comprehensive_user_dashboard_entries(jsonb) CASCADE;

-- Consolidate finalize_order
DROP FUNCTION IF EXISTS finalize_order(text, text) CASCADE;

-- Consolidate get_user_tickets_for_competition
DROP FUNCTION IF EXISTS get_user_tickets_for_competition(text, uuid) CASCADE;

-- Consolidate ensure_canonical_user
DROP FUNCTION IF EXISTS ensure_canonical_user(text, text) CASCADE;

-- Consolidate process_ticket_purchase (keep the one used by frontend)
-- Check which version before dropping

-- Consolidate reserve_tickets (keep the one used by frontend)
-- Check which version before dropping

-- Consolidate reserve_tickets_atomically
DROP FUNCTION IF EXISTS reserve_tickets_atomically(uuid, text, text, integer[], numeric) CASCADE;

-- Consolidate update_user_profile_by_identifier (keep most complete)
-- Check which version has all required parameters

COMMIT;

-- ============================================================================
-- POST-CLEANUP VERIFICATION
-- ============================================================================
-- Run these queries after cleanup to verify:
--
-- 1. Count remaining functions:
--    SELECT COUNT(*) FROM pg_proc WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname='public');
--
-- 2. Check for remaining duplicates:
--    SELECT proname, COUNT(*) FROM pg_proc 
--    WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname='public')
--    GROUP BY proname HAVING COUNT(*) > 1;
--
-- 3. Test critical user flows in the application
--
-- ============================================================================
