-- Fix HTTP 300 error for sync_competition_status_if_ended
-- The error occurs when multiple versions of the function exist with the same signature
-- This migration ensures only one version exists with the correct implementation

BEGIN;

-- Drop all existing versions of sync_competition_status_if_ended
DROP FUNCTION IF EXISTS sync_competition_status_if_ended(TEXT) CASCADE;
DROP FUNCTION IF EXISTS sync_competition_status_if_ended(UUID) CASCADE;

-- Create the definitive version that accepts TEXT and casts to UUID internally
-- This matches the latest implementation from 20260205020000_fix_lucky_dip_uuid_casting.sql
CREATE OR REPLACE FUNCTION sync_competition_status_if_ended(p_competition_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_end_date TIMESTAMP WITH TIME ZONE;
  v_current_status TEXT;
BEGIN
  -- Query using both id and uid fields, casting TEXT to UUID
  SELECT end_date, status INTO v_end_date, v_current_status
  FROM competitions
  WHERE id = p_competition_id::UUID OR uid = p_competition_id;

  -- Check if competition has ended and status needs updating
  IF v_end_date IS NOT NULL AND v_end_date < NOW() AND v_current_status NOT IN ('completed', 'drawn', 'ended') THEN
    UPDATE competitions
    SET status = 'completed', updated_at = NOW()
    WHERE id = p_competition_id::UUID OR uid = p_competition_id;

    RETURN jsonb_build_object(
      'status_changed', true,
      'old_status', v_current_status,
      'new_status', 'completed'
    );
  END IF;

  RETURN jsonb_build_object(
    'status_changed', false,
    'current_status', v_current_status
  );
END;
$$;

COMMIT;

-- Log completion
DO $$
BEGIN
  RAISE NOTICE '==============================================';
  RAISE NOTICE 'Fixed sync_competition_status_if_ended HTTP 300 ambiguity';
  RAISE NOTICE 'Only one function version now exists';
  RAISE NOTICE '==============================================';
END $$;
