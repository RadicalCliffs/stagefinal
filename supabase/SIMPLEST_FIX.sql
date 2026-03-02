-- ============================================================================
-- EMERGENCY FIX: Stack Depth Exceeded in get_unavailable_tickets
-- ============================================================================
-- The current get_unavailable_tickets and get_competition_unavailable_tickets
-- functions have circular reference issues causing infinite recursion.
-- This fix provides simplified, non-recursive versions.
-- ============================================================================

BEGIN;

-- Drop all existing overloads to avoid conflicts
DROP FUNCTION IF EXISTS get_unavailable_tickets(TEXT) CASCADE;
DROP FUNCTION IF EXISTS get_unavailable_tickets(UUID) CASCADE;
DROP FUNCTION IF EXISTS get_competition_unavailable_tickets(TEXT) CASCADE;
DROP FUNCTION IF EXISTS get_competition_unavailable_tickets(UUID) CASCADE;

-- ============================================================================
-- PART 1: Simplified get_unavailable_tickets (takes TEXT, returns INTEGER[])
-- ============================================================================

CREATE OR REPLACE FUNCTION get_unavailable_tickets(p_competition_id TEXT)
RETURNS INTEGER[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_competition_uuid UUID := NULL;
  v_comp_uid TEXT := NULL;
  v_result INTEGER[] := ARRAY[]::INTEGER[];
BEGIN
  -- Handle null/empty input
  IF p_competition_id IS NULL OR TRIM(p_competition_id) = '' THEN
    RETURN ARRAY[]::INTEGER[];
  END IF;

  -- Try to parse as UUID
  BEGIN
    v_competition_uuid := p_competition_id::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    -- Not a UUID, try to find by uid
    SELECT c.id, c.uid INTO v_competition_uuid, v_comp_uid
    FROM competitions c 
    WHERE c.uid = p_competition_id 
    LIMIT 1;
    
    IF v_competition_uuid IS NULL THEN
      RETURN ARRAY[]::INTEGER[];
    END IF;
  END;

  -- Get uid if we don't have it
  IF v_comp_uid IS NULL THEN
    SELECT c.uid INTO v_comp_uid 
    FROM competitions c 
    WHERE c.id = v_competition_uuid;
  END IF;

  -- Collect all unavailable tickets from all sources
  -- Use a simple query with UNION ALL, then deduplicate at the end
  WITH all_tickets AS (
    -- From joincompetition (competitionid is TEXT)
    SELECT CAST(TRIM(t_num) AS INTEGER) AS ticket_num
    FROM (
      SELECT unnest(string_to_array(ticketnumbers, ',')) AS t_num
      FROM joincompetition
      WHERE (competitionid = v_competition_uuid::TEXT 
        OR competitionid = v_comp_uid 
        OR competitionid = p_competition_id)
        AND ticketnumbers IS NOT NULL
        AND TRIM(ticketnumbers) != ''
    ) parsed
    WHERE TRIM(t_num) ~ '^[0-9]+$'
    
    UNION ALL
    
    -- From tickets table (competition_id is UUID)
    SELECT ticket_number AS ticket_num
    FROM tickets
    WHERE competition_id = v_competition_uuid
      AND ticket_number IS NOT NULL
    
    UNION ALL
    
    -- From pending_tickets (competition_id is TEXT, ticket_numbers is INTEGER[])
    SELECT unnest(ticket_numbers) AS ticket_num
    FROM pending_tickets
    WHERE competition_id = v_competition_uuid::TEXT
      AND status IN ('pending', 'confirming')
      AND expires_at > NOW()
      AND ticket_numbers IS NOT NULL
  )
  SELECT COALESCE(array_agg(DISTINCT ticket_num ORDER BY ticket_num), ARRAY[]::INTEGER[])
  INTO v_result
  FROM all_tickets
  WHERE ticket_num IS NOT NULL AND ticket_num > 0;

  RETURN COALESCE(v_result, ARRAY[]::INTEGER[]);
END;
$$;

GRANT EXECUTE ON FUNCTION get_unavailable_tickets(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_unavailable_tickets(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_unavailable_tickets(TEXT) TO service_role;

-- ============================================================================
-- PART 2: get_competition_unavailable_tickets - UUID version (returns TABLE)
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
  v_competition_id_text TEXT;
BEGIN
  v_competition_id_text := p_competition_id::TEXT;
  
  SELECT uid INTO v_comp_uid 
  FROM competitions 
  WHERE id = p_competition_id;

  RETURN QUERY
  
  -- From joincompetition (sold tickets)
  SELECT
    CAST(TRIM(t_num) AS INTEGER) AS ticket_number,
    'sold'::TEXT AS source
  FROM (
    SELECT unnest(string_to_array(jc.ticketnumbers, ',')) AS t_num
    FROM joincompetition jc
    WHERE (jc.competitionid = v_competition_id_text
      OR (v_comp_uid IS NOT NULL AND jc.competitionid = v_comp_uid))
      AND jc.ticketnumbers IS NOT NULL
      AND TRIM(jc.ticketnumbers) != ''
  ) parsed
  WHERE TRIM(t_num) ~ '^[0-9]+$'
  
  UNION ALL
  
  -- From tickets table (sold tickets)
  SELECT
    t.ticket_number,
    'sold'::TEXT AS source
  FROM tickets t
  WHERE t.competition_id = p_competition_id
    AND t.ticket_number IS NOT NULL
  
  UNION ALL
  
  -- From pending_tickets (reserved tickets)
  SELECT
    unnest(pt.ticket_numbers) AS ticket_number,
    'pending'::TEXT AS source
  FROM pending_tickets pt
  WHERE pt.competition_id = v_competition_id_text
    AND pt.status IN ('pending', 'confirming')
    AND pt.expires_at > NOW()
    AND pt.ticket_numbers IS NOT NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION get_competition_unavailable_tickets(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_competition_unavailable_tickets(UUID) TO anon;
GRANT EXECUTE ON FUNCTION get_competition_unavailable_tickets(UUID) TO service_role;

-- ============================================================================
-- PART 3: get_competition_unavailable_tickets - TEXT wrapper (NO RECURSION)
-- ============================================================================

CREATE OR REPLACE FUNCTION get_competition_unavailable_tickets(p_competition_id TEXT)
RETURNS TABLE(ticket_number INTEGER, source TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uuid UUID := NULL;
BEGIN
  IF p_competition_id IS NULL OR TRIM(p_competition_id) = '' THEN
    RETURN;
  END IF;

  -- Try to convert to UUID
  BEGIN
    v_uuid := p_competition_id::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    -- Not a UUID, try to find by uid
    SELECT c.id INTO v_uuid 
    FROM competitions c 
    WHERE c.uid = p_competition_id 
    LIMIT 1;
    
    IF v_uuid IS NULL THEN
      RETURN;
    END IF;
  END;

  -- Call the UUID version EXPLICITLY with type cast to avoid recursion
  RETURN QUERY 
  SELECT * FROM get_competition_unavailable_tickets(v_uuid::UUID);
END;
$$;

GRANT EXECUTE ON FUNCTION get_competition_unavailable_tickets(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_competition_unavailable_tickets(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_competition_unavailable_tickets(TEXT) TO service_role;

COMMIT;

-- ============================================================================
-- HOW TO APPLY:
-- 1. Copy this entire file
-- 2. Go to Supabase Dashboard → SQL Editor
-- 3. Paste and run
-- ============================================================================
