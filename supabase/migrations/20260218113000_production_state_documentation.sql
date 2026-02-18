-- ============================================================================
-- Production Database State Documentation
-- ============================================================================
--
-- This file documents the production Supabase database state as of 2026-02-18
-- The actual production state is defined in CSV exports located in /supabase/:
--
-- 1. All Functions by relevant schemas.csv - Function catalog (457 lines)
-- 2. All Functions.csv - Complete function DDL (1023 lines)  
-- 3. All Indexes.csv - Complete index definitions (101 lines)
-- 4. All triggers.csv - Complete trigger definitions (2360 lines)
--
-- ============================================================================
-- PRODUCTION DATABASE SUMMARY
-- ============================================================================
--
-- Functions: 410 total (406 in public schema, 4 in auth schema)
--   - 283 PL/pgSQL functions (business logic)
--   - 44 SQL functions (query wrappers)
--   - Remaining in C and other languages
--
-- Indexes: 101 total (varies by schema)
--   - 75 in auth schema
--   - 3 in cron schema  
--   - Others in system schemas
--
-- Triggers: 667 total
--   - 87 in public schema
--   - 1 in cron schema
--   - Covers balance_ledger, canonical_users, orders, competitions, etc.
--
-- ============================================================================
-- KEY PRODUCTION FUNCTIONS (Public Schema Sample)
-- ============================================================================
--
-- Wallet & Balance Management:
--   - allocate_lucky_dip_tickets* (4 variants)
--   - apply_wallet_mutation()
--   - apply_vrf_to_competition()
--   - _apply_wallet_delta()
--   - credit_sub_account_balance()
--   - debit_sub_account_balance()
--
-- Promotional Systems:
--   - admin_create_promotional_code()
--   - admin_update_promotional_code()
--   - admin_deactivate_promotional_code()
--
-- Auth & Identity:
--   - allocate_temp_canonical_user()
--   - attach_identity_after_auth()
--   - upsert_canonical_user()
--
-- Data Synchronization (Trigger Functions):
--   - balance_ledger_sync_wallet
--   - ensure_order_for_debit()
--   - auto_allocate_paid_tickets()
--   - auto_complete_competition()
--
-- ============================================================================
-- MIGRATION STRATEGY
-- ============================================================================
--
-- The CSV files serve as the authoritative source for production database
-- objects. To sync local development with production:
--
-- Option 1: Use Supabase CLI to pull schema
--   supabase db pull
--
-- Option 2: Manual extraction from CSVs
--   See /scripts/extract-production-schema.sh
--
-- Option 3: Direct SQL execution
--   Apply the DDL statements from the CSV files directly via Supabase Studio
--
-- ============================================================================
-- IMPORTANT NOTES
-- ============================================================================
--
-- 1. The CSV files contain the COMPLETE production state including:
--    - Function bodies with full business logic
--    - Index definitions with all options
--    - Trigger definitions and their functions
--
-- 2. These CSVs should be treated as read-only documentation
--    DO NOT modify them - they represent production truth
--
-- 3. For schema changes:
--    - Make changes in migrations/
--    - Test locally
--    - Deploy to production
--    - Re-export CSVs from production to update documentation
--
-- 4. Migration files in this directory represent incremental changes
--    The CSVs represent the cumulative production state
--
-- ============================================================================

-- This is a documentation file, not an executable migration
-- See the CSV files for actual DDL statements

DO $$ 
BEGIN
  RAISE NOTICE '============================================================================';
  RAISE NOTICE 'Production Database Documentation';
  RAISE NOTICE '============================================================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Production state is documented in CSV files:';
  RAISE NOTICE '  - All Functions by relevant schemas.csv (function catalog)';
  RAISE NOTICE '  - All Functions.csv (complete DDL, 1023 lines)';
  RAISE NOTICE '  - All Indexes.csv (index definitions, 101 lines)';
  RAISE NOTICE '  - All triggers.csv (trigger definitions, 2360 lines)';
  RAISE NOTICE '';
  RAISE NOTICE 'Statistics:';
  RAISE NOTICE '  - 410 functions (406 public + 4 auth)';
  RAISE NOTICE '  - 101 indexes';
  RAISE NOTICE '  - 667 triggers (87 public + 1 cron)';
  RAISE NOTICE '';
  RAISE NOTICE 'To sync with production, use: supabase db pull';
  RAISE NOTICE '============================================================================';
END $$;
