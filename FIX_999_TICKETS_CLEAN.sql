-- ============================================================================
-- CLEAN FIX: 999 Ticket Allocation (removes all old versions first)
-- ============================================================================

BEGIN;

-- Drop ALL possible function overloads with CASCADE to remove dependencies
DROP FUNCTION IF EXISTS allocate_lucky_dip_tickets_batch(TEXT, TEXT, INTEGER, NUMERIC, INTEGER, TEXT, INTEGER[]) CASCADE;
DROP FUNCTION IF EXISTS allocate_lucky_dip_tickets_batch(TEXT, UUID, INTEGER, NUMERIC, INTEGER, TEXT, INTEGER[]) CASCADE;
DROP FUNCTION IF EXISTS allocate_lucky_dip_tickets_batch(TEXT, UUID, INTEGER) CASCADE;
DROP FUNCTION IF EXISTS allocate_lucky_dip_tickets_batch(TEXT, TEXT, INTEGER) CASCADE;
DROP FUNCTION IF EXISTS allocate_lucky_dip_tickets_batch CASCADE;

-- Create clean version with correct signature
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
  v_selected_tickets INTEGER[];
  v_reservation_id UUID;
  v_expires_at TIMESTAMPTZ;
  v_total_amount DECIMAL;
  v_unavailable_set INTEGER[];
  v_unavailable_count INTEGER;
  v_attempt_count INTEGER := 0;
  v_max_attempts INTEGER;
  v_candidate INTEGER;
  v_selected_count INTEGER;
BEGIN

  -- Validate count
  IF p_count < 1 OR p_count > 999 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Count must be between 1 and 999 (got %s)', p_count)
    );
  END IF;

  -- Set max attempts (3x the requested count)
  v_max_attempts := p_count * 3;

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

  -- Build set of unavailable tickets
  v_unavailable_set := COALESCE(p_excluded_tickets, ARRAY[]::INTEGER[]);

  -- Add sold tickets from joincompetition (cast both sides to handle type mismatches)
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

  -- Add sold tickets from tickets table (cast both sides to handle type mismatches)
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

  -- Deduplicate
  SELECT array_agg(DISTINCT u) INTO v_unavailable_set
  FROM unnest(v_unavailable_set) AS u
  WHERE u IS NOT NULL;

  v_unavailable_set := COALESCE(v_unavailable_set, ARRAY[]::INTEGER[]);
  v_unavailable_count := COALESCE(array_length(v_unavailable_set, 1), 0);

  -- Check basic availability
  IF v_total_tickets - v_unavailable_count < p_count THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Insufficient availability',
      'available_count', v_total_tickets - v_unavailable_count,
      'requested_count', p_count
    );
  END IF;

  -- OPTIMIZED: Random sampling (O(n) where n = requested tickets)
  v_selected_tickets := ARRAY[]::INTEGER[];
  v_selected_count := 0;
  
  WHILE v_selected_count < p_count AND v_attempt_count < v_max_attempts LOOP
    v_attempt_count := v_attempt_count + 1;
    
    -- Generate random ticket number
    v_candidate := floor(random() * v_total_tickets)::INTEGER + 1;
    
    -- Check if available
    IF NOT (v_candidate = ANY(v_unavailable_set)) 
       AND NOT (v_candidate = ANY(v_selected_tickets)) THEN
      v_selected_tickets := v_selected_tickets || v_candidate;
      v_selected_count := v_selected_count + 1;
    END IF;
  END LOOP;

  -- Verify we got enough tickets
  IF v_selected_count < p_count THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Could not allocate %s tickets after %s attempts', p_count, v_attempt_count),
      'retryable', true
    );
  END IF;

  -- Cancel existing pending reservations for this user
  UPDATE pending_tickets
  SET status = 'cancelled', updated_at = NOW()
  WHERE user_id = p_user_id
    AND competition_id = p_competition_id
    AND status = 'pending';

  -- Create reservation
  v_reservation_id := gen_random_uuid();
  v_expires_at := NOW() + make_interval(mins => LEAST(GREATEST(p_hold_minutes, 1), 60));
  v_total_amount := p_count * p_ticket_price;

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
    'attempts_needed', v_attempt_count,
    'available_count_after', v_total_tickets - v_unavailable_count - p_count
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', 'Failed to allocate tickets: ' || SQLERRM,
    'error_detail', SQLSTATE,
    'retryable', true
  );
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION allocate_lucky_dip_tickets_batch(TEXT, UUID, INTEGER, NUMERIC, INTEGER, TEXT, INTEGER[]) TO authenticated;
GRANT EXECUTE ON FUNCTION allocate_lucky_dip_tickets_batch(TEXT, UUID, INTEGER, NUMERIC, INTEGER, TEXT, INTEGER[]) TO service_role;
GRANT EXECUTE ON FUNCTION allocate_lucky_dip_tickets_batch(TEXT, UUID, INTEGER, NUMERIC, INTEGER, TEXT, INTEGER[]) TO anon;

COMMIT;

-- Verify
SELECT 'SUCCESS: allocate_lucky_dip_tickets_batch recreated with optimized algorithm' AS status;
