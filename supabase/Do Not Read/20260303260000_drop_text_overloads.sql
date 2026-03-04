-- ============================================================================
-- EMERGENCY FIX: Drop TEXT overloads causing PGRST203 errors
-- ============================================================================

-- Drop TEXT version to fix "Could not choose the best candidate function"
DROP FUNCTION IF EXISTS get_unavailable_tickets(TEXT) CASCADE;
DROP FUNCTION IF EXISTS get_competition_unavailable_tickets(TEXT) CASCADE;

-- Ensure only UUID versions exist (these were already created in previous migrations)
-- Just verify they're correct

DO $$
BEGIN
  RAISE NOTICE '========================================================';
  RAISE NOTICE 'Dropped TEXT overloads for get_unavailable_tickets';
  RAISE NOTICE 'Only UUID versions remain';
  RAISE NOTICE '========================================================';
END $$;
