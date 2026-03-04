-- ============================================================================
-- FIX: allocate_lucky_dip_tickets_batch - Proper Random Distribution
-- ============================================================================
-- Issue: Lucky dip purchases are allocating consecutive ticket blocks
-- Root Cause: The randomization uses offset + modulo which produces patterns
-- Solution: Use pure random() shuffling for proper distribution
-- ============================================================================

DROP FUNCTION IF EXISTS allocate_lucky_dip_tickets_batch(TEXT, UUID, INTEGER, NUMERIC, INTEGER, TEXT, INTEGER[]) CASCADE;

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
  v_available_tickets INTEGER[];
  v_selected_tickets INTEGER[];
  v_reservation_id UUID;
  v_expires_at TIMESTAMPTZ;
  v_total_amount DECIMAL;
  v_unavailable_set INTEGER[];
  v_available_count INTEGER;
BEGIN
  -- Validate count
  IF p_count < 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Count must be at least 1');
  END IF;

  IF p_count > 500 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Count cannot exceed 500 per batch. Use multiple batches for larger purchases.',
      'max_batch_size', 500
    );
  END IF;

  -- Get competition details with row lock
  SELECT total_tickets
  INTO v_total_tickets
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

  -- Build set of unavailable tickets from all sources
  v_unavailable_set := COALESCE(p_excluded_tickets, ARRAY[]::INTEGER[]);

  -- Add sold tickets from joincompetition (using competition_id column)
  SELECT v_unavailable_set || COALESCE(array_agg(DISTINCT ticket_num), ARRAY[]::INTEGER[])
  INTO v_unavailable_set
  FROM (
    SELECT CAST(trim(unnest(string_to_array(ticketnumbers, ','))) AS INTEGER) AS ticket_num
    FROM joincompetition
    WHERE competition_id = p_competition_id
      AND ticketnumbers IS NOT NULL
      AND trim(ticketnumbers) != ''
  ) jc_tickets
  WHERE ticket_num IS NOT NULL AND ticket_num >= 1 AND ticket_num <= v_total_tickets;

  -- Add sold tickets from tickets table
  SELECT v_unavailable_set || COALESCE(array_agg(ticket_number), ARRAY[]::INTEGER[])
  INTO v_unavailable_set
  FROM tickets
  WHERE competition_id = p_competition_id
    AND ticket_number IS NOT NULL;

  -- Add pending tickets from other users
  SELECT v_unavailable_set || COALESCE(array_agg(ticket_num), ARRAY[]::INTEGER[])
  INTO v_unavailable_set
  FROM (
    SELECT unnest(ticket_numbers) AS ticket_num
    FROM pending_tickets
    WHERE competition_id = p_competition_id
      AND status = 'pending'
      AND expires_at > NOW()
      AND user_id != p_user_id
  ) pt;

  -- Remove duplicates
  SELECT array_agg(DISTINCT u) INTO v_unavailable_set
  FROM unnest(v_unavailable_set) AS u
  WHERE u IS NOT NULL;

  v_unavailable_set := COALESCE(v_unavailable_set, ARRAY[]::INTEGER[]);

  -- ============================================================================
  -- CRITICAL FIX: Use pure random() for proper distribution
  -- This replaces the offset + modulo approach that was causing consecutive blocks
  -- ============================================================================
  SELECT array_agg(n ORDER BY random())
  INTO v_available_tickets
  FROM generate_series(1, v_total_tickets) AS n
  WHERE n != ALL(v_unavailable_set);
  -- ============================================================================

  v_available_count := COALESCE(array_length(v_available_tickets, 1), 0);

  -- Check availability
  IF v_available_count = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'No tickets available', 'available_count', 0);
  END IF;

  IF v_available_count < p_count THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Insufficient availability',
      'available_count', v_available_count,
      'requested_count', p_count
    );
  END IF;

  -- Select first p_count tickets from the randomized array
  v_selected_tickets := v_available_tickets[1:p_count];

  -- Cancel any existing pending reservations for this user
  UPDATE pending_tickets
  SET status = 'cancelled', updated_at = NOW()
  WHERE user_id = p_user_id
    AND competition_id = p_competition_id
    AND status = 'pending';

  -- Generate reservation
  v_reservation_id := gen_random_uuid();
  v_expires_at := NOW() + make_interval(mins => LEAST(GREATEST(p_hold_minutes, 1), 60));
  v_total_amount := p_count * p_ticket_price;

  -- Create pending reservation
  INSERT INTO pending_tickets (
    id, user_id, competition_id, ticket_numbers, ticket_count,
    ticket_price, total_amount, status, session_id,
    expires_at, created_at, updated_at
  ) VALUES (
    v_reservation_id,
    p_user_id,
    p_competition_id,
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
GRANT EXECUTE ON FUNCTION allocate_lucky_dip_tickets_batch(TEXT, UUID, INTEGER, NUMERIC, INTEGER, TEXT, INTEGER[]) TO anon;

-- Add comment documenting the fix
COMMENT ON FUNCTION allocate_lucky_dip_tickets_batch(TEXT, UUID, INTEGER, NUMERIC, INTEGER, TEXT, INTEGER[]) IS
'Fixed: Now uses ORDER BY random() for proper random distribution of lucky dip tickets.
Previous implementation used offset + modulo which caused consecutive ticket blocks.
This ensures true random selection across the available ticket pool.';

-- Verification
DO $$
BEGIN
  RAISE NOTICE '========================================================';
  RAISE NOTICE 'FIXED: allocate_lucky_dip_tickets_batch';
  RAISE NOTICE 'Change: Replaced offset+modulo with pure random() shuffle';
  RAISE NOTICE 'Result: Lucky dip now selects truly random tickets';
  RAISE NOTICE '========================================================';
END $$;
