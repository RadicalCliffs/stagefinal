-- ============================================================================
-- FRONTEND-FIRST BASELINE MIGRATION - PART 3: TRIGGERS
-- ============================================================================
-- This migration creates essential database triggers
-- 
-- Created: 2026-02-08
-- Purpose: Auto-update triggers and data consistency
-- 
-- Includes:
-- - Timestamp auto-update triggers (updated_at columns)
-- - Reservation expiry trigger
-- ============================================================================

BEGIN;

-- ============================================================================
-- SECTION 1: TRIGGER FUNCTIONS
-- ============================================================================

-- Auto-update timestamps on row updates
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Auto-expire reservations based on expires_at timestamp
CREATE OR REPLACE FUNCTION auto_expire_reservations()
RETURNS TRIGGER AS $$
BEGIN
  -- Only process if expires_at is set and status is pending
  IF NEW.expires_at IS NOT NULL AND NEW.expires_at < NOW() AND NEW.status = 'pending' THEN
    NEW.status := 'expired';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- SECTION 2: TIMESTAMP UPDATE TRIGGERS
-- ============================================================================
-- These triggers automatically update the updated_at timestamp on row changes

-- User tables
DROP TRIGGER IF EXISTS update_canonical_users_updated_at ON canonical_users;
CREATE TRIGGER update_canonical_users_updated_at
  BEFORE UPDATE ON canonical_users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_profiles_updated_at ON profiles;
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Balance tables
DROP TRIGGER IF EXISTS update_sub_account_balances_updated_at ON sub_account_balances;
CREATE TRIGGER update_sub_account_balances_updated_at
  BEFORE UPDATE ON sub_account_balances
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_wallet_balances_updated_at ON wallet_balances;
CREATE TRIGGER update_wallet_balances_updated_at
  BEFORE UPDATE ON wallet_balances
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Transaction tables
DROP TRIGGER IF EXISTS update_user_transactions_updated_at ON user_transactions;
CREATE TRIGGER update_user_transactions_updated_at
  BEFORE UPDATE ON user_transactions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Competition tables
DROP TRIGGER IF EXISTS update_competitions_updated_at ON competitions;
CREATE TRIGGER update_competitions_updated_at
  BEFORE UPDATE ON competitions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_competition_entries_updated_at ON competition_entries;
CREATE TRIGGER update_competition_entries_updated_at
  BEFORE UPDATE ON competition_entries
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Ticket tables
DROP TRIGGER IF EXISTS update_pending_tickets_updated_at ON pending_tickets;
CREATE TRIGGER update_pending_tickets_updated_at
  BEFORE UPDATE ON pending_tickets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Order tables
DROP TRIGGER IF EXISTS update_orders_updated_at ON orders;
CREATE TRIGGER update_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- CMS tables
DROP TRIGGER IF EXISTS update_faqs_updated_at ON faqs;
CREATE TRIGGER update_faqs_updated_at
  BEFORE UPDATE ON faqs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_hero_competitions_updated_at ON hero_competitions;
CREATE TRIGGER update_hero_competitions_updated_at
  BEFORE UPDATE ON hero_competitions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_partners_updated_at ON partners;
CREATE TRIGGER update_partners_updated_at
  BEFORE UPDATE ON partners
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_testimonials_updated_at ON testimonials;
CREATE TRIGGER update_testimonials_updated_at
  BEFORE UPDATE ON testimonials
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_site_stats_updated_at ON site_stats;
CREATE TRIGGER update_site_stats_updated_at
  BEFORE UPDATE ON site_stats
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_site_metadata_updated_at ON site_metadata;
CREATE TRIGGER update_site_metadata_updated_at
  BEFORE UPDATE ON site_metadata
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

COMMIT;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
-- This triggers migration creates:
-- ✓ 2 trigger functions (timestamp update, reservation expiry)
-- ✓ 18 timestamp update triggers for all tables with updated_at
-- ✓ 1 reservation expiry trigger
--
-- All triggers are idempotent (DROP IF EXISTS before CREATE)
-- ============================================================================
