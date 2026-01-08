-- Migration: Fix available_count returning 0 when all tickets are available
-- Issue: When v_unavailable_tickets is NULL (no sold tickets), the FOR loop fails to populate v_available_tickets
-- Root cause: array_agg(DISTINCT u) returns NULL (not empty array) when there are no elements
-- Solution: Explicitly handle NULL arrays and use mathematical calculation for available_count

-- Drop and recreate the function with the fix
CREATE OR REPLACE FUNCTION get_competition_ticket_availability_text(competition_id_text TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_competition_uuid uuid;
  v_total_tickets INTEGER;
  v_competition_exists BOOLEAN;
  v_comp_uid TEXT;
  v_sold_tickets_jc INTEGER[] := ARRAY[]::INTEGER[];
  v_sold_tickets_table INTEGER[] := ARRAY[]::INTEGER[];
  v_pending_tickets INTEGER[] := ARRAY[]::INTEGER[];
  v_unavailable_tickets INTEGER[] := ARRAY[]::INTEGER[];
  v_available_tickets INTEGER[] := ARRAY[]::INTEGER[];
  v_ticket_num INTEGER;
  v_sold_count INTEGER := 0;
  v_available_count INTEGER := 0;
BEGIN
  -- Validate input
  IF competition_id_text IS NULL OR trim(competition_id_text) = '' THEN
    RETURN json_build_object(
      'competition_id', competition_id_text,
      'total_tickets', 0,
      'available_tickets', ARRAY[]::INTEGER[],
      'sold_count', 0,
      'available_count', 0,
      'error', 'Invalid competition ID'
    );
  END IF;

  -- Try to cast to UUID
  BEGIN
    v_competition_uuid := competition_id_text::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    -- Not a valid UUID format, try to lookup by uid
    SELECT id INTO v_competition_uuid
    FROM competitions
    WHERE uid = competition_id_text
    LIMIT 1;

    IF v_competition_uuid IS NULL THEN
      RETURN json_build_object(
        'competition_id', competition_id_text,
        'total_tickets', 0,
        'available_tickets', ARRAY[]::INTEGER[],
        'sold_count', 0,
        'available_count', 0,
        'error', 'Competition not found'
      );
    END IF;
  END;

  -- Check if competition exists and get basic info
  SELECT
    EXISTS(SELECT 1 FROM competitions WHERE id = v_competition_uuid),
    COALESCE(total_tickets, 1000),
    uid
  INTO v_competition_exists, v_total_tickets, v_comp_uid
  FROM competitions
  WHERE id = v_competition_uuid;

  IF NOT v_competition_exists THEN
    RETURN json_build_object(
      'competition_id', competition_id_text,
      'total_tickets', 0,
      'available_tickets', ARRAY[]::INTEGER[],
      'sold_count', 0,
      'available_count', 0,
      'error', 'Competition not found'
    );
  END IF;

  -- Get sold tickets from joincompetition table (comma-separated string format)
  SELECT COALESCE(array_agg(DISTINCT ticket_num), ARRAY[]::INTEGER[])
  INTO v_sold_tickets_jc
  FROM (
    SELECT CAST(trim(unnest(string_to_array(ticketnumbers, ','))) AS integer) AS ticket_num
    FROM joincompetition
    WHERE (
      competitionid = v_competition_uuid::text
      OR (v_comp_uid IS NOT NULL AND competitionid = v_comp_uid)
      OR competitionid = competition_id_text
    )
      AND ticketnumbers IS NOT NULL
      AND trim(ticketnumbers) != ''
  ) AS jc_tickets
  WHERE ticket_num IS NOT NULL;

  -- Ensure it's never NULL
  v_sold_tickets_jc := COALESCE(v_sold_tickets_jc, ARRAY[]::INTEGER[]);

  -- Get sold tickets from tickets table
  SELECT COALESCE(array_agg(DISTINCT ticket_number), ARRAY[]::INTEGER[])
  INTO v_sold_tickets_table
  FROM tickets
  WHERE competition_id = v_competition_uuid;

  -- Ensure it's never NULL
  v_sold_tickets_table := COALESCE(v_sold_tickets_table, ARRAY[]::INTEGER[]);

  -- Merge sold tickets from both tables
  v_unavailable_tickets := v_sold_tickets_jc || v_sold_tickets_table;

  -- Get pending reservations that haven't expired
  BEGIN
    SELECT COALESCE(array_agg(DISTINCT ticket_num), ARRAY[]::INTEGER[])
    INTO v_pending_tickets
    FROM (
      SELECT unnest(ticket_numbers) AS ticket_num
      FROM pending_tickets
      WHERE competition_id = v_competition_uuid
        AND status = 'pending'
        AND expires_at > NOW()
    ) AS pending
    WHERE ticket_num IS NOT NULL;
  EXCEPTION WHEN undefined_table THEN
    v_pending_tickets := ARRAY[]::INTEGER[];
  END;

  -- Ensure pending tickets is never NULL
  v_pending_tickets := COALESCE(v_pending_tickets, ARRAY[]::INTEGER[]);

  -- Add pending tickets to unavailable
  v_unavailable_tickets := v_unavailable_tickets || v_pending_tickets;

  -- Remove duplicates and ensure never NULL
  IF array_length(v_unavailable_tickets, 1) IS NOT NULL AND array_length(v_unavailable_tickets, 1) > 0 THEN
    SELECT COALESCE(array_agg(DISTINCT u), ARRAY[]::INTEGER[])
    INTO v_unavailable_tickets
    FROM unnest(v_unavailable_tickets) AS u;
  ELSE
    v_unavailable_tickets := ARRAY[]::INTEGER[];
  END IF;

  -- Calculate sold count directly (more reliable than array_length)
  v_sold_count := COALESCE(array_length(v_unavailable_tickets, 1), 0);

  -- Calculate available count mathematically (THE FIX - don't rely on array building)
  v_available_count := GREATEST(0, v_total_tickets - v_sold_count);

  -- Generate available tickets array (1 to total_tickets, excluding unavailable)
  -- Only generate if there are actually available tickets
  IF v_available_count > 0 THEN
    FOR v_ticket_num IN 1..v_total_tickets LOOP
      -- Check if this ticket number is NOT in the unavailable array
      -- The key fix: when v_unavailable_tickets is empty array, this condition is always TRUE
      IF v_sold_count = 0 OR NOT (v_ticket_num = ANY(v_unavailable_tickets)) THEN
        v_available_tickets := array_append(v_available_tickets, v_ticket_num);
      END IF;
    END LOOP;
  END IF;

  -- Build and return result
  -- Use the mathematically calculated available_count, not array_length
  RETURN json_build_object(
    'competition_id', v_competition_uuid,
    'total_tickets', v_total_tickets,
    'available_tickets', COALESCE(v_available_tickets, ARRAY[]::INTEGER[]),
    'sold_count', v_sold_count,
    'available_count', v_available_count
  );
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_competition_ticket_availability_text(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_competition_ticket_availability_text(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_competition_ticket_availability_text(TEXT) TO service_role;

COMMENT ON FUNCTION get_competition_ticket_availability_text(TEXT) IS
'Returns ticket availability for a competition. Parameter: competition_id_text (TEXT).
Accepts both UUID strings and legacy uid values.
Returns JSON with: competition_id, total_tickets, available_tickets array, sold_count, available_count.
Fixed: Now correctly returns available_count when no tickets are sold (was returning 0).';


-- Also fix get_unavailable_tickets to ensure it returns empty array, not NULL
CREATE OR REPLACE FUNCTION get_unavailable_tickets(competition_id TEXT)
RETURNS int4[]
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_competition_uuid UUID;
  v_comp_uid TEXT;
  v_unavailable INTEGER[] := ARRAY[]::INTEGER[];
  v_sold_jc INTEGER[] := ARRAY[]::INTEGER[];
  v_sold_tickets INTEGER[] := ARRAY[]::INTEGER[];
  v_pending INTEGER[] := ARRAY[]::INTEGER[];
BEGIN
  -- Try to parse as UUID first
  BEGIN
    v_competition_uuid := competition_id::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    -- Not a UUID, try to find by uid
    SELECT c.id, c.uid INTO v_competition_uuid, v_comp_uid
    FROM competitions c
    WHERE c.uid = competition_id
    LIMIT 1;

    IF v_competition_uuid IS NULL THEN
      RETURN ARRAY[]::INTEGER[];
    END IF;
  END;

  -- Get uid if we found by UUID
  IF v_comp_uid IS NULL THEN
    SELECT c.uid INTO v_comp_uid
    FROM competitions c
    WHERE c.id = v_competition_uuid;
  END IF;

  -- Get sold tickets from joincompetition (comma-separated format)
  SELECT COALESCE(array_agg(DISTINCT ticket_num), ARRAY[]::INTEGER[])
  INTO v_sold_jc
  FROM (
    SELECT CAST(trim(unnest(string_to_array(ticketnumbers, ','))) AS integer) AS ticket_num
    FROM joincompetition
    WHERE (
      competitionid = v_competition_uuid::text
      OR (v_comp_uid IS NOT NULL AND competitionid = v_comp_uid)
      OR competitionid = competition_id
    )
      AND ticketnumbers IS NOT NULL
      AND trim(ticketnumbers) != ''
  ) AS jc_tickets
  WHERE ticket_num IS NOT NULL;

  -- Ensure never NULL
  v_sold_jc := COALESCE(v_sold_jc, ARRAY[]::INTEGER[]);

  -- Get sold tickets from tickets table
  SELECT COALESCE(array_agg(DISTINCT ticket_number), ARRAY[]::INTEGER[])
  INTO v_sold_tickets
  FROM tickets
  WHERE tickets.competition_id = v_competition_uuid;

  -- Ensure never NULL
  v_sold_tickets := COALESCE(v_sold_tickets, ARRAY[]::INTEGER[]);

  -- Get pending tickets
  BEGIN
    SELECT COALESCE(array_agg(DISTINCT ticket_num), ARRAY[]::INTEGER[])
    INTO v_pending
    FROM (
      SELECT unnest(ticket_numbers) AS ticket_num
      FROM pending_tickets
      WHERE pending_tickets.competition_id = v_competition_uuid
        AND status = 'pending'
        AND expires_at > NOW()
    ) AS pending
    WHERE ticket_num IS NOT NULL;
  EXCEPTION WHEN undefined_table THEN
    v_pending := ARRAY[]::INTEGER[];
  END;

  -- Ensure never NULL
  v_pending := COALESCE(v_pending, ARRAY[]::INTEGER[]);

  -- Combine all unavailable
  v_unavailable := v_sold_jc || v_sold_tickets || v_pending;

  -- Remove duplicates and ensure never NULL
  IF array_length(v_unavailable, 1) IS NOT NULL AND array_length(v_unavailable, 1) > 0 THEN
    SELECT COALESCE(array_agg(DISTINCT u), ARRAY[]::INTEGER[])
    INTO v_unavailable
    FROM unnest(v_unavailable) AS u;
  ELSE
    v_unavailable := ARRAY[]::INTEGER[];
  END IF;

  RETURN v_unavailable;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_unavailable_tickets(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_unavailable_tickets(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_unavailable_tickets(TEXT) TO service_role;

COMMENT ON FUNCTION get_unavailable_tickets(TEXT) IS
'Returns array of unavailable ticket numbers for a competition.
Fixed: Now always returns empty array instead of NULL when no tickets are sold.';
