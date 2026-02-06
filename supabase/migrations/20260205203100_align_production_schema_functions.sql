-- ============================================================================
-- CRITICAL: Align Database Functions with Production Schema
-- ============================================================================
-- Issue: Function signature mismatches causing PGRST203 errors and 500 errors
-- 
-- Problems:
-- 1. allocate_lucky_dip_tickets doesn't exist (edge function calls it)
-- 2. Multiple get_unavailable_tickets overloads with different return types
-- 3. PostgREST cannot choose between overloads (PGRST203)
--
-- Solution: Match exact production schema from "20260201000000_restore_all_production_functions.sql.csv"
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Drop ALL conflicting function overloads
-- ============================================================================

-- Drop all get_unavailable_tickets variants to avoid conflicts
DROP FUNCTION IF EXISTS get_unavailable_tickets(TEXT) CASCADE;
DROP FUNCTION IF EXISTS get_unavailable_tickets(UUID) CASCADE;
DROP FUNCTION IF EXISTS get_unavailable_tickets_legacy(UUID) CASCADE;

-- Drop all get_competition_unavailable_tickets variants  
DROP FUNCTION IF EXISTS get_competition_unavailable_tickets(TEXT) CASCADE;
DROP FUNCTION IF EXISTS get_competition_unavailable_tickets(UUID) CASCADE;

-- Drop allocate_lucky_dip_tickets variants (we'll recreate correctly)
DROP FUNCTION IF EXISTS allocate_lucky_dip_tickets(TEXT, TEXT, INTEGER) CASCADE;
DROP FUNCTION IF EXISTS allocate_lucky_dip_tickets(TEXT, TEXT, INTEGER, NUMERIC, INTEGER, TEXT) CASCADE;
DROP FUNCTION IF EXISTS allocate_lucky_dip_tickets_batch(TEXT, UUID, INTEGER) CASCADE;
DROP FUNCTION IF EXISTS allocate_lucky_dip_tickets_batch(TEXT, UUID, INTEGER, NUMERIC, INTEGER, TEXT, INTEGER[]) CASCADE;

-- ============================================================================
-- STEP 2: Create get_competition_unavailable_tickets (UUID version)
-- Production signature: Returns TABLE(ticket_number integer, source text)
-- ============================================================================

CREATE OR REPLACE FUNCTION get_competition_unavailable_tickets(p_competition_id UUID)
RETURNS TABLE(ticket_number INTEGER, source TEXT)
LANGUAGE plpgsql
STABLE 
SECURITY DEFINER
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

-- ============================================================================
-- STEP 3: Create get_competition_unavailable_tickets (TEXT version)
-- Wrapper that converts TEXT to UUID and calls UUID version
-- ============================================================================

CREATE OR REPLACE FUNCTION get_competition_unavailable_tickets(p_competition_id TEXT)
RETURNS TABLE(ticket_number INTEGER, source TEXT)
LANGUAGE plpgsql
STABLE 
SECURITY DEFINER
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

-- ============================================================================
-- STEP 4: Create get_unavailable_tickets (TEXT version ONLY)
-- Production signature: Returns INTEGER[] (not TABLE)
-- This is the version used by frontend/PostgREST
-- ============================================================================

CREATE OR REPLACE FUNCTION get_unavailable_tickets(p_competition_id TEXT)
RETURNS INTEGER[]
LANGUAGE plpgsql
STABLE 
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_competition_uuid UUID;
  v_comp_uid TEXT;
  v_unavailable INTEGER[] := ARRAY[]::INTEGER[];
  v_sold_jc INTEGER[] := ARRAY[]::INTEGER[];
  v_sold_tickets INTEGER[] := ARRAY[]::INTEGER[];
  v_pending INTEGER[] := ARRAY[]::INTEGER[];
BEGIN
  IF p_competition_id IS NULL OR TRIM(p_competition_id) = '' THEN 
    RETURN ARRAY[]::INTEGER[]; 
  END IF;
  
  -- Try to parse as UUID
  BEGIN 
    v_competition_uuid := p_competition_id::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    SELECT c.id, c.uid INTO v_competition_uuid, v_comp_uid 
    FROM competitions c WHERE c.uid = p_competition_id LIMIT 1;
    IF v_competition_uuid IS NULL THEN 
      RETURN ARRAY[]::INTEGER[]; 
    END IF;
  END;
  
  IF v_comp_uid IS NULL THEN 
    SELECT c.uid INTO v_comp_uid FROM competitions c WHERE c.id = v_competition_uuid; 
  END IF;

  -- Get tickets from joincompetition
  BEGIN 
    SELECT COALESCE(array_agg(DISTINCT ticket_num), ARRAY[]::INTEGER[]) INTO v_sold_jc
    FROM (
      SELECT CAST(TRIM(unnest(string_to_array(ticketnumbers::TEXT, ','))) AS INTEGER) AS ticket_num 
      FROM joincompetition
      WHERE (competitionid = v_competition_uuid::TEXT OR (v_comp_uid IS NOT NULL AND competitionid = v_comp_uid) OR competitionid = p_competition_id)
      AND ticketnumbers IS NOT NULL AND TRIM(ticketnumbers::TEXT) != ''
    ) AS jc_tickets 
    WHERE ticket_num IS NOT NULL;
  EXCEPTION WHEN OTHERS THEN 
    v_sold_jc := ARRAY[]::INTEGER[]; 
  END;

  -- Get tickets from tickets table
  BEGIN 
    SELECT COALESCE(array_agg(DISTINCT t.ticket_number), ARRAY[]::INTEGER[]) INTO v_sold_tickets 
    FROM tickets t
    WHERE t.competition_id = v_competition_uuid;
  EXCEPTION WHEN OTHERS THEN 
    v_sold_tickets := ARRAY[]::INTEGER[]; 
  END;

  -- Get pending tickets
  BEGIN 
    SELECT COALESCE(array_agg(DISTINCT unnest(pt.ticket_numbers)), ARRAY[]::INTEGER[]) INTO v_pending 
    FROM pending_tickets pt
    WHERE pt.competition_id = v_competition_uuid
    AND pt.status IN ('pending', 'confirming') 
    AND pt.expires_at > NOW();
  EXCEPTION WHEN OTHERS THEN 
    v_pending := ARRAY[]::INTEGER[]; 
  END;

  v_unavailable := COALESCE(v_sold_jc, ARRAY[]::INTEGER[]) || COALESCE(v_sold_tickets, ARRAY[]::INTEGER[]) || COALESCE(v_pending, ARRAY[]::INTEGER[]);
  
  IF array_length(v_unavailable, 1) IS NOT NULL AND array_length(v_unavailable, 1) > 0 THEN
    SELECT COALESCE(array_agg(DISTINCT u ORDER BY u), ARRAY[]::INTEGER[]) INTO v_unavailable 
    FROM unnest(v_unavailable) AS u WHERE u IS NOT NULL;
  ELSE 
    v_unavailable := ARRAY[]::INTEGER[]; 
  END IF;
  
  RETURN v_unavailable;
END;
$$;

-- ============================================================================
-- STEP 5: Create allocate_lucky_dip_tickets_batch (production signature)
-- This is the main batch allocation function with full signature
-- ============================================================================

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

-- ============================================================================
-- STEP 6: Create allocate_lucky_dip_tickets (edge function expects this)
-- This is a wrapper that calls allocate_lucky_dip_tickets_batch
-- ============================================================================

CREATE OR REPLACE FUNCTION allocate_lucky_dip_tickets(
  p_user_id TEXT,
  p_competition_id TEXT,
  p_count INTEGER,
  p_ticket_price NUMERIC DEFAULT 1,
  p_hold_minutes INTEGER DEFAULT 15,
  p_session_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_competition_uuid UUID;
BEGIN
  -- Parse competition ID to UUID
  BEGIN
    v_competition_uuid := p_competition_id::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    -- Try to look up by uid
    SELECT c.id INTO v_competition_uuid
    FROM competitions c
    WHERE c.uid = p_competition_id
    LIMIT 1;

    IF v_competition_uuid IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Invalid competition ID'
      );
    END IF;
  END;

  -- Call the batch function with NULL for excluded_tickets
  RETURN allocate_lucky_dip_tickets_batch(
    p_user_id,
    v_competition_uuid,
    p_count,
    p_ticket_price,
    p_hold_minutes,
    p_session_id,
    NULL::INTEGER[]
  );
END;
$$;

-- ============================================================================
-- STEP 7: Grant permissions
-- ============================================================================

GRANT EXECUTE ON FUNCTION get_competition_unavailable_tickets(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_competition_unavailable_tickets(UUID) TO anon;
GRANT EXECUTE ON FUNCTION get_competition_unavailable_tickets(UUID) TO service_role;

GRANT EXECUTE ON FUNCTION get_competition_unavailable_tickets(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_competition_unavailable_tickets(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_competition_unavailable_tickets(TEXT) TO service_role;

GRANT EXECUTE ON FUNCTION get_unavailable_tickets(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_unavailable_tickets(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_unavailable_tickets(TEXT) TO service_role;

GRANT EXECUTE ON FUNCTION allocate_lucky_dip_tickets_batch(TEXT, UUID, INTEGER, NUMERIC, INTEGER, TEXT, INTEGER[]) TO authenticated;
GRANT EXECUTE ON FUNCTION allocate_lucky_dip_tickets_batch(TEXT, UUID, INTEGER, NUMERIC, INTEGER, TEXT, INTEGER[]) TO service_role;

GRANT EXECUTE ON FUNCTION allocate_lucky_dip_tickets(TEXT, TEXT, INTEGER, NUMERIC, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION allocate_lucky_dip_tickets(TEXT, TEXT, INTEGER, NUMERIC, INTEGER, TEXT) TO service_role;

-- ============================================================================
-- STEP 8: Add comments
-- ============================================================================

COMMENT ON FUNCTION get_competition_unavailable_tickets(UUID) IS 
'Returns unavailable tickets with source (sold/pending) for a competition UUID. Production schema aligned.';

COMMENT ON FUNCTION get_competition_unavailable_tickets(TEXT) IS 
'Returns unavailable tickets with source. Accepts TEXT (UUID or uid). Delegates to UUID version.';

COMMENT ON FUNCTION get_unavailable_tickets(TEXT) IS 
'Returns array of unavailable ticket numbers. Single TEXT parameter to avoid PGRST203 conflicts. Production schema aligned.';

COMMENT ON FUNCTION allocate_lucky_dip_tickets_batch(TEXT, UUID, INTEGER, NUMERIC, INTEGER, TEXT, INTEGER[]) IS 
'Batch allocates random tickets. Supports up to 500 tickets per call. Production schema aligned.';

COMMENT ON FUNCTION allocate_lucky_dip_tickets(TEXT, TEXT, INTEGER, NUMERIC, INTEGER, TEXT) IS 
'Allocates random tickets. Wrapper for allocate_lucky_dip_tickets_batch. Called by edge function lucky-dip-reserve.';

COMMIT;

-- ============================================================================
-- Log completion
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '==============================================================================';
  RAISE NOTICE 'Production Schema Alignment Complete';
  RAISE NOTICE '==============================================================================';
  RAISE NOTICE 'Fixed functions:';
  RAISE NOTICE '  ✓ get_competition_unavailable_tickets(UUID) - Returns TABLE with source';
  RAISE NOTICE '  ✓ get_competition_unavailable_tickets(TEXT) - Wrapper for UUID version';
  RAISE NOTICE '  ✓ get_unavailable_tickets(TEXT) - Returns INTEGER[] (ONLY TEXT version)';
  RAISE NOTICE '  ✓ allocate_lucky_dip_tickets_batch - Production signature with 7 params';
  RAISE NOTICE '  ✓ allocate_lucky_dip_tickets - NEW wrapper called by edge function';
  RAISE NOTICE '';
  RAISE NOTICE 'Removed conflicting overloads:';
  RAISE NOTICE '  ✗ get_unavailable_tickets(UUID) - Caused PGRST203 conflicts';
  RAISE NOTICE '  ✗ get_unavailable_tickets_legacy(UUID) - Not needed';
  RAISE NOTICE '';
  RAISE NOTICE 'This fixes:';
  RAISE NOTICE '  - HTTP 300 PGRST203 errors (function overload ambiguity)';
  RAISE NOTICE '  - HTTP 500 errors (function not found in schema cache)';
  RAISE NOTICE '  - Edge function lucky-dip-reserve failures';
  RAISE NOTICE '==============================================================================';
END $$;
