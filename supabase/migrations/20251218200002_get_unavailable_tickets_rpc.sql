-- Part 3: Create get_unavailable_tickets_for_competition_bypass_rls RPC

DROP FUNCTION IF EXISTS get_unavailable_tickets_for_competition_bypass_rls(text, text);

CREATE OR REPLACE FUNCTION get_unavailable_tickets_for_competition_bypass_rls(
  competition_identifier text,
  exclude_user_id text DEFAULT NULL
)
RETURNS TABLE (
  ticket_number integer,
  source text,
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $func$
DECLARE
  comp_uuid uuid;
BEGIN
  IF competition_identifier IS NULL OR trim(competition_identifier) = '' THEN
    RETURN;
  END IF;

  BEGIN
    comp_uuid := competition_identifier::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    SELECT c.id INTO comp_uuid
    FROM competitions c
    WHERE c.uid = competition_identifier
    LIMIT 1;
  END;

  IF comp_uuid IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY

  SELECT DISTINCT
    CAST(trim(t_num) AS integer) as ticket_number,
    'sold'::text as source,
    NULL::timestamptz as expires_at
  FROM (
    SELECT unnest(string_to_array(jc.ticketnumbers, ',')) as t_num
    FROM joincompetition jc
    WHERE jc.competitionid = comp_uuid::text
      AND jc.ticketnumbers IS NOT NULL
      AND trim(jc.ticketnumbers) != ''
  ) jc_tickets
  WHERE trim(t_num) ~ '^[0-9]+$'

  UNION ALL

  SELECT DISTINCT
    t.ticket_number,
    'sold'::text as source,
    NULL::timestamptz as expires_at
  FROM tickets t
  WHERE t.competition_id = comp_uuid

  UNION ALL

  SELECT DISTINCT
    pt_ticket as ticket_number,
    'pending'::text as source,
    pt_expires as expires_at
  FROM (
    SELECT
      unnest(pt.ticket_numbers) as pt_ticket,
      pt.expires_at as pt_expires,
      pt.user_id as pt_user_id
    FROM pending_tickets pt
    WHERE pt.competition_id = comp_uuid
      AND pt.status = 'pending'
      AND pt.expires_at > NOW()
  ) pending
  WHERE
    (exclude_user_id IS NULL OR pending.pt_user_id != exclude_user_id)

  ORDER BY ticket_number;
END;
$func$;
