-- ============================================================================
-- BASELINE MIGRATION: DATABASE TRIGGERS
-- ============================================================================
-- Migration: 00000000000001_baseline_triggers.sql
-- Description: Comprehensive baseline for all database triggers
-- Created: 2026-01-27
-- 
-- This migration establishes trigger functions and triggers for:
-- - Timestamp management (auto-update updated_at columns)
-- - Data normalization (wallet addresses, user identifiers)
-- - Data synchronization (cross-table consistency)
-- - Business logic enforcement (balance operations, ticket allocation)
-- - Real-time notifications (Supabase Realtime broadcasts)
-- 
-- Note: This migration uses IF NOT EXISTS and OR REPLACE to be idempotent
-- ============================================================================

BEGIN;

-- ============================================================================
-- SECTION 1: HELPER TRIGGER FUNCTIONS
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Auto-update timestamps on row updates
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- Auto-expire reservations based on expires_at timestamp
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auto_expire_reservations()
RETURNS TRIGGER AS $$
BEGIN
  -- Called on INSERT or UPDATE
  IF NEW.expires_at < NOW() AND NEW.status = 'pending' THEN
    NEW.status := 'expired';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- SECTION 2: TIMESTAMP UPDATE TRIGGERS
-- ============================================================================
-- These triggers automatically update the updated_at timestamp on row changes

-- User transactions
DROP TRIGGER IF EXISTS update_user_transactions_updated_at ON user_transactions;
CREATE TRIGGER update_user_transactions_updated_at
  BEFORE UPDATE ON user_transactions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Pending tickets
DROP TRIGGER IF EXISTS update_pending_tickets_updated_at ON pending_tickets;
CREATE TRIGGER update_pending_tickets_updated_at
  BEFORE UPDATE ON pending_tickets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Sub-account balances
DROP TRIGGER IF EXISTS update_sub_account_balances_updated_at ON sub_account_balances;
CREATE TRIGGER update_sub_account_balances_updated_at
  BEFORE UPDATE ON sub_account_balances
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Canonical users
DROP TRIGGER IF EXISTS update_canonical_users_updated_at ON canonical_users;
CREATE TRIGGER update_canonical_users_updated_at
  BEFORE UPDATE ON canonical_users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Users
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Profiles
DROP TRIGGER IF EXISTS update_profiles_updated_at ON profiles;
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Orders
DROP TRIGGER IF EXISTS update_orders_updated_at ON orders;
CREATE TRIGGER update_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Competitions
DROP TRIGGER IF EXISTS update_competitions_updated_at ON competitions;
CREATE TRIGGER update_competitions_updated_at
  BEFORE UPDATE ON competitions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- SECTION 3: RESERVATION EXPIRY TRIGGER
-- ============================================================================

-- Auto-expire pending ticket reservations
DROP TRIGGER IF EXISTS check_reservation_expiry ON pending_tickets;
CREATE TRIGGER check_reservation_expiry
  BEFORE INSERT OR UPDATE ON pending_tickets
  FOR EACH ROW
  EXECUTE FUNCTION auto_expire_reservations();

-- ============================================================================
-- SECTION 4: ADDITIONAL TRIGGER FUNCTION PLACEHOLDERS
-- ============================================================================
-- Note: Based on the database analysis, there are 51 unique triggers in the 
-- production database. The following trigger functions exist in the database
-- but their full implementations need to be extracted and documented:
--
-- NORMALIZATION TRIGGERS (ensure data consistency):
-- - canonical_users_normalize
-- - canonical_users_normalize_before_write  
-- - cu_normalize_and_enforce
-- - users_normalize_before_write
-- - normalize_sub_account_currency
--
-- WALLET SYNCHRONIZATION TRIGGERS (maintain wallet address consistency):
-- - tickets_sync_wallet
-- - user_transactions_sync_wallet
-- - winners_sync_wallet
-- - joincompetition_sync_wallet
--
-- REALTIME BROADCAST TRIGGERS (Supabase Realtime notifications):
-- - bcast_ticket_changes
-- - bcast_winner_changes
--
-- SYNC TRIGGERS (cross-table synchronization):
-- - trg_sync_joincompetition_from_tickets
-- - trg_sync_joincompetition_from_pending
-- - sync_identity_columns
-- - sync_competition_status_if_ended
--
-- BALANCE/PAYMENT TRIGGERS:
-- - trg_provision_sub_account_balance
-- - trg_auto_debit_on_balance_order
-- - trg_finalize_pending_user_transactions
-- - trg_user_transactions_post_to_wallet
-- - trg_balance_ledger_sync_wallet
--
-- TICKET ALLOCATION TRIGGERS:
-- - trg_confirm_pending_tickets
-- - trg_tickets_finalize_spend
-- - trg_check_sold_out_on_ticket_insert
-- - trg_expire_hold_on_write
--
-- CANONICAL USER ID TRIGGERS (ensure canonical_user_id is set):
-- - trg_tickets_set_cuid
-- - trg_joincompetition_set_cuid
-- - trg_pending_tickets_set_cuid
-- - trg_user_transactions_set_cuid
-- - trg_sub_account_balances_sync_ids
--
-- ORDER/TRANSACTION TRIGGERS:
-- - trg_orders_to_user_transactions
-- - trg_user_tx_before_insert
-- - trg_user_tx_autocomplete_bi
-- - trg_user_tx_autocomplete_bu
-- - trg_user_tx_post_ai
-- - trg_user_tx_post_au
-- - trg_user_tx_guard_bu
--
-- WEBHOOK/INTEGRATION TRIGGERS:
-- - trg_user_transactions_cdp_enqueue
-- - trg_complete_topup_on_webhook_ref_ins
-- - trg_complete_topup_on_webhook_ref_upd
--
-- BONUS/REWARD TRIGGERS:
-- - trg_award_first_topup_bonus
-- - sub_account_balances_award_insert
-- - sub_account_balances_award_update
--
-- MISC UTILITY TRIGGERS:
-- - trg_user_transactions_txid_fill
-- - trg_tickets_txid_fill
-- - trg_repair_topup_provider_and_status
-- - trg_email_auth_sessions_verified
-- - trg_users_autolink_before_ins
-- - trg_init_sub_balance
--
-- COMPETITION SYNC TRIGGERS:
-- - competitions_sync_num_winners_trg
-- - competitions_sync_tickets_sold_trg
--
-- To complete this migration:
-- 1. Extract function definitions from production database using:
--    SELECT pg_get_functiondef(oid) FROM pg_proc 
--    WHERE proname = 'function_name';
-- 2. Add CREATE OR REPLACE FUNCTION statements above
-- 3. Add corresponding DROP TRIGGER IF EXISTS and CREATE TRIGGER statements
-- 4. Test in development environment before production deployment
--
-- See: /supabase/diagnostics/current_triggers.csv for complete trigger list
-- See: /supabase/diagnostics/current_functions.csv for function signatures
-- See: /debug/PAYMENT_DATABASE_SCHEMA.md for payment system triggers
-- ============================================================================

COMMIT;

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================
-- Run these after applying the migration to verify triggers are created:
--
-- -- Count all triggers
-- SELECT COUNT(*) FROM pg_trigger 
-- WHERE NOT tgisinternal 
-- AND tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace = 
--   (SELECT oid FROM pg_namespace WHERE nspname = 'public'));
--
-- -- List all triggers
-- SELECT t.tgname, c.relname 
-- FROM pg_trigger t 
-- JOIN pg_class c ON t.tgrelid = c.oid 
-- WHERE NOT t.tgisinternal 
-- AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
-- ORDER BY c.relname, t.tgname;
-- ============================================================================
