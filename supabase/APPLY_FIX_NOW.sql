-- DIRECT FIX: Apply this SQL file directly via Supabase Dashboard SQL Editor
-- Competition: 22786f37-66a1-4bf1-aa15-910ddf8d4eb4 (should show sold tickets)

-- Step 1: Check what tickets exist in joincompetition for this competition
SELECT 'joincompetition entries' as source, COUNT(*) as count
FROM joincompetition 
WHERE competitionid = '22786f37-66a1-4bf1-aa15-910ddf8d4eb4'
   OR competitionid = '22786f37-66a1-4bf1-aa15-910ddf8d4eb4'::TEXT;

-- Step 2: Check what tickets exist in tickets table
SELECT 'tickets table entries' as source, COUNT(*) as count
FROM tickets 
WHERE competition_id = '22786f37-66a1-4bf1-aa15-910ddf8d4eb4';

-- Step 3: Check pending reservations
SELECT 'pending_tickets' as source, COUNT(*) as count
FROM pending_tickets 
WHERE competition_id = '22786f37-66a1-4bf1-aa15-910ddf8d4eb4'
  AND status IN ('pending', 'confirming')
  AND expires_at > NOW();

-- Step 4: Check the actual RPC function definition
SELECT proname, proargnames, pro_returns 
FROM pg_proc p 
WHERE proname = 'get_unavailable_tickets';

-- Step 5: Test the RPC with the actual competition ID
SELECT get_unavailable_tickets('22786f37-66a1-4bf1-aa15-910ddf8d4eb4');

-- Step 6: If RPC returns empty, create/update it with correct implementation
DROP FUNCTION IF EXISTS get_unavailable_tickets(TEXT) CASCADE;

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
  IF p_competition_id IS NULL OR TRIM(p_competition_id) = '' THEN 
    RETURN ARRAY[]::INTEGER[]; 
  END IF;

  -- Get sold tickets from joincompetition (competitionid is TEXT in many tables)
  BEGIN
    SELECT COALESCE(array_agg(DISTINCT ticket_num), ARRAY[]::INTEGER[])
    INTO v_sold_jc
    FROM (
      SELECT CAST(TRIM(unnest(string_to_array(ticketnumbers::TEXT, ','))) AS INTEGER) AS ticket_num 
      FROM joincompetition
      WHERE competitionid = p_competition_id
        AND ticketnumbers IS NOT NULL 
        AND TRIM(ticketnumbers::TEXT) != ''
    ) AS jc_tickets
    WHERE ticket_num IS NOT NULL
      AND ticket_num > 0;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Error fetching from joincompetition: %', SQLERRM;
    v_sold_jc := ARRAY[]::INTEGER[];
  END;

  -- Get sold tickets from tickets table
  BEGIN
    SELECT COALESCE(array_agg(DISTINCT t.ticket_number), ARRAY[]::INTEGER[])
    INTO v_sold_tickets
    FROM tickets t
    WHERE t.competition_id = p_competition_id
      AND t.ticket_number IS NOT NULL
      AND t.ticket_number > 0;
  EXCEPTION WHEN OTHERS THEN
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
      AND pt.expires_at > NOW()
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
  
  RAISE NOTICE 'get_unavailable_tickets for %: % tickets', p_competition_id, array_length(v_unavailable, 1);
  RETURN v_unavailable;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_unavailable_tickets(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_unavailable_tickets(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_unavailable_tickets(TEXT) TO service_role;

-- Test it
SELECT get_unavailable_tickets('22786f37-66a1-4bf1-aa15-910ddf8d4eb4');
