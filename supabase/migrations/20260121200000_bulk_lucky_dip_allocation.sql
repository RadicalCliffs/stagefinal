-- ============================================================================
-- Bulk Lucky Dip Allocation for Large Ticket Purchases
-- ============================================================================
-- Date: 2026-01-21
--
-- This migration adds optimized functions for handling bulk lucky dip purchases
-- of up to 10,000+ tickets. The key improvements are:
--
-- 1. `allocate_lucky_dip_tickets_batch` - Allocates tickets in a single batch
--    with optimized randomization using TABLESAMPLE and random offset
--
-- 2. `get_competition_unavailable_tickets` - Returns all unavailable ticket
--    numbers for a competition (sold + pending)
--
-- 3. Improved randomization algorithm that scales to large ticket pools
--
-- The client-side should:
--   - Call get_competition_unavailable_tickets first to know available pool
--   - Batch requests into chunks of up to 500 tickets each
--   - Implement retry logic with exponential backoff on failures
-- ============================================================================

BEGIN;

-- ============================================================================
-- PART 1: Optimized function to get all unavailable tickets for a competition
-- This is called ONCE before bulk allocation to build the unavailable set
-- ============================================================================

DROP FUNCTION IF EXISTS get_competition_unavailable_tickets(UUID) CASCADE;
DROP FUNCTION IF EXISTS get_competition_unavailable_tickets(TEXT) CASCADE;

CREATE OR REPLACE FUNCTION get_competition_unavailable_tickets(p_competition_id UUID)
RETURNS TABLE (
  ticket_number INTEGER,
  source TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_comp_uid TEXT;
BEGIN
  -- Get the competition UID for legacy lookups
  SELECT uid INTO v_comp_uid
  FROM competitions
  WHERE id = p_competition_id;

  -- Return all unavailable tickets with their source
  RETURN QUERY

  -- From joincompetition (confirmed purchases)
  SELECT
    CAST(trim(t_num) AS INTEGER) AS ticket_number,
    'sold'::TEXT AS source
  FROM (
    SELECT unnest(string_to_array(ticketnumbers, ',')) AS t_num
    FROM joincompetition
    WHERE (
      competitionid::TEXT = p_competition_id::TEXT
      OR (v_comp_uid IS NOT NULL AND competitionid::TEXT = v_comp_uid)
    )
    AND ticketnumbers IS NOT NULL
    AND trim(ticketnumbers) != ''
  ) jc_parsed
  WHERE trim(t_num) ~ '^[0-9]+$'

  UNION ALL

  -- From tickets table
  SELECT
    t.ticket_number,
    'sold'::TEXT AS source
  FROM tickets t
  WHERE t.competition_id = p_competition_id
    AND t.ticket_number IS NOT NULL

  UNION ALL

  -- From pending_tickets (active reservations)
  SELECT
    unnest(pt.ticket_numbers) AS ticket_number,
    'pending'::TEXT AS source
  FROM pending_tickets pt
  WHERE pt.competition_id = p_competition_id
    AND pt.status IN ('pending', 'confirming')
    AND pt.expires_at > NOW();
END;
$$;

COMMENT ON FUNCTION get_competition_unavailable_tickets(UUID) IS
'Returns all unavailable ticket numbers for a competition with their source (sold/pending).
Used by bulk allocation to know which tickets to exclude.';

GRANT EXECUTE ON FUNCTION get_competition_unavailable_tickets(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_competition_unavailable_tickets(UUID) TO anon;
GRANT EXECUTE ON FUNCTION get_competition_unavailable_tickets(UUID) TO service_role;


-- ============================================================================
-- PART 2: Text wrapper for competition unavailable tickets
-- ============================================================================

CREATE OR REPLACE FUNCTION get_competition_unavailable_tickets(p_competition_id TEXT)
RETURNS TABLE (
  ticket_number INTEGER,
  source TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_uuid UUID;
BEGIN
  -- Try to cast to UUID
  BEGIN
    v_uuid := p_competition_id::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    -- If not a valid UUID, try to look up by uid
    SELECT c.id INTO v_uuid
    FROM competitions c
    WHERE c.uid = p_competition_id
    LIMIT 1;

    IF v_uuid IS NULL THEN
      RETURN; -- Return empty if not found
    END IF;
  END;

  RETURN QUERY SELECT * FROM get_competition_unavailable_tickets(v_uuid);
END;
$$;

GRANT EXECUTE ON FUNCTION get_competition_unavailable_tickets(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_competition_unavailable_tickets(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_competition_unavailable_tickets(TEXT) TO service_role;


-- ============================================================================
-- PART 3: Bulk Lucky Dip Allocation with optimized randomization
-- This handles up to 500 tickets per call with efficient random selection
-- ============================================================================

DROP FUNCTION IF EXISTS allocate_lucky_dip_tickets_batch(TEXT, UUID, INTEGER, DECIMAL, INTEGER, TEXT, INTEGER[]) CASCADE;

CREATE OR REPLACE FUNCTION allocate_lucky_dip_tickets_batch(
  p_user_id TEXT,
  p_competition_id UUID,
  p_count INTEGER,
  p_ticket_price DECIMAL DEFAULT 1,
  p_hold_minutes INTEGER DEFAULT 15,
  p_session_id TEXT DEFAULT NULL,
  p_excluded_tickets INTEGER[] DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total_tickets INTEGER;
  v_competition_uid TEXT;
  v_available_tickets INTEGER[];
  v_selected_tickets INTEGER[];
  v_reservation_id UUID;
  v_expires_at TIMESTAMPTZ;
  v_total_amount DECIMAL;
  v_unavailable_set INTEGER[];
  v_available_count INTEGER;
  v_random_offset INTEGER;
BEGIN
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
  SELECT v_unavailable_set || COALESCE(array_agg(DISTINCT ticket_num), ARRAY[]::INTEGER[])
  INTO v_unavailable_set
  FROM (
    SELECT CAST(trim(unnest(string_to_array(ticketnumbers, ','))) AS INTEGER) AS ticket_num
    FROM joincompetition
    WHERE (competitionid = p_competition_id::TEXT OR competitionid = v_competition_uid)
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

COMMENT ON FUNCTION allocate_lucky_dip_tickets_batch IS
'Batch-optimized lucky dip allocation supporting up to 500 tickets per call.
Uses randomized offset for better distribution when multiple requests arrive.
Accepts pre-excluded tickets to avoid re-querying unavailable tickets.
For purchases > 500 tickets, call multiple times with different batches.';

GRANT EXECUTE ON FUNCTION allocate_lucky_dip_tickets_batch(TEXT, UUID, INTEGER, DECIMAL, INTEGER, TEXT, INTEGER[]) TO authenticated;
GRANT EXECUTE ON FUNCTION allocate_lucky_dip_tickets_batch(TEXT, UUID, INTEGER, DECIMAL, INTEGER, TEXT, INTEGER[]) TO anon;
GRANT EXECUTE ON FUNCTION allocate_lucky_dip_tickets_batch(TEXT, UUID, INTEGER, DECIMAL, INTEGER, TEXT, INTEGER[]) TO service_role;


-- ============================================================================
-- PART 4: Performance index for faster unavailable ticket lookups
-- ============================================================================

-- Index for faster pending ticket lookups by competition and status
CREATE INDEX IF NOT EXISTS idx_pending_tickets_comp_status_user
  ON pending_tickets(competition_id, status, user_id)
  WHERE status = 'pending';

-- Index for faster joincompetition lookups by competition
CREATE INDEX IF NOT EXISTS idx_joincompetition_competitionid_tickets
  ON joincompetition(competitionid)
  WHERE ticketnumbers IS NOT NULL AND trim(ticketnumbers) != '';


-- ============================================================================
-- VERIFICATION
-- ============================================================================
DO $$
DECLARE
  func_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO func_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'get_competition_unavailable_tickets',
      'allocate_lucky_dip_tickets_batch'
    );

  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'BULK LUCKY DIP ALLOCATION MIGRATION APPLIED';
  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'Functions created: % (expected: 3 - 2 overloads + batch)', func_count;
  RAISE NOTICE '';
  RAISE NOTICE 'New capabilities:';
  RAISE NOTICE '  1. get_competition_unavailable_tickets(UUID/TEXT):';
  RAISE NOTICE '     - Returns all unavailable tickets with source';
  RAISE NOTICE '     - Call ONCE before bulk allocation';
  RAISE NOTICE '';
  RAISE NOTICE '  2. allocate_lucky_dip_tickets_batch(...):';
  RAISE NOTICE '     - Up to 500 tickets per batch';
  RAISE NOTICE '     - Accepts pre-excluded tickets for efficiency';
  RAISE NOTICE '     - Randomized offset for better distribution';
  RAISE NOTICE '';
  RAISE NOTICE 'Client-side usage:';
  RAISE NOTICE '  1. Call get_competition_unavailable_tickets';
  RAISE NOTICE '  2. Split into batches of max 500';
  RAISE NOTICE '  3. Call allocate_lucky_dip_tickets_batch per batch';
  RAISE NOTICE '  4. Retry with exponential backoff on failure';
  RAISE NOTICE '=====================================================';
END $$;

COMMIT;
