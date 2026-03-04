-- ============================================================================
-- APPLY BOTH FIXES: Lucky Dip Randomization + Active Entries Count
-- ============================================================================
-- This script fixes two critical issues:
-- 1. Lucky dip purchases allocating consecutive ticket blocks
-- 2. Active entries dropdown showing 0 count (missing RPC function)
-- 
-- Run this script against your production database to apply both fixes.
-- ============================================================================

-- ============================================================================
-- FIX 1: Create Missing get_user_active_tickets RPC
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_user_active_tickets(TEXT) CASCADE;

CREATE OR REPLACE FUNCTION public.get_user_active_tickets(p_user_identifier TEXT)
RETURNS TABLE(
  competitionid UUID,
  ticketnumbers INTEGER[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_canonical_id TEXT;
  v_wallet_normalized TEXT;
BEGIN
  v_canonical_id := p_user_identifier;
  v_wallet_normalized := LOWER(p_user_identifier);
  
  RETURN QUERY
  SELECT 
    t.competition_id::UUID as competitionid,
    array_agg(t.ticket_number ORDER BY t.ticket_number)::INTEGER[] as ticketnumbers
  FROM tickets t
  INNER JOIN competitions c ON c.id = t.competition_id
  WHERE 
    (
      t.user_id = v_canonical_id 
      OR t.canonical_user_id = v_canonical_id
      OR t.privy_user_id = v_canonical_id
      OR LOWER(t.wallet_address) = v_wallet_normalized
    )
    AND c.status = 'active'
    AND c.deleted = false
    AND (c.end_date IS NULL OR c.end_date > NOW())
  GROUP BY t.competition_id
  ORDER BY MAX(t.created_at) DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_active_tickets(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_active_tickets(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_user_active_tickets(TEXT) TO anon;

COMMENT ON FUNCTION public.get_user_active_tickets(TEXT) IS 
'Returns ONE ROW per competition entered. Row count = number of active entries. Used by dashboard.';

-- ============================================================================
-- FIX 2: Fix Lucky Dip Randomization
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
  IF p_count < 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Count must be at least 1');
  END IF;

  IF p_count > 500 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Count cannot exceed 500 per batch',
      'max_batch_size', 500
    );
  END IF;

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
      'error', 'Competition not found or not active',
      'retryable', true
    );
  END IF;

  v_unavailable_set := COALESCE(p_excluded_tickets, ARRAY[]::INTEGER[]);

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

  SELECT v_unavailable_set || COALESCE(array_agg(ticket_number), ARRAY[]::INTEGER[])
  INTO v_unavailable_set
  FROM tickets
  WHERE competition_id = p_competition_id
    AND ticket_number IS NOT NULL;

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

  SELECT array_agg(DISTINCT u) INTO v_unavailable_set
  FROM unnest(v_unavailable_set) AS u
  WHERE u IS NOT NULL;

  v_unavailable_set := COALESCE(v_unavailable_set, ARRAY[]::INTEGER[]);

  -- CRITICAL FIX: Pure random() for true distribution
  SELECT array_agg(n ORDER BY random())
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

  v_selected_tickets := v_available_tickets[1:p_count];

  UPDATE pending_tickets
  SET status = 'cancelled', updated_at = NOW()
  WHERE user_id = p_user_id
    AND competition_id = p_competition_id
    AND status = 'pending';

  v_reservation_id := gen_random_uuid();
  v_expires_at := NOW() + make_interval(mins => LEAST(GREATEST(p_hold_minutes, 1), 60));
  v_total_amount := p_count * p_ticket_price;

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

GRANT EXECUTE ON FUNCTION allocate_lucky_dip_tickets_batch(TEXT, UUID, INTEGER, NUMERIC, INTEGER, TEXT, INTEGER[]) TO authenticated;
GRANT EXECUTE ON FUNCTION allocate_lucky_dip_tickets_batch(TEXT, UUID, INTEGER, NUMERIC, INTEGER, TEXT, INTEGER[]) TO service_role;
GRANT EXECUTE ON FUNCTION allocate_lucky_dip_tickets_batch(TEXT, UUID, INTEGER, NUMERIC, INTEGER, TEXT, INTEGER[]) TO anon;

COMMENT ON FUNCTION allocate_lucky_dip_tickets_batch(TEXT, UUID, INTEGER, NUMERIC, INTEGER, TEXT, INTEGER[]) IS
'Lucky dip allocation with true random distribution (fixed consecutive ticket issue)';

-- ============================================================================
-- Summary
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE 'BOTH FIXES APPLIED SUCCESSFULLY!';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE '✅ get_user_active_tickets RPC created';
  RAISE NOTICE '   → Active entries count will now display correctly';
  RAISE NOTICE '';
  RAISE NOTICE '✅ allocate_lucky_dip_tickets_batch fixed';
  RAISE NOTICE '   → Lucky dip tickets now truly random (no consecutive blocks)';
  RAISE NOTICE '';
  RAISE NOTICE 'Test the fixes by:';
  RAISE NOTICE '1. Checking the user dropdown - should show correct active entries count';
  RAISE NOTICE '2. Making a lucky dip purchase - tickets should be scattered randomly';
  RAISE NOTICE '';
END $$;