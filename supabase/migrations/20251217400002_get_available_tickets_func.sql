-- PART 6: HELPER FUNCTION - Get Available Tickets

CREATE OR REPLACE FUNCTION get_available_tickets(
  p_competition_id UUID,
  p_count INTEGER DEFAULT NULL
)
RETURNS TABLE(ticket_number INTEGER) AS $func$
DECLARE
  v_total_tickets INTEGER;
BEGIN
  -- Get total tickets for competition
  SELECT total_tickets INTO v_total_tickets
  FROM competitions
  WHERE id = p_competition_id;

  IF v_total_tickets IS NULL THEN
    RETURN;
  END IF;

  -- Return available ticket numbers
  RETURN QUERY
  SELECT t.num
  FROM generate_series(1, v_total_tickets) AS t(num)
  WHERE NOT EXISTS (
    -- Check sold tickets
    SELECT 1 FROM tickets tk
    WHERE tk.competition_id = p_competition_id
      AND tk.ticket_number = t.num
  )
  AND NOT EXISTS (
    -- Check pending reservations
    SELECT 1 FROM pending_tickets pt
    WHERE pt.competition_id = p_competition_id
      AND pt.status = 'pending'
      AND pt.expires_at > NOW()
      AND t.num = ANY(pt.ticket_numbers)
  )
  ORDER BY random()
  LIMIT p_count;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;
