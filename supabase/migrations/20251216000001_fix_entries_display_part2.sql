/*
  # Fix Entries Display and Reservation Handling - Part 2

  ## Problem Addressed:
  When checking ticket availability, user's own pending (soon-to-be-cancelled) reservations
  are incorrectly counted as unavailable, causing 409 errors

  ## Solution:
  Add get_available_tickets_excluding_user_pending RPC that excludes user's own pending reservations
*/

DROP FUNCTION IF EXISTS get_available_tickets_excluding_user_pending(uuid, text);

CREATE OR REPLACE FUNCTION get_available_tickets_excluding_user_pending(
  p_competition_id uuid,
  p_user_id text
)
RETURNS TABLE (
  ticket_number integer
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $func$
DECLARE
  v_total_tickets integer;
BEGIN
  -- Get total tickets for the competition
  SELECT c.total_tickets INTO v_total_tickets
  FROM competitions c
  WHERE c.id = p_competition_id;

  IF v_total_tickets IS NULL OR v_total_tickets <= 0 THEN
    RETURN; -- No tickets available
  END IF;

  -- Return all ticket numbers that are NOT:
  -- 1. Already sold (in joincompetition)
  -- 2. Already in tickets table
  -- 3. Pending by OTHER users (not the requesting user)
  RETURN QUERY
  SELECT g.num::integer as ticket_number
  FROM generate_series(1, v_total_tickets) AS g(num)
  WHERE
    -- Not in joincompetition (sold)
    NOT EXISTS (
      SELECT 1 FROM joincompetition jc
      WHERE jc.competitionid = p_competition_id::text
        AND jc.ticketnumbers LIKE '%' || g.num::text || '%'
    )
    -- Not in tickets table (sold)
    AND NOT EXISTS (
      SELECT 1 FROM tickets t
      WHERE t.competition_id = p_competition_id
        AND t.ticket_number = g.num
    )
    -- Not pending by OTHER users (excluding requesting user's pending reservations)
    AND NOT EXISTS (
      SELECT 1 FROM pending_tickets pt
      WHERE pt.competition_id = p_competition_id
        AND pt.status = 'pending'
        AND pt.expires_at > NOW()
        AND pt.user_id != p_user_id  -- Exclude requesting user's reservations
        AND g.num = ANY(pt.ticket_numbers)
    )
  ORDER BY g.num;
END;
$func$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_available_tickets_excluding_user_pending(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_available_tickets_excluding_user_pending(uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION get_available_tickets_excluding_user_pending(uuid, text) TO service_role;

COMMENT ON FUNCTION get_available_tickets_excluding_user_pending(uuid, text) IS
'Returns available ticket numbers for a competition, excluding tickets that are sold or pending by OTHER users.
The requesting user''s own pending reservations are NOT excluded (since they''ll be cancelled for new reservations).
This prevents 409 errors when a user tries to reserve tickets that were previously in their own pending reservation.';
