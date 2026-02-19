-- ============================================================================
-- Fisher-Yates Shuffle for Lucky Dip Ticket Allocation
-- ============================================================================
-- This migration replaces PostgreSQL's random() with a deterministic
-- Fisher-Yates shuffle algorithm using VRF seeds for ticket allocation.
-- This ensures the same level of randomness quality as instant win competitions.
-- ============================================================================

BEGIN;

-- ============================================================================
-- Fisher-Yates Shuffle Function
-- ============================================================================
-- Implements the Fisher-Yates shuffle algorithm using a VRF seed
-- This provides deterministic, verifiable randomness for ticket selection
-- ============================================================================

CREATE OR REPLACE FUNCTION fisher_yates_shuffle(
  p_total_tickets INTEGER,
  p_count INTEGER,
  p_vrf_seed TEXT,
  p_excluded_tickets INTEGER[] DEFAULT NULL
)
RETURNS INTEGER[]
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_tickets INTEGER[];
  v_available INTEGER[];
  v_excluded_set INTEGER[];
  v_result INTEGER[];
  v_seed_hash BYTEA;
  v_random_state BIGINT;
  v_random_value BIGINT;
  v_swap_index INTEGER;
  v_temp INTEGER;
  i INTEGER;
  j INTEGER;
BEGIN
  -- Validate inputs
  IF p_total_tickets <= 0 OR p_count <= 0 THEN
    RAISE EXCEPTION 'total_tickets and count must be positive';
  END IF;
  
  IF p_count > p_total_tickets THEN
    RAISE EXCEPTION 'count cannot exceed total_tickets';
  END IF;

  -- Initialize excluded set
  v_excluded_set := COALESCE(p_excluded_tickets, ARRAY[]::INTEGER[]);
  
  -- Build array of available tickets (excluding sold/reserved tickets)
  SELECT array_agg(n)
  INTO v_available
  FROM generate_series(1, p_total_tickets) AS n
  WHERE n != ALL(v_excluded_set);
  
  -- Check if we have enough available tickets
  IF array_length(v_available, 1) < p_count THEN
    RAISE EXCEPTION 'Insufficient available tickets: have %, need %', 
      array_length(v_available, 1), p_count;
  END IF;
  
  -- Create initial seed hash using SHA256
  -- Combine VRF seed with a salt for additional entropy
  v_seed_hash := digest(p_vrf_seed || 'FISHER_YATES_V1', 'sha256');
  
  -- Initialize random state from first 8 bytes of hash
  v_random_state := get_byte(v_seed_hash, 0)::BIGINT << 56 |
                    get_byte(v_seed_hash, 1)::BIGINT << 48 |
                    get_byte(v_seed_hash, 2)::BIGINT << 40 |
                    get_byte(v_seed_hash, 3)::BIGINT << 32 |
                    get_byte(v_seed_hash, 4)::BIGINT << 24 |
                    get_byte(v_seed_hash, 5)::BIGINT << 16 |
                    get_byte(v_seed_hash, 6)::BIGINT << 8 |
                    get_byte(v_seed_hash, 7)::BIGINT;
  
  -- Ensure non-zero state (required for xorshift)
  IF v_random_state = 0 THEN
    v_random_state := 1;
  END IF;
  
  -- Fisher-Yates shuffle (only shuffle first p_count positions)
  FOR i IN 1..p_count LOOP
    -- Generate pseudo-random number using xorshift64
    -- This is a simple but high-quality PRNG
    v_random_state := v_random_state # (v_random_state << 13);
    v_random_state := v_random_state # (v_random_state >> 7);
    v_random_state := v_random_state # (v_random_state << 17);
    
    -- Map to range [i, array_length]
    v_random_value := abs(v_random_state) % (array_length(v_available, 1) - i + 1);
    v_swap_index := i + v_random_value::INTEGER;
    
    -- Swap v_available[i] with v_available[v_swap_index]
    v_temp := v_available[i];
    v_available[i] := v_available[v_swap_index];
    v_available[v_swap_index] := v_temp;
  END LOOP;
  
  -- Return first p_count tickets (these are the selected ones)
  v_result := v_available[1:p_count];
  
  -- Sort the result for consistent ordering
  SELECT array_agg(ticket ORDER BY ticket)
  INTO v_result
  FROM unnest(v_result) AS ticket;
  
  RETURN v_result;
END;
$$;

-- ============================================================================
-- Updated Lucky Dip Allocation Function with Fisher-Yates
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
  v_competition_uid UUID;
  v_competition_id_text TEXT;
  v_selected_tickets INTEGER[];
  v_reservation_id UUID;
  v_expires_at TIMESTAMPTZ;
  v_total_amount DECIMAL;
  v_unavailable_set INTEGER[];
  v_available_count INTEGER;
  v_vrf_seed TEXT;
BEGIN
  -- Convert UUID to TEXT for pending_tickets tables
  v_competition_id_text := p_competition_id::TEXT;

  -- Validate count
  IF p_count < 1 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Count must be at least 1'
    );
  END IF;

  IF p_count > 999 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Count cannot exceed 999 per request',
      'max_batch_size', 999
    );
  END IF;

  -- Get competition details with row lock
  SELECT total_tickets, uid, outcomes_vrf_seed
  INTO v_total_tickets, v_competition_uid, v_vrf_seed
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
  v_unavailable_set := COALESCE(p_excluded_tickets, ARRAY[]::INTEGER[]);

  -- Add sold tickets from joincompetition
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
    WHERE competition_id = v_competition_id_text
      AND status = 'pending'
      AND expires_at > NOW()
      AND user_id != p_user_id
  ) pt;

  -- Remove duplicates
  SELECT array_agg(DISTINCT u) INTO v_unavailable_set
  FROM unnest(v_unavailable_set) AS u
  WHERE u IS NOT NULL;

  v_unavailable_set := COALESCE(v_unavailable_set, ARRAY[]::INTEGER[]);
  
  -- Calculate available count
  v_available_count := v_total_tickets - array_length(v_unavailable_set, 1);

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

  -- Use VRF seed if available, otherwise generate a deterministic seed
  IF v_vrf_seed IS NULL OR v_vrf_seed = '' THEN
    -- Generate deterministic seed from competition ID, user ID, and timestamp
    -- This ensures different users get different tickets for the same competition
    v_vrf_seed := encode(
      digest(
        p_competition_id::TEXT || p_user_id || EXTRACT(EPOCH FROM NOW())::TEXT,
        'sha256'
      ),
      'hex'
    );
  ELSE
    -- Combine competition VRF seed with user ID to ensure different users
    -- get different tickets even with the same VRF seed
    v_vrf_seed := encode(
      digest(v_vrf_seed || p_user_id, 'sha256'),
      'hex'
    );
  END IF;

  -- Use Fisher-Yates shuffle to select tickets
  -- This provides the same level of randomness quality as instant win competitions
  BEGIN
    v_selected_tickets := fisher_yates_shuffle(
      v_total_tickets,
      p_count,
      v_vrf_seed,
      v_unavailable_set
    );
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Failed to allocate tickets: ' || SQLERRM,
      'retryable', true
    );
  END;

  -- Cancel any existing pending reservations for this user on this competition
  UPDATE pending_tickets
  SET status = 'cancelled', updated_at = NOW()
  WHERE user_id = p_user_id
    AND competition_id = v_competition_id_text
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
    v_competition_id_text,
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
    'available_count_after', v_available_count - p_count,
    'algorithm', 'fisher-yates-vrf'
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
GRANT EXECUTE ON FUNCTION fisher_yates_shuffle(INTEGER, INTEGER, TEXT, INTEGER[]) TO authenticated;
GRANT EXECUTE ON FUNCTION fisher_yates_shuffle(INTEGER, INTEGER, TEXT, INTEGER[]) TO service_role;
GRANT EXECUTE ON FUNCTION allocate_lucky_dip_tickets_batch(TEXT, UUID, INTEGER, NUMERIC, INTEGER, TEXT, INTEGER[]) TO authenticated;
GRANT EXECUTE ON FUNCTION allocate_lucky_dip_tickets_batch(TEXT, UUID, INTEGER, NUMERIC, INTEGER, TEXT, INTEGER[]) TO service_role;

-- Update comment
COMMENT ON FUNCTION fisher_yates_shuffle(INTEGER, INTEGER, TEXT, INTEGER[]) IS 
'Implements Fisher-Yates shuffle algorithm using VRF seed for deterministic, verifiable random ticket selection.
Uses xorshift64 PRNG for high-quality randomness. Same algorithm quality as instant win competitions.';

COMMENT ON FUNCTION allocate_lucky_dip_tickets_batch(TEXT, UUID, INTEGER, NUMERIC, INTEGER, TEXT, INTEGER[]) IS 
'Batch allocation of random tickets using Fisher-Yates shuffle with VRF seeds (up to 999 tickets per call).
Provides same randomness quality as instant win competitions using deterministic VRF-based selection.
Accepts pre-excluded tickets to avoid re-querying unavailable tickets.';

COMMIT;
