-- ============================================================================
-- Fix UUID = TEXT comparison in allocate_lucky_dip_tickets_batch
-- ============================================================================
-- Issue: "operator does not exist: uuid = text" error
-- Root Cause: pending_tickets.competition_id is UUID (not TEXT as comments said)
--             Function compares it with TEXT variable v_competition_id_text
-- Solution: Compare with UUID variable p_competition_id instead
-- Date: 2026-02-18
-- ============================================================================

BEGIN;

-- Fix allocate_lucky_dip_tickets_batch to use UUID for pending_tickets comparisons
CREATE OR REPLACE FUNCTION allocate_lucky_dip_tickets_batch(
  p_user_id TEXT,
  p_competition_id UUID,
  p_count INTEGER,
  p_ticket_price NUMERIC DEFAULT 1,
  p_hold_minutes INTEGER DEFAULT 15,
  p_session_id TEXT DEFAULT NULL,
  p_excluded_tickets INTEGER[] DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_tickets INTEGER;
  v_competition_uid UUID;
  v_competition_id_text TEXT;
  v_available_tickets INTEGER[];
  v_selected_tickets INTEGER[];
  v_reservation_id UUID;
  v_expires_at TIMESTAMPTZ;
  v_total_amount DECIMAL;
  v_unavailable_set INTEGER[];
  v_available_count INTEGER;
  v_random_offset INTEGER;
BEGIN
  -- Convert UUID to TEXT for joincompetition table (it uses TEXT)
  v_competition_id_text := p_competition_id::TEXT;

  -- Validate count (increased limit for batch operations)
  IF p_count < 1 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Count must be at least 1'
    );
  END IF;

  -- Allow up to 500 tickets per batch call (for bulk operations)
  IF p_count > 500 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Count cannot exceed 500 per batch. Use multiple batches for larger purchases.',
      'max_batch_size', 500
    );
  END IF;

  -- Get competition details with row lock
  -- competitions.id is UUID, competitions.uid is UUID
  SELECT total_tickets, uid
  INTO v_total_tickets, v_competition_uid
  FROM competitions
  WHERE id = p_competition_id
    AND deleted = false
    AND status = 'active'
  FOR UPDATE SKIP LOCKED;

  IF v_total_tickets IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Competition not found, not active, or temporarily locked',
      'retryable', true
    );
  END IF;

  -- Build set of unavailable tickets from database sources
  -- Start with any pre-provided excluded tickets (from caller's cache)
  v_unavailable_set := COALESCE(p_excluded_tickets, ARRAY[]::INTEGER[]);

  -- Add sold tickets from joincompetition
  -- joincompetition.competitionid is TEXT
  SELECT v_unavailable_set || COALESCE(array_agg(DISTINCT ticket_num), ARRAY[]::INTEGER[])
  INTO v_unavailable_set
  FROM (
    SELECT CAST(trim(unnest(string_to_array(ticketnumbers, ','))) AS INTEGER) AS ticket_num
    FROM joincompetition
    WHERE (competitionid = v_competition_id_text OR competitionid = v_competition_uid::TEXT)
      AND ticketnumbers IS NOT NULL
      AND trim(ticketnumbers) != ''
  ) jc_tickets
  WHERE ticket_num IS NOT NULL AND ticket_num >= 1 AND ticket_num <= v_total_tickets;

  -- Add sold tickets from tickets table
  -- tickets.competition_id is UUID
  SELECT v_unavailable_set || COALESCE(array_agg(ticket_number), ARRAY[]::INTEGER[])
  INTO v_unavailable_set
  FROM tickets
  WHERE competition_id = p_competition_id
    AND ticket_number IS NOT NULL;

  -- Add pending tickets from other users
  -- FIXED: pending_tickets.competition_id is UUID (not TEXT)
  -- Use p_competition_id (UUID) instead of v_competition_id_text (TEXT)
  SELECT v_unavailable_set || COALESCE(array_agg(ticket_num), ARRAY[]::INTEGER[])
  INTO v_unavailable_set
  FROM (
    SELECT unnest(ticket_numbers) AS ticket_num
    FROM pending_tickets
    WHERE competition_id = p_competition_id  -- FIXED: Was v_competition_id_text
      AND status = 'pending'
      AND expires_at > NOW()
      AND user_id != p_user_id
  ) pt;

  -- Remove duplicates
  SELECT array_agg(DISTINCT u) INTO v_unavailable_set
  FROM unnest(v_unavailable_set) AS u
  WHERE u IS NOT NULL;

  v_unavailable_set := COALESCE(v_unavailable_set, ARRAY[]::INTEGER[]);

  -- Generate a random starting offset for better distribution
  -- This helps when multiple requests come in simultaneously
  v_random_offset := floor(random() * v_total_tickets)::INTEGER;

  -- Generate available tickets with randomization
  -- Use random offset to start from different positions
  SELECT array_agg(n ORDER BY (n + v_random_offset) % v_total_tickets + random())
  INTO v_available_tickets
  FROM generate_series(1, v_total_tickets) AS n
  WHERE n != ALL(v_unavailable_set);

  v_available_count := COALESCE(array_length(v_available_tickets, 1), 0);

  -- Check availability
  IF v_available_count = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No tickets available',
      'available_count', 0
    );
  END IF;

  IF v_available_count < p_count THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Insufficient availability',
      'available_count', v_available_count,
      'requested_count', p_count
    );
  END IF;

  -- Select tickets using the randomized array
  v_selected_tickets := v_available_tickets[1:p_count];

  -- Cancel any existing pending reservations for this user on this competition
  -- FIXED: pending_tickets.competition_id is UUID (not TEXT)
  -- Use p_competition_id (UUID) instead of v_competition_id_text (TEXT)
  UPDATE pending_tickets
  SET status = 'cancelled', updated_at = NOW()
  WHERE user_id = p_user_id
    AND competition_id = p_competition_id  -- FIXED: Was v_competition_id_text
    AND status = 'pending';

  -- Generate reservation details
  v_reservation_id := gen_random_uuid();
  v_expires_at := NOW() + make_interval(mins => LEAST(GREATEST(p_hold_minutes, 1), 60));
  v_total_amount := p_count * p_ticket_price;

  -- Create the pending reservation
  -- FIXED: pending_tickets.competition_id is UUID (not TEXT)
  -- Use p_competition_id (UUID) instead of v_competition_id_text (TEXT)
  INSERT INTO pending_tickets (
    id,
    user_id,
    competition_id,
    ticket_numbers,
    ticket_count,
    ticket_price,
    total_amount,
    status,
    session_id,
    expires_at,
    created_at,
    updated_at
  ) VALUES (
    v_reservation_id,
    p_user_id,
    p_competition_id,  -- FIXED: Was v_competition_id_text
    v_selected_tickets,
    p_count,
    p_ticket_price,
    v_total_amount,
    'pending',
    p_session_id,
    v_expires_at,
    NOW(),
    NOW()
  );

  -- Return success with selected tickets
  RETURN jsonb_build_object(
    'success', true,
    'reservation_id', v_reservation_id,
    'ticket_numbers', v_selected_tickets,
    'ticket_count', p_count,
    'total_amount', v_total_amount,
    'expires_at', v_expires_at,
    'available_count_after', v_available_count - p_count
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', 'Failed to allocate tickets: ' || SQLERRM,
    'retryable', true
  );
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION allocate_lucky_dip_tickets_batch(TEXT, UUID, INTEGER, NUMERIC, INTEGER, TEXT, INTEGER[]) TO authenticated;
GRANT EXECUTE ON FUNCTION allocate_lucky_dip_tickets_batch(TEXT, UUID, INTEGER, NUMERIC, INTEGER, TEXT, INTEGER[]) TO service_role;

-- Comments
COMMENT ON FUNCTION allocate_lucky_dip_tickets_batch(TEXT, UUID, INTEGER, NUMERIC, INTEGER, TEXT, INTEGER[]) IS 
'Batch allocation of random tickets with proper type handling.
FIXED: Correct UUID/TEXT comparisons based on ACTUAL schema:
- competitions.id, competitions.uid are UUID
- tickets.competition_id is UUID
- pending_tickets.competition_id is UUID (FIXED - was incorrectly treated as TEXT)
- joincompetition.competitionid is TEXT
Allocates up to 500 tickets per call with randomization and proper locking.';

COMMIT;

-- Log completion
DO $$
BEGIN
  RAISE NOTICE '==============================================';
  RAISE NOTICE 'Fixed UUID = TEXT comparison in allocate_lucky_dip_tickets_batch';
  RAISE NOTICE '==============================================';
  RAISE NOTICE 'Changes made:';
  RAISE NOTICE '  Line 115: WHERE competition_id = p_competition_id (was v_competition_id_text)';
  RAISE NOTICE '  Line 167: AND competition_id = p_competition_id (was v_competition_id_text)';
  RAISE NOTICE '  Line 192: competition_id = p_competition_id (was v_competition_id_text)';
  RAISE NOTICE '';
  RAISE NOTICE 'This fixes the "operator does not exist: uuid = text" error';
  RAISE NOTICE 'by using the UUID parameter directly instead of TEXT conversion';
  RAISE NOTICE '==============================================';
END $$;
