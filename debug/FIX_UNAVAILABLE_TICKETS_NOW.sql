-- ============================================================================
-- FIX: get_unavailable_tickets RPC Function
-- Run this in Supabase Dashboard → SQL Editor to fix the ticket selector
-- ============================================================================

-- Drop existing function to avoid conflicts
DROP FUNCTION IF EXISTS get_unavailable_tickets(TEXT) CASCADE;
DROP FUNCTION IF EXISTS get_unavailable_tickets(UUID) CASCADE;

-- Create the fixed function
CREATE OR REPLACE FUNCTION get_unavailable_tickets(p_competition_id TEXT)
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
  IF p_competition_id IS NULL OR TRIM(p_competition_id) = '' THEN
    RETURN ARRAY[]::INTEGER[];
  END IF;

  -- Get sold tickets from joincompetition
  BEGIN
    SELECT COALESCE(array_agg(DISTINCT ticket_num), ARRAY[]::INTEGER[])
    INTO v_sold_jc
    FROM (
      SELECT CAST(TRIM(unnest(string_to_array(ticketnumbers::TEXT, ','))) AS INTEGER) AS ticket_num
      FROM joincompetition
      WHERE competition_id = p_competition_id
        AND ticketnumbers IS NOT NULL
        AND TRIM(ticketnumbers::TEXT) != ''
    ) AS jc_tickets
    WHERE ticket_num IS NOT NULL AND ticket_num > 0;
  EXCEPTION
    WHEN OTHERS THEN
      v_sold_jc := ARRAY[]::INTEGER[];
  END;

  -- Get sold tickets from tickets table (competition_id is UUID in tickets table)
  BEGIN
    SELECT COALESCE(array_agg(DISTINCT t.ticket_number), ARRAY[]::INTEGER[])
    INTO v_sold_tickets
    FROM tickets t
    WHERE t.competition_id::TEXT = p_competition_id
      AND t.ticket_number IS NOT NULL
      AND t.ticket_number > 0;
  EXCEPTION
    WHEN OTHERS THEN
      v_sold_tickets := ARRAY[]::INTEGER[];
  END;

  -- Get pending tickets from pending_ticket_items
  BEGIN
    SELECT COALESCE(array_agg(DISTINCT pti.ticket_number), ARRAY[]::INTEGER[])
    INTO v_pending
    FROM pending_ticket_items pti
    INNER JOIN pending_tickets pt ON pti.pending_ticket_id = pt.id
    WHERE pti.competition_id = p_competition_id
      AND pt.status IN ('pending', 'confirming')
      AND (pt.expires_at IS NULL OR pt.expires_at > NOW())
      AND pti.ticket_number IS NOT NULL
      AND pti.ticket_number > 0;
  EXCEPTION
    WHEN OTHERS THEN
      v_pending := ARRAY[]::INTEGER[];
  END;

  -- Combine all sources
  v_unavailable := COALESCE(v_sold_jc, ARRAY[]::INTEGER[])
                || COALESCE(v_sold_tickets, ARRAY[]::INTEGER[])
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
GRANT EXECUTE ON FUNCTION get_unavailable_tickets(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_unavailable_tickets(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_unavailable_tickets(TEXT) TO service_role;

-- Create UUID overload for convenience (frontend often passes UUID)
CREATE OR REPLACE FUNCTION get_unavailable_tickets(p_competition_id UUID)
RETURNS INTEGER[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT get_unavailable_tickets(p_competition_id::TEXT);
$$;

GRANT EXECUTE ON FUNCTION get_unavailable_tickets(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_unavailable_tickets(UUID) TO anon;
GRANT EXECUTE ON FUNCTION get_unavailable_tickets(UUID) TO service_role;

-- Verify the function was created
SELECT
  p.proname AS function_name,
  pg_get_function_result(p.oid) AS return_type,
  pg_get_function_arguments(p.oid) AS arguments
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE p.proname = 'get_unavailable_tickets'
  AND n.nspname = 'public';

-- ============================================================================
-- Test with a sample competition ID (replace with actual ID)
-- Example: SELECT get_unavailable_tickets('22786f37-66a1-4bf1-aa15-910ddf8d4eb4');
-- ============================================================================
