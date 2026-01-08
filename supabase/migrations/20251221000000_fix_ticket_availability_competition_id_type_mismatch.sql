-- Fix get_competition_ticket_availability: Competition ID Type Mismatch
-- Drop existing functions first to avoid parameter name conflicts

-- Drop existing function with either signature
DROP FUNCTION IF EXISTS get_unavailable_tickets_for_competition_bypass_rls(text, text);

-- Part 1: Fix get_competition_ticket_availability function
CREATE OR REPLACE FUNCTION get_competition_ticket_availability(p_competition_id uuid)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $get_comp_ticket_avail$
DECLARE
  v_total_tickets INTEGER;
  v_competition_exists BOOLEAN;
  v_comp_uid TEXT;
  v_sold_tickets_jc INTEGER[] := ARRAY[]::INTEGER[];
  v_sold_tickets_table INTEGER[] := ARRAY[]::INTEGER[];
  v_pending_tickets INTEGER[] := ARRAY[]::INTEGER[];
  v_unavailable_tickets INTEGER[] := ARRAY[]::INTEGER[];
  v_available_tickets INTEGER[] := ARRAY[]::INTEGER[];
  v_ticket_num INTEGER;
  v_result JSON;
BEGIN
  SELECT
    EXISTS(SELECT 1 FROM competitions WHERE id = p_competition_id),
    COALESCE(total_tickets, 1000),
    uid
  INTO v_competition_exists, v_total_tickets, v_comp_uid
  FROM competitions
  WHERE id = p_competition_id;

  IF NOT v_competition_exists THEN
    RETURN json_build_object(
      'competition_id', p_competition_id,
      'total_tickets', 0,
      'available_tickets', ARRAY[]::INTEGER[],
      'sold_count', 0,
      'available_count', 0,
      'error', 'Competition not found'
    );
  END IF;

  SELECT array_agg(DISTINCT ticket_num)
  INTO v_sold_tickets_jc
  FROM (
    SELECT CAST(trim(unnest(string_to_array(ticketnumbers, ','))) AS integer) AS ticket_num
    FROM joincompetition
    WHERE (
      competitionid = p_competition_id::text
      OR (v_comp_uid IS NOT NULL AND competitionid = v_comp_uid)
    )
      AND ticketnumbers IS NOT NULL
      AND trim(ticketnumbers) != ''
  ) AS jc_tickets
  WHERE ticket_num IS NOT NULL;

  SELECT array_agg(DISTINCT ticket_number)
  INTO v_sold_tickets_table
  FROM tickets
  WHERE competition_id = p_competition_id;

  v_unavailable_tickets := COALESCE(v_sold_tickets_jc, ARRAY[]::INTEGER[]) || COALESCE(v_sold_tickets_table, ARRAY[]::INTEGER[]);

  SELECT array_agg(DISTINCT ticket_num)
  INTO v_pending_tickets
  FROM (
    SELECT unnest(ticket_numbers) AS ticket_num
    FROM pending_tickets
    WHERE competition_id = p_competition_id
      AND status = 'pending'
      AND expires_at > NOW()
  ) AS pending
  WHERE ticket_num IS NOT NULL;

  v_unavailable_tickets := v_unavailable_tickets || COALESCE(v_pending_tickets, ARRAY[]::INTEGER[]);
  SELECT array_agg(DISTINCT u) INTO v_unavailable_tickets FROM unnest(v_unavailable_tickets) AS u;

  FOR v_ticket_num IN 1..v_total_tickets LOOP
    IF NOT (v_ticket_num = ANY(COALESCE(v_unavailable_tickets, ARRAY[]::INTEGER[]))) THEN
      v_available_tickets := array_append(v_available_tickets, v_ticket_num);
    END IF;
  END LOOP;

  RETURN json_build_object(
    'competition_id', p_competition_id,
    'total_tickets', v_total_tickets,
    'available_tickets', COALESCE(v_available_tickets, ARRAY[]::INTEGER[]),
    'sold_count', COALESCE(array_length(v_unavailable_tickets, 1), 0),
    'available_count', COALESCE(array_length(v_available_tickets, 1), v_total_tickets)
  );
END;
$get_comp_ticket_avail$;

GRANT EXECUTE ON FUNCTION get_competition_ticket_availability(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_competition_ticket_availability(uuid) TO anon;
GRANT EXECUTE ON FUNCTION get_competition_ticket_availability(uuid) TO service_role;

-- Part 2: Recreate get_unavailable_tickets_for_competition_bypass_rls
CREATE OR REPLACE FUNCTION get_unavailable_tickets_for_competition_bypass_rls(
  p_competition_identifier text,
  p_exclude_user_id text DEFAULT NULL
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
AS $get_unavail_bypass$
DECLARE
  v_comp_uuid uuid;
  v_comp_uid_legacy text;
BEGIN
  IF p_competition_identifier IS NULL OR trim(p_competition_identifier) = '' THEN
    RETURN;
  END IF;

  BEGIN
    v_comp_uuid := p_competition_identifier::uuid;
    SELECT c.uid INTO v_comp_uid_legacy
    FROM competitions c
    WHERE c.id = v_comp_uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    SELECT c.id, c.uid INTO v_comp_uuid, v_comp_uid_legacy
    FROM competitions c
    WHERE c.uid = p_competition_identifier
    LIMIT 1;
  END;

  IF v_comp_uuid IS NULL THEN
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
    WHERE (
      jc.competitionid = v_comp_uuid::text
      OR (v_comp_uid_legacy IS NOT NULL AND jc.competitionid = v_comp_uid_legacy)
    )
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
  WHERE t.competition_id = v_comp_uuid

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
    WHERE pt.competition_id = v_comp_uuid
      AND pt.status = 'pending'
      AND pt.expires_at > NOW()
  ) pending
  WHERE (p_exclude_user_id IS NULL OR pending.pt_user_id != p_exclude_user_id)

  ORDER BY ticket_number;
END;
$get_unavail_bypass$;

GRANT EXECUTE ON FUNCTION get_unavailable_tickets_for_competition_bypass_rls(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_unavailable_tickets_for_competition_bypass_rls(text, text) TO anon;
GRANT EXECUTE ON FUNCTION get_unavailable_tickets_for_competition_bypass_rls(text, text) TO service_role;
