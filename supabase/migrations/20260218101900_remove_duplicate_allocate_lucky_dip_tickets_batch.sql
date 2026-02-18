-- ============================================================================
-- Remove duplicate allocate_lucky_dip_tickets_batch function
-- ============================================================================
-- Issue: HTTP 500 error - "Could not choose the best candidate function"
-- Root Cause: Two overloaded versions of allocate_lucky_dip_tickets_batch exist:
--   1. Old baseline: (p_competition_id TEXT, p_user_id TEXT, p_ticket_count INTEGER)
--   2. New version: (p_user_id TEXT, p_competition_id UUID, p_count INTEGER, ...)
-- Solution: Drop the old 3-parameter baseline version, keep only the 7-parameter version
-- ============================================================================

BEGIN;

-- Drop the old 3-parameter baseline function
-- This is the one from 00000000000002_baseline_rpc_functions.sql
DROP FUNCTION IF EXISTS allocate_lucky_dip_tickets_batch(TEXT, TEXT, INTEGER) CASCADE;

-- Verify the correct 7-parameter version still exists
-- (Created by migration 20260207115000_fix_allocate_lucky_dip_tickets_batch_uuid_casting.sql)
DO $$
DECLARE
  v_function_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO v_function_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.proname = 'allocate_lucky_dip_tickets_batch'
    AND p.pronargs = 7;

  IF v_function_count = 0 THEN
    RAISE EXCEPTION 'ERROR: 7-parameter allocate_lucky_dip_tickets_batch function not found!';
  END IF;

  RAISE NOTICE '✓ Verified: 7-parameter allocate_lucky_dip_tickets_batch exists';
END;
$$;

-- Verify there is now only ONE version of the function
DO $$
DECLARE
  v_total_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO v_total_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.proname = 'allocate_lucky_dip_tickets_batch';

  IF v_total_count != 1 THEN
    RAISE EXCEPTION 'ERROR: Expected exactly 1 allocate_lucky_dip_tickets_batch function, found %', v_total_count;
  END IF;

  RAISE NOTICE '✓ Verified: Exactly 1 allocate_lucky_dip_tickets_batch function exists';
END;
$$;

COMMIT;

-- Migration Complete
-- This migration removes the ambiguity that caused the "Could not choose the best candidate function" error
