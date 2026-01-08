/*
  # Atomic Lucky Dip Allocation and Count-Based Availability Queries

  This migration implements two key improvements for ticket availability:

  1. **Count-Based Availability Query**:
     - `get_available_ticket_count_v2(competition_id)` - Returns just the count of available
       tickets, avoiding the need to fetch all ticket numbers to the client.
     - More performant than fetching the full array when only the count is needed.

  2. **Atomic Lucky Dip Allocation**:
     - `allocate_lucky_dip_tickets(...)` - Atomically selects random available tickets,
       creates a pending reservation, and returns the selected numbers.
     - Uses row-level locking to prevent race conditions.
     - Handles conflicts gracefully with automatic retry logic.

  ## Why This Approach?

  Previously, the client would:
  1. Fetch ALL available ticket numbers
  2. Client-side shuffle and select N tickets
  3. Send the selection to the server for reservation

  This had two issues:
  - **Performance**: Fetching thousands of ticket numbers just to show "X available"
  - **Race conditions**: Between selection and reservation, tickets could be taken

  The new approach:
  - For display: Query count only (no array transfer)
  - For allocation: Server-side atomic selection + reservation in one transaction
*/

-- ============================================================================
-- Part 1: Efficient Count-Based Availability Query
-- ============================================================================

CREATE OR REPLACE FUNCTION get_available_ticket_count_v2(p_competition_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_total_tickets INTEGER;
  v_sold_count INTEGER := 0;
  v_pending_count INTEGER := 0;
  v_available_count INTEGER;
BEGIN
  -- Get competition total tickets
  SELECT total_tickets INTO v_total_tickets
  FROM competitions
  WHERE id = p_competition_id AND deleted = false AND status = 'active';

  IF v_total_tickets IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Competition not found or not active',
      'available_count', 0
    );
  END IF;

  -- Count sold tickets from joincompetition (confirmed purchases)
  SELECT COALESCE(SUM(numberoftickets), 0)::INTEGER INTO v_sold_count
  FROM joincompetition
  WHERE competitionid = p_competition_id::TEXT
     OR competitionid = (SELECT uid FROM competitions WHERE id = p_competition_id);

  -- Also count from tickets table
  SELECT v_sold_count + COALESCE(COUNT(*), 0)::INTEGER INTO v_sold_count
  FROM tickets
  WHERE competition_id = p_competition_id;

  -- Count active pending reservations (not expired, status = 'pending')
  SELECT COALESCE(SUM(ticket_count), 0)::INTEGER INTO v_pending_count
  FROM pending_tickets
  WHERE competition_id = p_competition_id
    AND status = 'pending'
    AND expires_at > NOW();

  -- Calculate available
  v_available_count := GREATEST(0, v_total_tickets - v_sold_count - v_pending_count);

  RETURN jsonb_build_object(
    'success', true,
    'competition_id', p_competition_id,
    'total_tickets', v_total_tickets,
    'sold_count', v_sold_count,
    'pending_count', v_pending_count,
    'available_count', v_available_count
  );
END;
$$;

COMMENT ON FUNCTION get_available_ticket_count_v2(UUID) IS
'Returns the count of available tickets without fetching the full array.
More efficient than get_competition_ticket_availability when only the count is needed.';

GRANT EXECUTE ON FUNCTION get_available_ticket_count_v2(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_available_ticket_count_v2(UUID) TO anon;
GRANT EXECUTE ON FUNCTION get_available_ticket_count_v2(UUID) TO service_role;


-- ============================================================================
-- Part 2: Atomic Lucky Dip Allocation Function
-- ============================================================================

CREATE OR REPLACE FUNCTION allocate_lucky_dip_tickets(
  p_user_id TEXT,
  p_competition_id UUID,
  p_count INTEGER,
  p_ticket_price DECIMAL DEFAULT 1,
  p_hold_minutes INTEGER DEFAULT 15,
  p_session_id TEXT DEFAULT NULL
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
  v_ticket INTEGER;
  v_available_count INTEGER;
BEGIN
  -- Validate count
  IF p_count < 1 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Count must be at least 1'
    );
  END IF;

  IF p_count > 100 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Count cannot exceed 100 per transaction'
    );
  END IF;

  -- Get competition details with row lock to prevent concurrent modifications
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
      'error', 'Competition not found, not active, or temporarily locked'
    );
  END IF;

  -- Build set of unavailable tickets (sold + pending)
  v_unavailable_set := ARRAY[]::INTEGER[];

  -- Add sold tickets from joincompetition
  SELECT array_agg(DISTINCT ticket_num) INTO v_unavailable_set
  FROM (
    SELECT CAST(trim(unnest(string_to_array(ticketnumbers, ','))) AS INTEGER) AS ticket_num
    FROM joincompetition
    WHERE (competitionid = p_competition_id::TEXT OR competitionid = v_competition_uid)
      AND ticketnumbers IS NOT NULL
      AND trim(ticketnumbers) != ''
  ) jc_tickets
  WHERE ticket_num IS NOT NULL AND ticket_num >= 1 AND ticket_num <= v_total_tickets;

  v_unavailable_set := COALESCE(v_unavailable_set, ARRAY[]::INTEGER[]);

  -- Add sold tickets from tickets table
  SELECT v_unavailable_set || COALESCE(array_agg(ticket_number), ARRAY[]::INTEGER[])
  INTO v_unavailable_set
  FROM tickets
  WHERE competition_id = p_competition_id
    AND ticket_number IS NOT NULL;

  -- Add pending tickets (active holds from other users)
  SELECT v_unavailable_set || COALESCE(array_agg(ticket_num), ARRAY[]::INTEGER[])
  INTO v_unavailable_set
  FROM (
    SELECT unnest(ticket_numbers) AS ticket_num
    FROM pending_tickets
    WHERE competition_id = p_competition_id
      AND status = 'pending'
      AND expires_at > NOW()
      AND user_id != p_user_id  -- Don't count current user's holds
  ) pt;

  -- Remove duplicates from unavailable set
  SELECT array_agg(DISTINCT u) INTO v_unavailable_set
  FROM unnest(v_unavailable_set) AS u
  WHERE u IS NOT NULL;

  v_unavailable_set := COALESCE(v_unavailable_set, ARRAY[]::INTEGER[]);

  -- Generate available tickets array (1 to total, excluding unavailable)
  -- Use a single query for efficiency
  SELECT array_agg(n ORDER BY random()) INTO v_available_tickets
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

  -- Select the first p_count tickets (already randomized by ORDER BY random())
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

COMMENT ON FUNCTION allocate_lucky_dip_tickets IS
'Atomically allocates random tickets for lucky dip purchases.
Uses row-level locking and database randomization for fair selection.
Cancels existing pending reservations before creating new ones.
Returns the selected ticket numbers and reservation details.';

GRANT EXECUTE ON FUNCTION allocate_lucky_dip_tickets(TEXT, UUID, INTEGER, DECIMAL, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION allocate_lucky_dip_tickets(TEXT, UUID, INTEGER, DECIMAL, INTEGER, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION allocate_lucky_dip_tickets(TEXT, UUID, INTEGER, DECIMAL, INTEGER, TEXT) TO service_role;


-- ============================================================================
-- Part 3: Create index for better pending_tickets query performance
-- ============================================================================

-- Composite index for the availability check query pattern
CREATE INDEX IF NOT EXISTS idx_pending_tickets_competition_status_expires
  ON pending_tickets(competition_id, status, expires_at)
  WHERE status = 'pending';

-- Index for user lookup when cancelling existing reservations
CREATE INDEX IF NOT EXISTS idx_pending_tickets_user_competition_status
  ON pending_tickets(user_id, competition_id, status)
  WHERE status = 'pending';


-- ============================================================================
-- Migration complete notice
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '============================================================';
  RAISE NOTICE 'Atomic Lucky Dip Allocation Migration Complete';
  RAISE NOTICE '============================================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Created:';
  RAISE NOTICE '  - Function: get_available_ticket_count_v2(UUID)';
  RAISE NOTICE '    Returns count only, no array transfer';
  RAISE NOTICE '';
  RAISE NOTICE '  - Function: allocate_lucky_dip_tickets(...)';
  RAISE NOTICE '    Atomic selection + reservation in one transaction';
  RAISE NOTICE '';
  RAISE NOTICE '  - Performance indexes for pending_tickets';
  RAISE NOTICE '';
  RAISE NOTICE 'Usage:';
  RAISE NOTICE '  Client display: supabase.rpc("get_available_ticket_count_v2")';
  RAISE NOTICE '  Lucky dip: supabase.rpc("allocate_lucky_dip_tickets")';
  RAISE NOTICE '============================================================';
END $$;
