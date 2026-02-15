 -- COMPLETE FIX: get_unavailable_tickets RPC Function
-- Run this in Supabase Dashboard → SQL Editor

-- Drop existing function
DROP FUNCTION IF EXISTS get_unavailable_tickets(TEXT) CASCADE;
DROP FUNCTION IF EXISTS get_unavailable_tickets(UUID) CASCADE;

-- Create the COMPLETE fixed function
-- All tables use UUID for competition_id, but function receives TEXT
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
  v_comp_uuid UUID;
BEGIN
  -- Handle NULL or empty input
  IF p_competition_id IS NULL OR TRIM(p_competition_id) = '' THEN
    RETURN ARRAY[]::INTEGER[];
  END IF;

  -- Convert text to UUID for comparisons (all tables use UUID)
  BEGIN
    v_comp_uuid := p_competition_id::UUID;
  EXCEPTION WHEN OTHERS THEN
    -- Not a valid UUID, try looking up by uid
    SELECT c.id INTO v_comp_uuid FROM competitions c WHERE c.uid::TEXT = p_competition_id;
    IF v_comp_uuid IS NULL THEN
      RETURN ARRAY[]::INTEGER[];
    END IF;
  END;

  -- 1. Get sold tickets from joincompetition (competitionid is UUID)
  BEGIN
    SELECT COALESCE(array_agg(DISTINCT ticket_num), ARRAY[]::INTEGER[])
    INTO v_sold_jc
    FROM (
      SELECT CAST(TRIM(unnest(string_to_array(ticketnumbers, ','))) AS INTEGER) AS ticket_num
      FROM joincompetition
      WHERE competitionid = v_comp_uuid
        AND ticketnumbers IS NOT NULL
        AND TRIM(ticketnumbers) != ''
    ) AS jc_tickets
    WHERE ticket_num IS NOT NULL AND ticket_num > 0;
  EXCEPTION WHEN OTHERS THEN
    v_sold_jc := ARRAY[]::INTEGER[];
  END;

  -- 2. Get sold tickets from tickets table (competition_id is UUID)
  BEGIN
    SELECT COALESCE(array_agg(DISTINCT t.ticket_number), ARRAY[]::INTEGER[])
    INTO v_sold_tickets
    FROM tickets t
    WHERE t.competition_id = v_comp_uuid
      AND t.ticket_number IS NOT NULL
      AND t.ticket_number > 0;
  EXCEPTION WHEN OTHERS THEN
    v_sold_tickets := ARRAY[]::INTEGER[];
  END;

  -- 3. Get pending tickets from pending_ticket_items (competition_id is UUID)
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
  EXCEPTION WHEN OTHERS THEN
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

-- Test it
-- SELECT get_unavailable_tickets('22786f37-66a1-4bf1-aa15-910ddf8d4eb4');
