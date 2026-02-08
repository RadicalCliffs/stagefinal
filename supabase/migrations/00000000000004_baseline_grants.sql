-- ============================================================================
-- FRONTEND-FIRST BASELINE MIGRATION - PART 4: FINAL GRANTS
-- ============================================================================
-- This migration grants execution permissions on all RPC functions
-- 
-- Created: 2026-02-08
-- Purpose: Final permissions and cleanup
-- 
-- Includes:
-- - GRANT EXECUTE on all functions
-- - ALTER DEFAULT PRIVILEGES for future functions
-- - Additional helpful indexes
-- ============================================================================

BEGIN;

-- ============================================================================
-- SECTION 1: GRANT EXECUTE ON ALL FUNCTIONS
-- ============================================================================

-- Grant execute permissions to all roles on all functions
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- ============================================================================
-- SECTION 2: ALTER DEFAULT PRIVILEGES
-- ============================================================================
-- Ensure future functions also get proper permissions

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;

-- ============================================================================
-- SECTION 3: ADDITIONAL PERFORMANCE INDEXES
-- ============================================================================
-- Create indexes for frequently queried columns

CREATE INDEX IF NOT EXISTS idx_user_transactions_type_status ON user_transactions(transaction_type, status);
CREATE INDEX IF NOT EXISTS idx_tickets_competition_user ON tickets(competition_id, canonical_user_id);
CREATE INDEX IF NOT EXISTS idx_competition_entries_competition_user ON competition_entries(competition_id, canonical_user_id);
CREATE INDEX IF NOT EXISTS idx_joincompetition_userid_competitionid ON joincompetition(userid, competitionid);

COMMIT;

-- ============================================================================
-- MIGRATION COMPLETE: NEW BASELINE ESTABLISHED
-- ============================================================================
--
-- This completes the frontend-first baseline migration series:
-- 
-- ✓ 00000000000000_new_baseline.sql - Core schema (40+ tables)
-- ✓ 00000000000001_baseline_views_rls.sql - Views and RLS policies
-- ✓ 00000000000002_baseline_rpc_functions.sql - RPC functions (31 functions)
-- ✓ 00000000000003_baseline_triggers.sql - Triggers (18 triggers)
-- ✓ 00000000000004_baseline_grants.sql - Final grants and indexes
--
-- The database is now ready for frontend use with:
-- - Complete table schema
-- - All required views (v_joincompetition_active, v_competition_ticket_stats, user_overview)
-- - All RPC functions for user management, tickets, competitions, payments
-- - RLS policies for security
-- - Proper grants for anon, authenticated, service_role
-- - Automatic timestamp updates
-- - Performance indexes
--
-- Version: 1.0
-- Date: 2026-02-08
-- ============================================================================
