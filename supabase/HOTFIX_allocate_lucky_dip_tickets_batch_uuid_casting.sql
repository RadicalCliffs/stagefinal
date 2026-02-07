-- ============================================================================
-- HOTFIX: Fix allocate_lucky_dip_tickets_batch UUID to TEXT casting errors
-- ============================================================================
-- This file can be manually applied via Supabase SQL Editor to immediately
-- fix the "operator does not exist: uuid = text" error in lucky-dip-reserve.
--
-- Apply this via:
-- 1. Supabase Dashboard → SQL Editor
-- 2. Copy and paste this entire file
-- 3. Click "Run"
--
-- OR via Supabase CLI:
-- supabase db execute -f supabase/HOTFIX_allocate_lucky_dip_tickets_batch_uuid_casting.sql
-- ============================================================================

BEGIN;

-- Drop existing version to recreate with proper casting
DROP FUNCTION IF EXISTS allocate_lucky_dip_tickets_batch(TEXT, UUID, INTEGER, NUMERIC, INTEGER, TEXT, INTEGER[]) CASCADE;

-- ============================================================================
-- Create allocate_lucky_dip_tickets_batch with proper UUID to TEXT casting
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
  -- Convert UUID to TEXT for comparisons with TEXT columns
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
    WHERE (competitionid = v_competition_id_text OR competitionid = v_competition_uid)
      AND ticketnumbers IS NOT NULL
      AND trim(ticketnumbers) != ''
  ) jc_tickets
  WHERE ticket_num IS NOT NULL AND ticket_num >= 1 AND ticket_num <= v_total_tickets;

  -- Add sold tickets from tickets table (competition_id is TEXT)
  SELECT v_unavailable_set || COALESCE(array_agg(ticket_number), ARRAY[]::INTEGER[])
  INTO v_unavailable_set
  FROM tickets
  WHERE competition_id = v_competition_id_text
    AND ticket_number IS NOT NULL;

  -- Add pending tickets from other users (competition_id is TEXT)
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

  -- Cancel any existing pending reservations for this user on this competition (competition_id is TEXT)
  UPDATE pending_tickets
  SET status = 'cancelled', updated_at = NOW()
  WHERE user_id = p_user_id
    AND competition_id = v_competition_id_text
    AND status = 'pending';

  -- Generate reservation details
  v_reservation_id := gen_random_uuid();
  v_expires_at := NOW() + make_interval(mins => LEAST(GREATEST(p_hold_minutes, 1), 60));
  v_total_amount := p_count * p_ticket_price;

  -- Create the pending reservation (competition_id is TEXT in pending_tickets table)
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

-- Verify function was created
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM pg_proc 
  WHERE proname = 'allocate_lucky_dip_tickets_batch';
  
  IF v_count >= 1 THEN
    RAISE NOTICE '✅ allocate_lucky_dip_tickets_batch function created successfully!';
  ELSE
    RAISE WARNING '⚠️  allocate_lucky_dip_tickets_batch function was not created';
  END IF;
END $$;

-- Comments
COMMENT ON FUNCTION allocate_lucky_dip_tickets_batch(TEXT, UUID, INTEGER, NUMERIC, INTEGER, TEXT, INTEGER[]) IS 
'Batch allocation of random tickets with proper UUID to TEXT casting.
FIXED: UUID to TEXT casting to prevent "operator does not exist: uuid = text" errors.
Allocates up to 500 tickets per call with randomization and proper locking.';

COMMIT;

-- Test the fix (Optional - uncomment to test with actual competition ID)
-- SELECT allocate_lucky_dip_tickets_batch(
--   'prize:pid:test-user-id',
--   '47354b08-8167-471e-959a-5fc114dcc532'::UUID,
--   5,
--   0.25,
--   15,
--   NULL,
--   NULL
-- );
