-- ============================================================================
-- FIX: Column reference bug in jc_sold CTE
-- ============================================================================

DROP FUNCTION IF EXISTS public.allocate_lucky_dip_tickets_batch CASCADE;

CREATE OR REPLACE FUNCTION public.allocate_lucky_dip_tickets_batch(
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
  v_sold_from_jc INTEGER[];
  v_sold_from_tickets INTEGER[];
  v_sold_from_pending INTEGER[];
  v_all_unavailable INTEGER[];
  v_available_tickets INTEGER[];
  v_selected_tickets INTEGER[];
  v_reservation_id UUID;
  v_expires_at TIMESTAMPTZ;
  v_total_amount DECIMAL;
  v_available_count INTEGER;
  v_random_offset INTEGER;
BEGIN
  -- Validate inputs
  IF p_count < 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Count must be at least 1');
  END IF;
  IF p_count > 500 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Count cannot exceed 500 per batch', 'max_batch_size', 500);
  END IF;

  -- Get competition details
  SELECT total_tickets INTO v_total_tickets
  FROM competitions
  WHERE id = p_competition_id AND deleted = false AND status = 'active'
  FOR UPDATE SKIP LOCKED;

  IF v_total_tickets IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Competition not found, not active, or temporarily locked', 'retryable', true);
  END IF;

  -- Start with excluded tickets
  v_all_unavailable := COALESCE(p_excluded_tickets, ARRAY[]::INTEGER[]);

  -- Get sold from joincompetition (EXPLICIT: using competition_id column, NOT competitionid)
  WITH jc_sold AS (
    SELECT unnest(string_to_array(ticketnumbers, ',')) AS num_text
    FROM joincompetition
    WHERE competition_id = p_competition_id
      AND ticketnumbers IS NOT NULL
      AND ticketnumbers != ''
  )
  SELECT COALESCE(array_agg(DISTINCT CAST(TRIM(num_text) AS INTEGER)), ARRAY[]::INTEGER[]) INTO v_sold_from_jc
  FROM jc_sold
  WHERE num_text ~ '^\s*\d+\s*$'
    AND CAST(TRIM(num_text) AS INTEGER) BETWEEN 1 AND v_total_tickets;

  -- Get sold from tickets table
  SELECT COALESCE(array_agg(ticket_number), ARRAY[]::INTEGER[]) INTO v_sold_from_tickets
  FROM tickets
  WHERE competition_id = p_competition_id AND ticket_number IS NOT NULL;

  -- Get pending from other users
  WITH pending_nums AS (
    SELECT unnest(ticket_numbers) AS ticket_num
    FROM pending_tickets
    WHERE competition_id = p_competition_id
      AND status = 'pending'
      AND expires_at > NOW()
      AND user_id != p_user_id
  )
  SELECT COALESCE(array_agg(ticket_num), ARRAY[]::INTEGER[]) INTO v_sold_from_pending
  FROM pending_nums;

  -- Combine all unavailable
  v_all_unavailable := v_all_unavailable || v_sold_from_jc || v_sold_from_tickets || v_sold_from_pending;

  -- Deduplicate
  SELECT COALESCE(array_agg(DISTINCT u), ARRAY[]::INTEGER[]) INTO v_all_unavailable
  FROM unnest(v_all_unavailable) AS u
  WHERE u IS NOT NULL;

  -- Generate available tickets with randomization
  v_random_offset := floor(random() * v_total_tickets)::INTEGER;
  SELECT array_agg(ticket_num ORDER BY (ticket_num + v_random_offset) % v_total_tickets + random()) INTO v_available_tickets
  FROM generate_series(1, v_total_tickets) AS ticket_num
  WHERE ticket_num != ALL(v_all_unavailable);

  v_available_count := COALESCE(array_length(v_available_tickets, 1), 0);

  IF v_available_count = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'No tickets available', 'available_count', 0);
  END IF;
  IF v_available_count < p_count THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient availability', 'available_count', v_available_count, 'requested_count', p_count);
  END IF;

  -- Select tickets
  v_selected_tickets := v_available_tickets[1:p_count];

  -- Cancel existing pending for this user
  UPDATE pending_tickets
  SET status = 'cancelled', updated_at = NOW()
  WHERE user_id = p_user_id AND competition_id = p_competition_id AND status = 'pending';

  -- Create reservation
  v_reservation_id := gen_random_uuid();
  v_expires_at := NOW() + make_interval(mins => LEAST(GREATEST(p_hold_minutes, 1), 60));
  v_total_amount := p_count * p_ticket_price;

  INSERT INTO pending_tickets (
    id, user_id, competition_id, ticket_numbers, ticket_count,
    ticket_price, total_amount, status, session_id,
    expires_at, created_at, updated_at
  ) VALUES (
    v_reservation_id, p_user_id, p_competition_id, v_selected_tickets, p_count,
    p_ticket_price, v_total_amount, 'pending', p_session_id,
    v_expires_at, NOW(), NOW()
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
  RETURN jsonb_build_object('success', false, 'error', 'Failed to allocate tickets: ' || SQLERRM, 'retryable', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.allocate_lucky_dip_tickets_batch(TEXT, UUID, INTEGER, NUMERIC, INTEGER, TEXT, INTEGER[]) TO authenticated, service_role, anon;

DO $$
BEGIN
  RAISE NOTICE '========================================================';
  RAISE NOTICE 'FIXED: Column reference bug (num -> num_text)';
  RAISE NOTICE 'allocate_lucky_dip_tickets_batch now using competition_id';
  RAISE NOTICE '========================================================';
END $$;
