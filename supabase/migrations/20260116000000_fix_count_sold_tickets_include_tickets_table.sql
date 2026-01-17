/*
  # Fix count_sold_tickets_for_competition to include tickets table

  ## Problem:
  The `count_sold_tickets_for_competition` RPC function was only counting tickets
  from the `joincompetition` table. However, tickets can also be stored directly
  in the `tickets` table when purchased through certain payment flows.

  This caused competitions at 100% tickets sold to NOT be moved to "drawn" status
  because the lifecycle checker uses this RPC and wasn't seeing the full count.

  ## Solution:
  Update the function to count tickets from BOTH:
  1. `joincompetition.ticketnumbers` (comma-separated list)
  2. `tickets.ticket_number` (individual rows)

  This matches the behavior of `get_competition_ticket_availability_text` which
  correctly counts from both tables.
*/

-- Drop existing function
DROP FUNCTION IF EXISTS count_sold_tickets_for_competition(UUID);

-- Recreate with fix to include tickets table
CREATE OR REPLACE FUNCTION count_sold_tickets_for_competition(
    p_competition_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_comp_uid TEXT;
    v_joincompetition_count INTEGER := 0;
    v_tickets_table_count INTEGER := 0;
    v_total INTEGER := 0;
BEGIN
    -- Cast p_competition_id to TEXT since competitions.id is TEXT type
    -- Also get the legacy uid for matching entries stored with uid
    SELECT c.uid INTO v_comp_uid
    FROM competitions c
    WHERE c.id = p_competition_id::text;

    -- Count tickets from joincompetition table (comma-separated ticketnumbers)
    SELECT COALESCE(SUM(
        ARRAY_LENGTH(
            STRING_TO_ARRAY(NULLIF(TRIM(jc.ticketnumbers), ''), ','),
            1
        )
    ), 0)
    INTO v_joincompetition_count
    FROM joincompetition jc
    WHERE (jc.competitionid = p_competition_id::text
       OR (v_comp_uid IS NOT NULL AND jc.competitionid = v_comp_uid))
      AND jc.ticketnumbers IS NOT NULL
      AND TRIM(jc.ticketnumbers) != '';

    -- Count tickets from tickets table (individual rows)
    -- Only count tickets NOT already in joincompetition to avoid double-counting
    SELECT COUNT(DISTINCT t.ticket_number)
    INTO v_tickets_table_count
    FROM tickets t
    WHERE t.competition_id = p_competition_id
      -- Exclude ticket numbers that are already counted in joincompetition
      AND NOT EXISTS (
        SELECT 1
        FROM joincompetition jc
        WHERE (jc.competitionid = p_competition_id::text
           OR (v_comp_uid IS NOT NULL AND jc.competitionid = v_comp_uid))
          AND jc.ticketnumbers IS NOT NULL
          AND TRIM(jc.ticketnumbers) != ''
          AND t.ticket_number::text = ANY(STRING_TO_ARRAY(TRIM(jc.ticketnumbers), ','))
      );

    -- Total is sum of both sources
    v_total := v_joincompetition_count + v_tickets_table_count;

    RETURN v_total;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION count_sold_tickets_for_competition(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION count_sold_tickets_for_competition(UUID) TO anon;
GRANT EXECUTE ON FUNCTION count_sold_tickets_for_competition(UUID) TO service_role;

COMMENT ON FUNCTION count_sold_tickets_for_competition(UUID) IS
'Counts total sold tickets for a competition from both joincompetition and tickets tables.
Handles UUID to TEXT conversion for competition ID matching and avoids double-counting.
Used by competition-lifecycle-checker to detect sold-out competitions.';
