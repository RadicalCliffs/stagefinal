-- Part 2: Create get_user_tickets_for_competition RPC function

DROP FUNCTION IF EXISTS get_user_tickets_for_competition(text, text);

CREATE OR REPLACE FUNCTION get_user_tickets_for_competition(
  user_id text,
  competition_id text
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $func$
DECLARE
  v_comp_uuid uuid;
  v_tickets integer[];
  v_ticket_count integer;
BEGIN
  IF user_id IS NULL OR trim(user_id) = '' OR competition_id IS NULL OR trim(competition_id) = '' THEN
    RETURN NULL;
  END IF;

  BEGIN
    v_comp_uuid := competition_id::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    SELECT c.id INTO v_comp_uuid
    FROM competitions c
    WHERE c.uid = competition_id
    LIMIT 1;
  END;

  IF v_comp_uuid IS NULL THEN
    RETURN NULL;
  END IF;

  WITH all_tickets AS (
    SELECT DISTINCT CAST(trim(t_num) AS integer) AS ticket_num
    FROM (
      SELECT unnest(string_to_array(jc.ticketnumbers, ',')) AS t_num
      FROM joincompetition jc
      WHERE jc.competitionid = v_comp_uuid::text
        AND (jc.privy_user_id = user_id OR jc.wallet_address = user_id)
        AND jc.ticketnumbers IS NOT NULL
        AND trim(jc.ticketnumbers) != ''
    ) jc_tickets
    WHERE trim(t_num) ~ '^[0-9]+$'

    UNION

    SELECT DISTINCT t.ticket_number AS ticket_num
    FROM tickets t
    WHERE t.competition_id = v_comp_uuid
      AND (t.privy_user_id = user_id OR t.user_id::text = user_id)
  )
  SELECT array_agg(ticket_num ORDER BY ticket_num), count(*)::integer
  INTO v_tickets, v_ticket_count
  FROM all_tickets;

  RETURN json_build_object(
    'tickets', COALESCE(v_tickets, ARRAY[]::integer[]),
    'ticket_count', COALESCE(v_ticket_count, 0)
  );
END;
$func$;
