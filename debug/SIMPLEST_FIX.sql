-- Simplest fix: Cast TEXT to UUID directly in WHERE clauses
DROP FUNCTION IF EXISTS get_unavailable_tickets(TEXT) CASCADE;

CREATE OR REPLACE FUNCTION get_unavailable_tickets(p_competition_id TEXT)
RETURNS INTEGER[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_result INTEGER[];
BEGIN
  -- Get all unavailable tickets using UNION with UUID casts
  SELECT array_agg(DISTINCT t ORDER BY t) INTO v_result
  FROM (
    -- From joincompetition
    SELECT DISTINCT CAST(TRIM(unnest(string_to_array(ticketnumbers, ','))) AS INTEGER) AS t
    FROM joincompetition
    WHERE competitionid = p_competition_id::UUID
      AND ticketnumbers IS NOT NULL

    UNION

    -- From tickets table
    SELECT ticket_number AS t
    FROM tickets
    WHERE competition_id = p_competition_id::UUID
      AND ticket_number IS NOT NULL

    -- From pending_ticket_items
    UNION
    SELECT pti.ticket_number AS t
    FROM pending_ticket_items pti
    JOIN pending_tickets pt ON pti.pending_ticket_id = pt.id
    WHERE pti.competition_id = p_competition_id::UUID
      AND pt.status IN ('pending', 'confirming')
      AND pt.expires_at > NOW()
  ) AS all_tickets;

  RETURN COALESCE(v_result, ARRAY[]::INTEGER[]);
END;
$$;

GRANT EXECUTE ON FUNCTION get_unavailable_tickets(TEXT) TO authenticated, anon, service_role;
