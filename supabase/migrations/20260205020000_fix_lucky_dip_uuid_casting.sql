-- =====================================================
-- Fix Lucky Dip RPC functions to handle UUID casting
-- =====================================================
-- Issue: competition_id changed from TEXT to UUID in some tables
-- but RPC functions still use TEXT parameters
-- This causes "operator does not exist: uuid = text" errors
-- Solution: Cast TEXT to UUID when comparing with UUID columns
-- Date: 2026-02-05
-- =====================================================

BEGIN;

-- Fix allocate_lucky_dip_tickets to cast competition_id to UUID
CREATE OR REPLACE FUNCTION allocate_lucky_dip_tickets(
  p_competition_id TEXT,
  p_user_id TEXT,
  p_ticket_count INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allocated_tickets INTEGER[];
  v_total_tickets INTEGER;
  v_sold_tickets INTEGER;
  v_ticket INTEGER;
  v_unavailable INTEGER[];
BEGIN
  -- Get competition info (competitions.id is UUID now)
  SELECT total_tickets, sold_tickets INTO v_total_tickets, v_sold_tickets
  FROM competitions
  WHERE id = p_competition_id::UUID OR uid = p_competition_id::UUID;

  -- Get unavailable tickets (tickets_sold.competition_id is still TEXT)
  SELECT ARRAY_AGG(ticket_number) INTO v_unavailable
  FROM tickets_sold
  WHERE competition_id = p_competition_id;

  -- Allocate tickets
  v_allocated_tickets := ARRAY[]::INTEGER[];
  FOR v_ticket IN 1..v_total_tickets
  LOOP
    IF v_ticket = ANY(COALESCE(v_unavailable, ARRAY[]::INTEGER[])) THEN
      CONTINUE;
    END IF;
    IF array_length(v_allocated_tickets, 1) >= p_ticket_count THEN
      EXIT;
    END IF;
    v_allocated_tickets := array_append(v_allocated_tickets, v_ticket);
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'ticket_numbers', v_allocated_tickets
  );
END;
$$;

-- Fix finalize_order to cast competition_id to UUID
CREATE OR REPLACE FUNCTION finalize_order(
  p_reservation_id TEXT,
  p_user_id TEXT,
  p_competition_id TEXT,
  p_unit_price NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket_numbers INTEGER[];
  v_ticket_number INTEGER;
  v_ticket_count INTEGER;
  v_canonical_user_id TEXT;
BEGIN
  -- Get canonical user ID
  SELECT canonical_user_id INTO v_canonical_user_id
  FROM canonical_users
  WHERE uid = p_user_id OR canonical_user_id = p_user_id
  LIMIT 1;

  -- Get reserved tickets (pending_ticket_items.competition_id is still TEXT)
  SELECT ARRAY_AGG(ticket_number) INTO v_ticket_numbers
  FROM pending_ticket_items
  WHERE pending_ticket_id = p_reservation_id;

  v_ticket_count := array_length(v_ticket_numbers, 1);

  -- Create tickets (tickets.competition_id is UUID now)
  FOREACH v_ticket_number IN ARRAY v_ticket_numbers
  LOOP
    INSERT INTO tickets (
      competition_id,
      ticket_number,
      user_id,
      canonical_user_id,
      status,
      purchase_price
    ) VALUES (
      p_competition_id::UUID,  -- Cast to UUID
      v_ticket_number,
      p_user_id,
      v_canonical_user_id,
      'active',
      p_unit_price
    ) ON CONFLICT DO NOTHING;

    -- Mark as sold (tickets_sold.competition_id is still TEXT)
    INSERT INTO tickets_sold (competition_id, ticket_number, purchaser_id)
    VALUES (p_competition_id, v_ticket_number, p_user_id)
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- Update competition sold_tickets count (competitions.id is UUID now)
  UPDATE competitions
  SET sold_tickets = sold_tickets + v_ticket_count
  WHERE id = p_competition_id::UUID OR uid = p_competition_id::UUID;

  -- Delete pending tickets (pending_ticket_items.competition_id is still TEXT)
  DELETE FROM pending_ticket_items WHERE pending_ticket_id = p_reservation_id;
  DELETE FROM pending_tickets WHERE id = p_reservation_id;

  RETURN jsonb_build_object(
    'success', true,
    'ticket_count', v_ticket_count,
    'ticket_numbers', v_ticket_numbers
  );
END;
$$;

-- Fix get_unavailable_tickets to properly handle UUID casting for tickets table
CREATE OR REPLACE FUNCTION get_unavailable_tickets(p_competition_id TEXT)
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
  IF p_competition_id IS NULL OR TRIM(p_competition_id) = '' THEN
    RETURN ARRAY[]::INTEGER[];
  END IF;

  -- Parse UUID
  BEGIN
    v_competition_uuid := p_competition_id::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    SELECT c.id, c.uid INTO v_competition_uuid, v_comp_uid
    FROM competitions c
    WHERE c.uid = p_competition_id::UUID
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
  SELECT COALESCE(array_agg(DISTINCT ticket_num), ARRAY[]::INTEGER[])
  INTO v_sold_jc
  FROM (
    SELECT CAST(TRIM(unnest(string_to_array(ticketnumbers::TEXT, ','))) AS INTEGER) AS ticket_num
    FROM joincompetition
    WHERE (
      competitionid = v_competition_uuid::TEXT
      OR (v_comp_uid IS NOT NULL AND competitionid = v_comp_uid::TEXT)
      OR competitionid = p_competition_id
    )
      AND ticketnumbers IS NOT NULL
      AND TRIM(ticketnumbers::TEXT) != ''
  ) AS jc_tickets
  WHERE ticket_num IS NOT NULL;

  v_sold_jc := COALESCE(v_sold_jc, ARRAY[]::INTEGER[]);

  -- Get sold tickets from tickets table (competition_id is now UUID)
  BEGIN
    SELECT COALESCE(array_agg(DISTINCT t.ticket_number), ARRAY[]::INTEGER[])
    INTO v_sold_tickets
    FROM tickets t
    WHERE t.competition_id = v_competition_uuid
      OR (v_comp_uid IS NOT NULL AND t.competition_id = v_comp_uid);
  EXCEPTION WHEN undefined_table THEN
    v_sold_tickets := ARRAY[]::INTEGER[];
  WHEN undefined_column THEN
    v_sold_tickets := ARRAY[]::INTEGER[];
  END;

  v_sold_tickets := COALESCE(v_sold_tickets, ARRAY[]::INTEGER[]);

  -- Get pending tickets from pending_ticket_items (competition_id is still TEXT)
  BEGIN
    SELECT COALESCE(array_agg(DISTINCT pti.ticket_number), ARRAY[]::INTEGER[])
    INTO v_pending
    FROM pending_ticket_items pti
    INNER JOIN pending_tickets pt ON pti.pending_ticket_id = pt.id
    WHERE (
      pti.competition_id = p_competition_id
      OR pti.competition_id = v_competition_uuid::TEXT
      OR (v_comp_uid IS NOT NULL AND pti.competition_id = v_comp_uid::TEXT)
    )
      AND pt.status = 'pending'
      AND pt.expires_at > NOW();
  EXCEPTION WHEN undefined_table THEN
    v_pending := ARRAY[]::INTEGER[];
  WHEN undefined_column THEN
    v_pending := ARRAY[]::INTEGER[];
  END;

  v_pending := COALESCE(v_pending, ARRAY[]::INTEGER[]);

  -- Combine all unavailable tickets
  v_unavailable := ARRAY(
    SELECT DISTINCT unnest(v_sold_jc || v_sold_tickets || v_pending)
    ORDER BY 1
  );

  RETURN v_unavailable;
END;
$$;

-- Fix get_available_ticket_count_v2 to cast competition_id to UUID
CREATE OR REPLACE FUNCTION get_available_ticket_count_v2(p_competition_id TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total INTEGER;
  v_sold INTEGER;
BEGIN
  SELECT total_tickets, sold_tickets INTO v_total, v_sold
  FROM competitions
  WHERE id = p_competition_id::UUID OR uid = p_competition_id::UUID;

  RETURN COALESCE(v_total, 0) - COALESCE(v_sold, 0);
END;
$$;

-- Fix check_and_mark_competition_sold_out to cast competition_id to UUID
CREATE OR REPLACE FUNCTION check_and_mark_competition_sold_out(p_competition_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total INTEGER;
  v_sold INTEGER;
  v_is_sold_out BOOLEAN;
BEGIN
  SELECT total_tickets, sold_tickets INTO v_total, v_sold
  FROM competitions
  WHERE id = p_competition_id::UUID OR uid = p_competition_id::UUID;

  v_is_sold_out := v_sold >= v_total;

  IF v_is_sold_out THEN
    UPDATE competitions
    SET status = 'sold_out'
    WHERE id = p_competition_id::UUID OR uid = p_competition_id::UUID;
  END IF;

  RETURN jsonb_build_object(
    'is_sold_out', v_is_sold_out,
    'total_tickets', v_total,
    'sold_tickets', v_sold
  );
END;
$$;

-- Fix sync_competition_status_if_ended to cast competition_id to UUID
CREATE OR REPLACE FUNCTION sync_competition_status_if_ended(p_competition_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_end_date TIMESTAMP WITH TIME ZONE;
  v_current_status TEXT;
BEGIN
  SELECT end_date, status INTO v_end_date, v_current_status
  FROM competitions
  WHERE id = p_competition_id OR uid = p_competition_id;

  IF v_end_date IS NOT NULL AND v_end_date < NOW() AND v_current_status != 'ended' THEN
    UPDATE competitions
    SET status = 'ended'
    WHERE id = p_competition_id OR uid = p_competition_id;

    RETURN jsonb_build_object(
      'status_changed', true,
      'old_status', v_current_status,
      'new_status', 'ended'
    );
  END IF;

  RETURN jsonb_build_object(
    'status_changed', false,
    'current_status', v_current_status
  );
END;
$$;

COMMIT;

-- Log completion
DO $$
BEGIN
  RAISE NOTICE '==============================================';
  RAISE NOTICE 'Lucky Dip RPC functions updated with UUID casting';
  RAISE NOTICE '==============================================';
  RAISE NOTICE 'Fixed functions:';
  RAISE NOTICE '  - allocate_lucky_dip_tickets: Cast p_competition_id to UUID for competitions table';
  RAISE NOTICE '  - finalize_order: Cast p_competition_id to UUID for competitions and tickets tables';
  RAISE NOTICE '  - get_unavailable_tickets: Cast p_competition_id to UUID for tickets table';
  RAISE NOTICE '  - get_available_ticket_count_v2: Cast p_competition_id to UUID';
  RAISE NOTICE '  - check_and_mark_competition_sold_out: Cast p_competition_id to UUID';
  RAISE NOTICE '  - sync_competition_status_if_ended: Cast p_competition_id to UUID';
  RAISE NOTICE '';
  RAISE NOTICE 'This fixes "operator does not exist: uuid = text" errors';
  RAISE NOTICE '==============================================';
END $$;
