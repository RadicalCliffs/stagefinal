-- Simple fix: Convert TEXT to UUID once
DROP FUNCTION IF EXISTS get_unavailable_tickets(TEXT) CASCADE;

CREATE OR REPLACE FUNCTION get_unavailable_tickets(p_competition_id TEXT)
RETURNS INTEGER[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_comp_id UUID;
  v_result INTEGER[];
BEGIN
  -- Convert TEXT to UUID once
  BEGIN
    v_comp_id := p_competition_id::UUID;
  EXCEPTION WHEN OTHERS THEN
    RETURN ARRAY[]::INTEGER[];
  END;

  -- Query all tables using UUID
  SELECT array_agg(DISTINCT t) INTO v_result FROM (
    SELECT UNNEST(
      COALESCE(
        (SELECT array_agg(DISTINCT CAST(TRIM(unnest(string_to_array(ticketnumbers, ','))) AS INTEGER))
        FROM joincompetition WHERE competitionid = v_comp_id AND ticketnumbers IS NOT NULL),
        ARRAY[]::INTEGER[]
      )
    )
    UNION ALL
    SELECT ticket_number FROM tickets WHERE competition_id = v_comp_id AND ticket_number IS NOT NULL
    UNION ALL
    SELECT pti.ticket_number FROM pending_ticket_items pti
    JOIN pending_tickets pt ON pti.pending_ticket_id = pt.id
    WHERE pti.competition_id = v_comp_id AND pt.status IN ('pending', 'confirming')
    AND pt.expires_at > NOW()
  ) AS t WHERE t IS NOT NULL AND t > 0;

  RETURN COALESCE(v_result, ARRAY[]::INTEGER[]);
END;
$$;

GRANT EXECUTE ON FUNCTION get_unavailable_tickets(TEXT) TO authenticated, anon, service_role;
