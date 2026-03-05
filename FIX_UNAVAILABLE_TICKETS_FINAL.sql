-- ============================================================================
-- FIX: get_unavailable_tickets - CORRECTED VERSION
-- ============================================================================
-- Problem: Parameter name "competition_id" shadows the table column name
-- Solution: Use p_competition_id as parameter, but accept it from frontend
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_unavailable_tickets(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.get_unavailable_tickets(UUID) CASCADE;

-- CORRECT VERSION: Use p_competition_id to avoid shadowing
CREATE OR REPLACE FUNCTION public.get_unavailable_tickets(p_competition_id TEXT)
RETURNS INTEGER[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_unavailable INTEGER[] := ARRAY[]::INTEGER[];
  v_sold_tickets INTEGER[] := ARRAY[]::INTEGER[];
  v_pending INTEGER[] := ARRAY[]::INTEGER[];
  v_comp_uuid UUID;
BEGIN
  -- Handle NULL or empty input
  IF p_competition_id IS NULL OR TRIM(p_competition_id) = '' THEN
    RETURN ARRAY[]::INTEGER[];
  END IF;

  -- Cast to UUID for proper comparison
  BEGIN
    v_comp_uuid := p_competition_id::UUID;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'Invalid competition ID format: %', p_competition_id;
      RETURN ARRAY[]::INTEGER[];
  END;

  -- Get ALL tickets from tickets table (CRITICAL: use v_comp_uuid variable)
  BEGIN
    SELECT COALESCE(array_agg(DISTINCT t.ticket_number), ARRAY[]::INTEGER[])
    INTO v_sold_tickets
    FROM tickets t
    WHERE t.competition_id = v_comp_uuid
      AND t.ticket_number IS NOT NULL
      AND t.ticket_number > 0;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'Error fetching tickets: %', SQLERRM;
      v_sold_tickets := ARRAY[]::INTEGER[];
  END;

  -- Get pending tickets
  BEGIN
    SELECT COALESCE(array_agg(DISTINCT pti.ticket_number), ARRAY[]::INTEGER[])
    INTO v_pending
    FROM pending_ticket_items pti
    INNER JOIN pending_tickets pt ON pti.pending_ticket_id = pt.id
    WHERE pti.competition_id = v_comp_uuid
      AND pt.status IN ('pending', 'confirming')
      AND (pt.expires_at IS NULL OR pt.expires_at > NOW())
      AND pti.ticket_number IS NOT NULL
      AND pti.ticket_number > 0;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'Error fetching pending tickets: %', SQLERRM;
      v_pending := ARRAY[]::INTEGER[];
  END;

  -- Combine all sources
  v_unavailable := COALESCE(v_sold_tickets, ARRAY[]::INTEGER[])
                || COALESCE(v_pending, ARRAY[]::INTEGER[]);

  -- Remove duplicates and sort
  IF array_length(v_unavailable, 1) IS NOT NULL AND array_length(v_unavailable, 1) > 0 THEN
    SELECT COALESCE(array_agg(DISTINCT u ORDER BY u), ARRAY[]::INTEGER[])
    INTO v_unavailable
    FROM unnest(v_unavailable) AS u
    WHERE u IS NOT NULL AND u > 0;
  ELSE
    v_unavailable := ARRAY[]::INTEGER[];
  END IF;

  RETURN v_unavailable;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_unavailable_tickets(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_unavailable_tickets(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_unavailable_tickets(TEXT) TO service_role;

-- Test immediately
DO $$
DECLARE
  v_test_comp_id TEXT := 'a879ba68-d098-42f6-a687-f70fd7109ee8';
  v_unavailable INTEGER[];
  v_ticket_count INTEGER;
BEGIN
  -- Count tickets
  SELECT COUNT(*) INTO v_ticket_count
  FROM tickets
  WHERE competition_id = v_test_comp_id::UUID;
  
  -- Call RPC
  SELECT get_unavailable_tickets(v_test_comp_id) INTO v_unavailable;
  
  RAISE NOTICE '';
  RAISE NOTICE '=== IMMEDIATE TEST ===';
  RAISE NOTICE 'Competition: Win 25 SOL';
  RAISE NOTICE 'Tickets in DB: %', v_ticket_count;
  RAISE NOTICE 'RPC returned: %', array_length(v_unavailable, 1);
  
  IF v_ticket_count = array_length(v_unavailable, 1) THEN
    RAISE NOTICE '✅ SUCCESS! Function working correctly!';
  ELSE
    RAISE WARNING '❌ FAILED: Got % tickets but expected %', array_length(v_unavailable, 1), v_ticket_count;
  END IF;
END $$;
