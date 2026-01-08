-- Migration: Add missing text wrapper RPC functions
-- Date: 2026-01-01
-- Purpose: Create text-input wrapper functions for RPCs that frontend calls with text parameters
--
-- Issue: The frontend code calls `get_competition_ticket_availability_text(competition_id_text)`
-- but only `get_competition_ticket_availability(uuid)` exists. This causes RPC errors
-- which make the ticket availability display reset to zero.

-- ============================================================================
-- 1. Create text wrapper for get_competition_ticket_availability
-- ============================================================================
-- This wrapper accepts a TEXT parameter and casts it to UUID internally
-- Avoids "uuid = text" type mismatch errors when frontend passes string IDs

CREATE OR REPLACE FUNCTION get_competition_ticket_availability_text(competition_id_text TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_competition_uuid uuid;
  v_result json;
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
    -- Not a valid UUID format
    RETURN json_build_object(
      'competition_id', competition_id_text,
      'total_tickets', 0,
      'available_tickets', ARRAY[]::INTEGER[],
      'sold_count', 0,
      'available_count', 0,
      'error', 'Invalid UUID format'
    );
  END;

  -- Call the main function with the UUID
  SELECT get_competition_ticket_availability(v_competition_uuid) INTO v_result;

  RETURN v_result;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_competition_ticket_availability_text(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_competition_ticket_availability_text(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_competition_ticket_availability_text(TEXT) TO service_role;

-- Add comment
COMMENT ON FUNCTION get_competition_ticket_availability_text(TEXT) IS
'Text wrapper for get_competition_ticket_availability. Accepts competition ID as TEXT and casts to UUID internally.
Used by frontend to avoid uuid=text type mismatch errors when calling from JavaScript.';

-- ============================================================================
-- 2. Ensure get_competition_ticket_availability exists with correct signature
-- ============================================================================
-- Recreate if needed to ensure it exists and handles edge cases properly

CREATE OR REPLACE FUNCTION get_competition_ticket_availability(p_competition_id uuid)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
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
BEGIN
  -- Check if competition exists and get basic info
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

  -- Get sold tickets from joincompetition table (comma-separated string format)
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

  -- Get sold tickets from tickets table
  SELECT array_agg(DISTINCT ticket_number)
  INTO v_sold_tickets_table
  FROM tickets
  WHERE competition_id = p_competition_id;

  -- Merge sold tickets from both tables
  v_unavailable_tickets := COALESCE(v_sold_tickets_jc, ARRAY[]::INTEGER[]) || COALESCE(v_sold_tickets_table, ARRAY[]::INTEGER[]);

  -- Get pending reservations that haven't expired
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

  -- Add pending tickets to unavailable
  v_unavailable_tickets := v_unavailable_tickets || COALESCE(v_pending_tickets, ARRAY[]::INTEGER[]);

  -- Remove duplicates
  SELECT array_agg(DISTINCT u) INTO v_unavailable_tickets FROM unnest(v_unavailable_tickets) AS u;

  -- Generate available tickets (1 to total_tickets, excluding unavailable)
  FOR v_ticket_num IN 1..v_total_tickets LOOP
    IF NOT (v_ticket_num = ANY(COALESCE(v_unavailable_tickets, ARRAY[]::INTEGER[]))) THEN
      v_available_tickets := array_append(v_available_tickets, v_ticket_num);
    END IF;
  END LOOP;

  -- Build and return result
  RETURN json_build_object(
    'competition_id', p_competition_id,
    'total_tickets', v_total_tickets,
    'available_tickets', COALESCE(v_available_tickets, ARRAY[]::INTEGER[]),
    'sold_count', COALESCE(array_length(v_unavailable_tickets, 1), 0),
    'available_count', COALESCE(array_length(v_available_tickets, 1), v_total_tickets)
  );
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_competition_ticket_availability(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_competition_ticket_availability(uuid) TO anon;
GRANT EXECUTE ON FUNCTION get_competition_ticket_availability(uuid) TO service_role;

-- Add comment
COMMENT ON FUNCTION get_competition_ticket_availability(uuid) IS
'Returns ticket availability for a competition including sold count, available count, and list of available ticket numbers.
Combines data from joincompetition table, tickets table, and pending_tickets to give accurate availability.';
