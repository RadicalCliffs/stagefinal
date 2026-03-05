-- ============================================================================
-- FIX: get_unavailable_tickets Function Overload Ambiguity
-- ============================================================================
-- Problem: 
--   - Two overloads (TEXT and UUID) cause "Could not choose best candidate" error
--   - Frontend passes competition_id but function expects p_competition_id
--   - This causes tickets to not show as unavailable for other users
--
-- Solution:
--   - Remove UUID overload
--   - Use competition_id as parameter name (matches frontend)
--   - Ensure function queries ALL tickets from tickets table
-- ============================================================================

-- Drop both existing overloads
DROP FUNCTION IF EXISTS public.get_unavailable_tickets(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.get_unavailable_tickets(UUID) CASCADE;

-- Create single function with competition_id parameter (matches frontend)
CREATE OR REPLACE FUNCTION public.get_unavailable_tickets(competition_id TEXT)
RETURNS INTEGER[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_unavailable INTEGER[] := ARRAY[]::INTEGER[];
  v_sold_jc INTEGER[] := ARRAY[]::INTEGER[];
  v_sold_tickets INTEGER[] := ARRAY[]::INTEGER[];
  v_pending INTEGER[] := ARRAY[]::INTEGER[];
BEGIN
  -- Handle NULL or empty input
  IF competition_id IS NULL OR TRIM(competition_id) = '' THEN
    RETURN ARRAY[]::INTEGER[];
  END IF;

  -- CRITICAL: Get ALL tickets from tickets table (regardless of status)
  -- This ensures purchased tickets show as unavailable for all users
  BEGIN
    SELECT COALESCE(array_agg(DISTINCT t.ticket_number), ARRAY[]::INTEGER[])
    INTO v_sold_tickets
    FROM tickets t
    WHERE t.competition_id::TEXT = competition_id
      AND t.ticket_number IS NOT NULL
      AND t.ticket_number > 0;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'Error fetching tickets: %', SQLERRM;
      v_sold_tickets := ARRAY[]::INTEGER[];
  END;

  -- Get tickets from joincompetition (legacy)
  BEGIN
    SELECT COALESCE(array_agg(DISTINCT ticket_num), ARRAY[]::INTEGER[])
    INTO v_sold_jc
    FROM (
      SELECT CAST(TRIM(unnest(string_to_array(ticketnumbers::TEXT, ','))) AS INTEGER) AS ticket_num
      FROM joincompetition
      WHERE competition_id::TEXT = competition_id::TEXT
        AND ticketnumbers IS NOT NULL
        AND TRIM(ticketnumbers::TEXT) != ''
    ) AS jc_tickets
    WHERE ticket_num IS NOT NULL AND ticket_num > 0;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'Error fetching joincompetition: %', SQLERRM;
      v_sold_jc := ARRAY[]::INTEGER[];
  END;

  -- Get pending tickets from pending_ticket_items
  BEGIN
    SELECT COALESCE(array_agg(DISTINCT pti.ticket_number), ARRAY[]::INTEGER[])
    INTO v_pending
    FROM pending_ticket_items pti
    INNER JOIN pending_tickets pt ON pti.pending_ticket_id = pt.id
    WHERE pti.competition_id::TEXT = competition_id
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
                || COALESCE(v_sold_jc, ARRAY[]::INTEGER[])
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

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.get_unavailable_tickets(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_unavailable_tickets(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_unavailable_tickets(TEXT) TO service_role;

COMMENT ON FUNCTION public.get_unavailable_tickets(TEXT) IS 
'Returns array of unavailable ticket numbers for a competition. Queries tickets table (ALL statuses), joincompetition, and pending_ticket_items.';

-- Verify function was created
DO $$
DECLARE
  v_func_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname = 'get_unavailable_tickets'
      AND pg_get_function_arguments(p.oid) = 'competition_id text'
  ) INTO v_func_exists;
  
  IF v_func_exists THEN
    RAISE NOTICE '✅ Function public.get_unavailable_tickets(competition_id TEXT) created successfully';
  ELSE
    RAISE EXCEPTION '❌ Function was not created properly';
  END IF;
END $$;

-- Test with a real competition
DO $$
DECLARE
  v_test_comp_id TEXT;
  v_unavailable INTEGER[];
  v_ticket_count INTEGER;
BEGIN
  -- Get a competition with tickets
  SELECT id::TEXT INTO v_test_comp_id
  FROM competitions
  WHERE status = 'active'
  LIMIT 1;
  
  IF v_test_comp_id IS NOT NULL THEN
    -- Count tickets in database
    SELECT COUNT(*) INTO v_ticket_count
    FROM tickets
    WHERE competition_id::TEXT = v_test_comp_id;
    
    -- Call the function
    SELECT get_unavailable_tickets(v_test_comp_id) INTO v_unavailable;
    
    RAISE NOTICE '';
    RAISE NOTICE '=== TEST RESULTS ===';
    RAISE NOTICE 'Competition ID: %', v_test_comp_id;
    RAISE NOTICE 'Tickets in database: %', v_ticket_count;
    RAISE NOTICE 'Unavailable from RPC: %', array_length(v_unavailable, 1);
    
    IF v_ticket_count = array_length(v_unavailable, 1) THEN
      RAISE NOTICE '✅ All tickets showing as unavailable - CORRECT!';
    ELSE
      RAISE WARNING '⚠️  Mismatch: % tickets in DB but % unavailable', v_ticket_count, array_length(v_unavailable, 1);
    END IF;
  END IF;
END $$;
