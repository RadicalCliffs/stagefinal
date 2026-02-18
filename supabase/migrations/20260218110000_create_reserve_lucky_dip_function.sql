-- ============================================================================
-- Create reserve_lucky_dip RPC Function
-- ============================================================================
-- Issue: Edge function calls reserve_lucky_dip but it doesn't exist
-- Error: "operator does not exist: uuid = text"
-- Solution: Create reserve_lucky_dip with proper TEXT parameter handling
-- Date: 2026-02-18
-- ============================================================================

BEGIN;

-- ============================================================================
-- Create reserve_lucky_dip function
-- This is a wrapper around allocate_lucky_dip_tickets_batch that:
-- 1. Accepts TEXT parameters (no UUID conversions at function boundary)
-- 2. Converts competition_id from TEXT to UUID internally for database queries
-- 3. Returns the expected format for the edge function
-- ============================================================================

CREATE OR REPLACE FUNCTION reserve_lucky_dip(
  p_competition_id TEXT,
  p_canonical_user_id TEXT,
  p_wallet_address TEXT,
  p_ticket_count INTEGER,
  p_hold_minutes INTEGER DEFAULT 15
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_competition_uuid UUID;
  v_result JSONB;
  v_success BOOLEAN;
  v_reservation_id UUID;
  v_ticket_numbers INTEGER[];
BEGIN
  -- Validate inputs
  IF p_competition_id IS NULL OR TRIM(p_competition_id) = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'competition_id is required'
    );
  END IF;

  IF p_canonical_user_id IS NULL OR TRIM(p_canonical_user_id) = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'canonical_user_id is required'
    );
  END IF;

  IF p_ticket_count IS NULL OR p_ticket_count < 1 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'ticket_count must be at least 1'
    );
  END IF;

  -- Convert TEXT competition_id to UUID for internal database operations
  -- This prevents "operator does not exist: uuid = text" errors
  BEGIN
    v_competition_uuid := p_competition_id::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    -- If not a valid UUID, try to look up by uid
    SELECT id INTO v_competition_uuid
    FROM competitions
    WHERE uid = p_competition_id
    LIMIT 1;

    IF v_competition_uuid IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Invalid competition_id format'
      );
    END IF;
  END;

  -- Call the existing allocate_lucky_dip_tickets_batch function
  -- NOTE: canonical_user_id stays as TEXT (first parameter)
  -- NOTE: competition_id is converted to UUID (second parameter)
  v_result := allocate_lucky_dip_tickets_batch(
    p_canonical_user_id,  -- TEXT - user ID (canonical format)
    v_competition_uuid,   -- UUID - competition ID (converted from TEXT)
    p_ticket_count,       -- INTEGER - number of tickets
    1.0,                  -- NUMERIC - ticket price (default, will be updated by edge function)
    p_hold_minutes,       -- INTEGER - hold time in minutes
    NULL,                 -- TEXT - session_id (not provided by edge function)
    NULL                  -- INTEGER[] - excluded_tickets (not provided)
  );

  -- Extract success status
  v_success := (v_result->>'success')::BOOLEAN;

  IF NOT v_success THEN
    -- Pass through error from allocate_lucky_dip_tickets_batch
    RETURN v_result;
  END IF;

  -- Extract reservation_id and ticket_numbers
  v_reservation_id := (v_result->>'reservation_id')::UUID;
  v_ticket_numbers := ARRAY(
    SELECT jsonb_array_elements_text(v_result->'ticket_numbers')::INTEGER
  );

  -- Return in the format expected by the edge function
  -- { pending_ticket_id: string, allocated_numbers: number[] }
  RETURN jsonb_build_object(
    'pending_ticket_id', v_reservation_id,
    'allocated_numbers', v_ticket_numbers,
    'success', true
  );

EXCEPTION WHEN OTHERS THEN
  -- Catch any unexpected errors
  RETURN jsonb_build_object(
    'success', false,
    'error', 'Failed to allocate tickets: ' || SQLERRM,
    'errorCode', 500,
    'retryable', true
  );
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION reserve_lucky_dip(TEXT, TEXT, TEXT, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION reserve_lucky_dip(TEXT, TEXT, TEXT, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION reserve_lucky_dip(TEXT, TEXT, TEXT, INTEGER, INTEGER) TO anon;

-- Add comment
COMMENT ON FUNCTION reserve_lucky_dip(TEXT, TEXT, TEXT, INTEGER, INTEGER) IS 
'Reserve random tickets for lucky dip purchases.
Accepts TEXT parameters to avoid uuid = text errors.
Converts competition_id to UUID internally for database operations.
Returns: { pending_ticket_id: UUID, allocated_numbers: INTEGER[], success: BOOLEAN }';

COMMIT;

-- Log completion
DO $$
BEGIN
  RAISE NOTICE '==============================================';
  RAISE NOTICE 'reserve_lucky_dip function created successfully';
  RAISE NOTICE '==============================================';
  RAISE NOTICE 'Function signature:';
  RAISE NOTICE '  reserve_lucky_dip(';
  RAISE NOTICE '    p_competition_id TEXT,';
  RAISE NOTICE '    p_canonical_user_id TEXT,';
  RAISE NOTICE '    p_wallet_address TEXT,';
  RAISE NOTICE '    p_ticket_count INTEGER,';
  RAISE NOTICE '    p_hold_minutes INTEGER DEFAULT 15';
  RAISE NOTICE '  )';
  RAISE NOTICE '';
  RAISE NOTICE 'Key features:';
  RAISE NOTICE '  - ALL parameters are TEXT or INTEGER (no UUID parameters)';
  RAISE NOTICE '  - Converts competition_id from TEXT to UUID internally';
  RAISE NOTICE '  - Prevents "operator does not exist: uuid = text" errors';
  RAISE NOTICE '  - Returns format expected by edge function';
  RAISE NOTICE '==============================================';
END $$;
