-- ============================================================================
-- FIX: get_unavailable_tickets Parameter Name Mismatch
-- ============================================================================
-- Frontend calls with 'competition_id' but function expects 'p_competition_id'
-- This causes 404 errors and fallback to slower direct queries
-- ============================================================================

BEGIN;

-- Drop existing functions (both parameter name variants)
DROP FUNCTION IF EXISTS get_unavailable_tickets(TEXT);
DROP FUNCTION IF EXISTS get_unavailable_tickets(UUID);

-- Recreate with 'competition_id' (no 'p_' prefix) to match frontend
CREATE OR REPLACE FUNCTION get_unavailable_tickets(competition_id TEXT)
RETURNS TABLE (ticket_number INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  comp_uuid UUID;
BEGIN
  -- Try to parse as UUID
  BEGIN
    comp_uuid := competition_id::UUID;
  EXCEPTION
    WHEN invalid_text_representation THEN
      -- If not a UUID, try to find by uid
      SELECT c.id INTO comp_uuid
      FROM competitions c
      WHERE c.uid = competition_id
      LIMIT 1;

      IF comp_uuid IS NULL THEN
        -- Competition not found, return empty set
        RETURN;
      END IF;
  END;

  -- Return unavailable tickets from three sources
  RETURN QUERY
  WITH sold_tickets AS (
    -- From tickets table (confirmed sold tickets)
    SELECT DISTINCT t.ticket_number
    FROM tickets t
    WHERE t.competition_id = comp_uuid

    UNION

    -- From pending_tickets (reserved but not yet confirmed)
    SELECT DISTINCT unnest(pt.ticket_numbers) AS ticket_number
    FROM pending_tickets pt
    WHERE pt.competition_id = comp_uuid
      AND pt.status = 'pending'
      AND pt.expires_at > NOW()

    UNION

    -- From joincompetition (legacy entries)
    SELECT DISTINCT CAST(TRIM(t_num) AS INTEGER) AS ticket_number
    FROM (
      SELECT unnest(string_to_array(jc.ticketnumbers, ',')) AS t_num
      FROM joincompetition jc
      WHERE jc.competitionid = comp_uuid
        AND jc.ticketnumbers IS NOT NULL
        AND TRIM(jc.ticketnumbers) != ''
    ) parsed
    WHERE TRIM(t_num) ~ '^[0-9]+$'
      AND LENGTH(TRIM(t_num)) <= 10
  )
  SELECT st.ticket_number
  FROM sold_tickets st
  ORDER BY st.ticket_number;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_unavailable_tickets(TEXT) TO authenticated, anon, service_role;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

DO $$
DECLARE
  v_test_count INTEGER;
BEGIN
  -- Test with a known competition ID
  SELECT COUNT(*) INTO v_test_count
  FROM get_unavailable_tickets('799a8e12-38f2-4989-ad24-15c995d673a6');
  
  RAISE NOTICE '=================================================================';
  RAISE NOTICE '✅ Function created successfully!';
  RAISE NOTICE '   Parameter name: competition_id (matches frontend)';
  RAISE NOTICE '   Test query returned % unavailable tickets', v_test_count;
  RAISE NOTICE '=================================================================';
END $$;

COMMIT;
