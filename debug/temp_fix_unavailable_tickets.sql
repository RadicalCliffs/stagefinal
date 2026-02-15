-- Direct fix for get_unavailable_tickets RPC function
DROP FUNCTION IF EXISTS get_unavailable_tickets(TEXT) CASCADE;

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
  v_competition_id_text TEXT;
  v_unavailable INTEGER[] := ARRAY[]::INTEGER[];
  v_sold_jc INTEGER[] := ARRAY[]::INTEGER[];
  v_sold_tickets INTEGER[] := ARRAY[]::INTEGER[];
  v_pending INTEGER[] := ARRAY[]::INTEGER[];
BEGIN
  IF p_competition_id IS NULL OR TRIM(p_competition_id) = '' THEN 
    RETURN ARRAY[]::INTEGER[]; 
  END IF;
  
  BEGIN 
    v_competition_uuid := p_competition_id::UUID;
    v_competition_id_text := v_competition_uuid::TEXT;
  EXCEPTION WHEN invalid_text_representation THEN
    SELECT c.id, c.uid INTO v_competition_uuid, v_comp_uid 
    FROM competitions c WHERE c.uid = p_competition_id LIMIT 1;
    IF v_competition_uuid IS NULL THEN 
      RETURN ARRAY[]::INTEGER[]; 
    END IF;
    v_competition_id_text := v_competition_uuid::TEXT;
  END;
  
  IF v_comp_uid IS NULL THEN 
    SELECT c.uid INTO v_comp_uid FROM competitions c WHERE c.id = v_competition_uuid; 
  END IF;

  BEGIN 
    SELECT COALESCE(array_agg(DISTINCT ticket_num), ARRAY[]::INTEGER[]) INTO v_sold_jc
    FROM (
      SELECT CAST(TRIM(unnest(string_to_array(ticketnumbers::TEXT, ','))) AS INTEGER) AS ticket_num 
      FROM joincompetition
      WHERE (competitionid = v_competition_id_text OR (v_comp_uid IS NOT NULL AND competitionid = v_comp_uid) OR competitionid = p_competition_id)
      AND ticketnumbers IS NOT NULL AND TRIM(ticketnumbers::TEXT) != ''
    ) AS jc_tickets 
    WHERE ticket_num IS NOT NULL;
  EXCEPTION WHEN OTHERS THEN 
    v_sold_jc := ARRAY[]::INTEGER[]; 
  END;

  BEGIN 
    SELECT COALESCE(array_agg(DISTINCT t.ticket_number), ARRAY[]::INTEGER[]) INTO v_sold_tickets 
    FROM tickets t
    WHERE t.competition_id = v_competition_id_text
      OR (v_comp_uid IS NOT NULL AND t.competition_id = v_comp_uid)
      OR t.competition_id = p_competition_id;
  EXCEPTION WHEN OTHERS THEN 
    v_sold_tickets := ARRAY[]::INTEGER[]; 
  END;

  BEGIN 
    SELECT COALESCE(array_agg(DISTINCT pti.ticket_number), ARRAY[]::INTEGER[]) INTO v_pending 
    FROM pending_ticket_items pti
    INNER JOIN pending_tickets pt ON pti.pending_ticket_id = pt.id
    WHERE (pti.competition_id = v_competition_id_text 
      OR (v_comp_uid IS NOT NULL AND pti.competition_id = v_comp_uid)
      OR pti.competition_id = p_competition_id)
      AND pt.status IN ('pending', 'confirming') 
      AND pt.expires_at > NOW()
      AND pti.ticket_number IS NOT NULL;
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

GRANT EXECUTE ON FUNCTION get_unavailable_tickets(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_unavailable_tickets(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_unavailable_tickets(TEXT) TO service_role;
