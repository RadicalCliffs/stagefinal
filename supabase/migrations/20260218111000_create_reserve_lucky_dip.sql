-- ============================================================================
-- Create reserve_lucky_dip RPC Function
-- ============================================================================
-- Issue: Edge function calls reserve_lucky_dip but it doesn't exist in migrations
-- Solution: Create reserve_lucky_dip that accepts TEXT from edge function
--           and converts to UUID for database operations
-- Date: 2026-02-18
-- ============================================================================

BEGIN;

-- ============================================================================
-- Create reserve_lucky_dip function
-- Wrapper that accepts TEXT parameters from edge function and converts to UUID
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

  -- Convert TEXT competition_id to UUID
  -- Edge function passes TEXT, database uses UUID
  BEGIN
    v_competition_uuid := p_competition_id::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    -- If not a valid UUID, try to look up by uid
    SELECT id INTO v_competition_uuid
    FROM competitions
    WHERE uid::TEXT = p_competition_id
    LIMIT 1;

    IF v_competition_uuid IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Invalid competition_id format'
      );
    END IF;
  END;

  -- Call allocate_lucky_dip_tickets_batch with proper types:
  -- - p_canonical_user_id: TEXT (stays TEXT)
  -- - v_competition_uuid: UUID (converted from TEXT)
  v_result := allocate_lucky_dip_tickets_batch(
    p_canonical_user_id,  -- TEXT - user ID (canonical format, always TEXT)
    v_competition_uuid,   -- UUID - competition ID (converted from TEXT to UUID)
    p_ticket_count,       -- INTEGER - number of tickets
    1.0,                  -- NUMERIC - ticket price (default, edge function calculates actual price)
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
Accepts TEXT parameters from edge function and converts competition_id to UUID.
- canonical_user_id: TEXT (always)
- competition_id: TEXT input, converted to UUID for database
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
  RAISE NOTICE '    p_competition_id TEXT,        -- Converted to UUID internally';
  RAISE NOTICE '    p_canonical_user_id TEXT,     -- Stays TEXT (always TEXT)';
  RAISE NOTICE '    p_wallet_address TEXT,';
  RAISE NOTICE '    p_ticket_count INTEGER,';
  RAISE NOTICE '    p_hold_minutes INTEGER DEFAULT 15';
  RAISE NOTICE '  )';
  RAISE NOTICE '';
  RAISE NOTICE 'Type handling:';
  RAISE NOTICE '  - Accepts TEXT competition_id from edge function';
  RAISE NOTICE '  - Converts to UUID for database operations';
  RAISE NOTICE '  - canonical_user_id stays TEXT (always TEXT)';
  RAISE NOTICE '  - Passes UUID to allocate_lucky_dip_tickets_batch';
  RAISE NOTICE '==============================================';
END $$;
