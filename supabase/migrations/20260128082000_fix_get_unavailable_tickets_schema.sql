-- ============================================================================
-- Fix get_unavailable_tickets to use correct schema
-- ============================================================================
-- Problem: Current RPC tries to query pending_tickets.ticket_numbers which doesn't exist
-- Solution: Query pending_ticket_items table which has the actual ticket_number column
-- 
-- Schema Reference:
-- pending_tickets: id, user_id, competition_id, ticket_count, total_amount, status, expires_at, created_at
-- pending_ticket_items: id, pending_ticket_id, competition_id, ticket_number, created_at
-- joincompetition: id, userid, competitionid, ticketnumbers (INTEGER[]), joinedat, created_at
-- tickets: id, competition_id, ticket_number, user_id, canonical_user_id, wallet_address, status, ...
-- ============================================================================

DROP FUNCTION IF EXISTS get_unavailable_tickets(TEXT) CASCADE;
DROP FUNCTION IF EXISTS get_unavailable_tickets(UUID) CASCADE;

CREATE OR REPLACE FUNCTION get_unavailable_tickets(competition_id TEXT)
RETURNS INT4[]
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
  -- Handle NULL or empty input
  IF competition_id IS NULL OR TRIM(competition_id) = '' THEN
    RETURN ARRAY[]::INTEGER[];
  END IF;

  -- Parse UUID
  BEGIN
    v_competition_uuid := competition_id::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    SELECT c.id, c.uid INTO v_competition_uuid, v_comp_uid
    FROM competitions c
    WHERE c.uid = competition_id
    LIMIT 1;

    IF v_competition_uuid IS NULL THEN
      RETURN ARRAY[]::INTEGER[];
    END IF;
  END;

  -- Get uid if not already set
  IF v_comp_uid IS NULL THEN
    SELECT c.uid INTO v_comp_uid
    FROM competitions c
    WHERE c.id = v_competition_uuid;
  END IF;

  -- Get sold tickets from joincompetition (competitionid is TEXT)
  -- SCHEMA: joincompetition.ticketnumbers is INTEGER[] or comma-separated string
  SELECT COALESCE(array_agg(DISTINCT ticket_num), ARRAY[]::INTEGER[])
  INTO v_sold_jc
  FROM (
    SELECT CAST(TRIM(unnest(string_to_array(ticketnumbers::TEXT, ','))) AS INTEGER) AS ticket_num
    FROM joincompetition
    WHERE (
      competitionid = v_competition_uuid::TEXT
      OR (v_comp_uid IS NOT NULL AND competitionid = v_comp_uid)
      OR competitionid = competition_id
    )
      AND ticketnumbers IS NOT NULL
      AND TRIM(ticketnumbers::TEXT) != ''
  ) AS jc_tickets
  WHERE ticket_num IS NOT NULL;

  v_sold_jc := COALESCE(v_sold_jc, ARRAY[]::INTEGER[]);

  -- Get sold tickets from tickets table (competition_id is TEXT in schema)
  -- SCHEMA: tickets.competition_id is TEXT, tickets.ticket_number is INTEGER
  BEGIN
    SELECT COALESCE(array_agg(DISTINCT t.ticket_number), ARRAY[]::INTEGER[])
    INTO v_sold_tickets
    FROM tickets t
    WHERE t.competition_id = competition_id
      OR t.competition_id = v_competition_uuid::TEXT
      OR (v_comp_uid IS NOT NULL AND t.competition_id = v_comp_uid);
  EXCEPTION WHEN OTHERS THEN
    v_sold_tickets := ARRAY[]::INTEGER[];
  END;

  v_sold_tickets := COALESCE(v_sold_tickets, ARRAY[]::INTEGER[]);

  -- Get pending tickets from pending_ticket_items (NOT pending_tickets!)
  -- SCHEMA: pending_ticket_items has ticket_number (INTEGER, singular)
  -- Need to join with pending_tickets to check expires_at and status
  BEGIN
    SELECT COALESCE(array_agg(DISTINCT pti.ticket_number), ARRAY[]::INTEGER[])
    INTO v_pending
    FROM pending_ticket_items pti
    INNER JOIN pending_tickets pt ON pti.pending_ticket_id = pt.id
    WHERE pti.competition_id = competition_id
      AND pt.status IN ('pending', 'confirming')
      AND pt.expires_at > NOW()
      AND pti.ticket_number IS NOT NULL;
  EXCEPTION WHEN undefined_table THEN
    -- If tables don't exist, return empty array
    v_pending := ARRAY[]::INTEGER[];
  END;

  v_pending := COALESCE(v_pending, ARRAY[]::INTEGER[]);

  -- Combine all unavailable tickets
  v_unavailable := v_sold_jc || v_sold_tickets || v_pending;

  -- Remove duplicates and sort
  IF array_length(v_unavailable, 1) IS NOT NULL AND array_length(v_unavailable, 1) > 0 THEN
    SELECT COALESCE(array_agg(DISTINCT u ORDER BY u), ARRAY[]::INTEGER[])
    INTO v_unavailable
    FROM unnest(v_unavailable) AS u
    WHERE u IS NOT NULL;
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
Includes:
- Sold tickets from joincompetition.ticketnumbers
- Sold tickets from tickets.ticket_number
- Pending tickets from pending_ticket_items.ticket_number (joined with pending_tickets for validation)
Uses correct schema: pending_ticket_items, not pending_tickets.ticket_numbers';
