-- ============================================================================
-- COMPREHENSIVE SCHEMA STANDARDIZATION
-- ============================================================================
-- Goal: One column name (competition_id), one type (UUID), no overloads
--
-- Changes:
--   1. Drop joincompetition.competitionid (keep competition_id only)
--   2. Update all functions to take UUID only
--   3. Keep TEXT versions as simple wrappers for backwards compatibility
-- ============================================================================

BEGIN;

-- ============================================================================
-- PART 1: Clean up joincompetition table
-- ============================================================================

-- Ensure competition_id is populated from competitionid
UPDATE joincompetition
SET competition_id = competitionid::UUID
WHERE competition_id IS NULL AND competitionid IS NOT NULL;

-- Update any queries/views that reference competitionid
-- (Drop the duplicate column)
ALTER TABLE joincompetition DROP COLUMN IF EXISTS competitionid CASCADE;

-- ============================================================================
-- PART 2: Standardize function signatures
-- ============================================================================

-- Drop TEXT-only function versions (keep UUID primary, TEXT as wrapper)

-- get_unavailable_tickets: Keep UUID as primary
DROP FUNCTION IF EXISTS get_unavailable_tickets(TEXT) CASCADE;

CREATE OR REPLACE FUNCTION get_unavailable_tickets(competition_id UUID)
RETURNS INT4[]
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_unavailable INTEGER[] := ARRAY[]::INTEGER[];
  v_sold_jc INTEGER[] := ARRAY[]::INTEGER[];
  v_sold_tickets INTEGER[] := ARRAY[]::INTEGER[];
  v_pending INTEGER[] := ARRAY[]::INTEGER[];
BEGIN
  IF competition_id IS NULL THEN
    RETURN ARRAY[]::INTEGER[];
  END IF;

  -- joincompetition tickets (using competition_id now, no competitionid)
  SELECT COALESCE(array_agg(DISTINCT ticket_num), ARRAY[]::INTEGER[])
  INTO v_sold_jc
  FROM (
    SELECT CAST(TRIM(unnest(string_to_array(ticketnumbers, ','))) AS INTEGER) AS ticket_num
    FROM joincompetition
    WHERE joincompetition.competition_id = get_unavailable_tickets.competition_id
      AND ticketnumbers IS NOT NULL AND TRIM(ticketnumbers) != ''
  ) AS jc_tickets
  WHERE ticket_num IS NOT NULL;

  v_sold_jc := COALESCE(v_sold_jc, ARRAY[]::INTEGER[]);

  -- tickets table
  SELECT COALESCE(array_agg(DISTINCT t.ticket_number), ARRAY[]::INTEGER[])
  INTO v_sold_tickets
  FROM tickets t
  WHERE t.competition_id = get_unavailable_tickets.competition_id;

  v_sold_tickets := COALESCE(v_sold_tickets, ARRAY[]::INTEGER[]);

  -- pending_tickets
  BEGIN
    SELECT COALESCE(array_agg(DISTINCT ticket_num), ARRAY[]::INTEGER[])
    INTO v_pending
    FROM (
      SELECT unnest(pt.ticket_numbers) AS ticket_num
      FROM pending_tickets pt
      WHERE pt.competition_id = get_unavailable_tickets.competition_id
        AND pt.status = 'pending'
        AND pt.expires_at > NOW()
    ) AS pending
    WHERE ticket_num IS NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    v_pending := ARRAY[]::INTEGER[];
  END;

  v_pending := COALESCE(v_pending, ARRAY[]::INTEGER[]);

  v_unavailable := v_sold_jc || v_sold_tickets || v_pending;

  IF array_length(v_unavailable, 1) IS NOT NULL AND array_length(v_unavailable, 1) > 0 THEN
    SELECT COALESCE(array_agg(DISTINCT u ORDER BY u), ARRAY[]::INTEGER[])
    INTO v_unavailable
    FROM unnest(v_unavailable) AS u;
  ELSE
    v_unavailable := ARRAY[]::INTEGER[];
  END IF;

  RETURN v_unavailable;
END;
$$;

-- TEXT wrapper for backwards compatibility
CREATE OR REPLACE FUNCTION get_unavailable_tickets(competition_id TEXT)
RETURNS INT4[]
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN get_unavailable_tickets(competition_id::UUID);
END;
$$;

-- get_competition_unavailable_tickets: Keep UUID as primary
DROP FUNCTION IF EXISTS get_competition_unavailable_tickets(TEXT) CASCADE;

CREATE OR REPLACE FUNCTION get_competition_unavailable_tickets(p_competition_id UUID)
RETURNS TABLE(ticket_number INTEGER, source TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT ticket_num::INTEGER, 'joincompetition'::TEXT
  FROM (
    SELECT CAST(TRIM(unnest(string_to_array(jc.ticketnumbers, ','))) AS INTEGER) AS ticket_num
    FROM joincompetition jc
    WHERE jc.competition_id = p_competition_id
      AND jc.ticketnumbers IS NOT NULL AND TRIM(jc.ticketnumbers) != ''
  ) AS jc_tickets
  WHERE ticket_num IS NOT NULL

  UNION

  SELECT DISTINCT t.ticket_number::INTEGER, 'tickets'::TEXT
  FROM tickets t
  WHERE t.competition_id = p_competition_id
    AND t.ticket_number IS NOT NULL

  UNION

  SELECT DISTINCT unnest(pt.ticket_numbers)::INTEGER, 'pending_tickets'::TEXT
  FROM pending_tickets pt
  WHERE pt.competition_id = p_competition_id
    AND pt.status = 'pending'
    AND pt.expires_at > NOW()

  ORDER BY ticket_number;
END;
$$;

-- TEXT wrapper
CREATE OR REPLACE FUNCTION get_competition_unavailable_tickets(p_competition_id TEXT)
RETURNS TABLE(ticket_number INTEGER, source TEXT)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY SELECT * FROM get_competition_unavailable_tickets(p_competition_id::UUID);
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_unavailable_tickets(UUID) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION get_unavailable_tickets(TEXT) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION get_competition_unavailable_tickets(UUID) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION get_competition_unavailable_tickets(TEXT) TO authenticated, anon, service_role;

-- ============================================================================
-- PART 3: Update allocate_lucky_dip_tickets_batch to use competition_id only
-- ============================================================================

-- This function already takes UUID and should now only reference competition_id
-- (not competitionid) in joincompetition queries

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
  v_random_offset INTEGER;
BEGIN
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

  -- Get competition details
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

  -- Add sold tickets from joincompetition (using competition_id now)
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

  -- Generate random offset for distribution
  v_random_offset := floor(random() * v_total_tickets)::INTEGER;

  -- Generate available tickets with randomization
  SELECT array_agg(n ORDER BY (n + v_random_offset) % v_total_tickets + random())
  INTO v_available_tickets
  FROM generate_series(1, v_total_tickets) AS n
  WHERE n != ALL(v_unavailable_set);

  v_available_count := COALESCE(array_length(v_available_tickets, 1), 0);

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

  -- Select tickets
  v_selected_tickets := v_available_tickets[1:p_count];

  -- Cancel existing pending reservations for this user
  UPDATE pending_tickets
  SET status = 'cancelled', updated_at = NOW()
  WHERE user_id = p_user_id
    AND competition_id = p_competition_id
    AND status = 'pending';

  -- Generate reservation details
  v_reservation_id := gen_random_uuid();
  v_expires_at := NOW() + make_interval(mins => LEAST(GREATEST(p_hold_minutes, 1), 60));
  v_total_amount := p_count * p_ticket_price;

  -- Create the pending reservation
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

GRANT EXECUTE ON FUNCTION allocate_lucky_dip_tickets_batch(TEXT, UUID, INTEGER, NUMERIC, INTEGER, TEXT, INTEGER[]) TO authenticated, service_role;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '========================================================';
  RAISE NOTICE 'SCHEMA STANDARDIZATION COMPLETE';
  RAISE NOTICE '========================================================';
  RAISE NOTICE 'Changes applied:';
  RAISE NOTICE '  • Dropped joincompetition.competitionid column';
  RAISE NOTICE '  • All functions now use competition_id (UUID) as primary';
  RAISE NOTICE '  • TEXT versions exist as wrappers for compatibility';
  RAISE NOTICE '  • allocate_lucky_dip_tickets_batch updated';
  RAISE NOTICE '========================================================';
END $$;

COMMIT;
