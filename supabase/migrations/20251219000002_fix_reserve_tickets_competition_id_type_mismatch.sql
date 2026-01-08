/*
  # Fix reserve_tickets_atomically: Competition ID Type Mismatch

  ## Problem:
  The reserve_tickets_atomically function compares `jc.competitionid` (TEXT column)
  with `p_competition_id` (UUID parameter) without casting. This can cause:
  - Silent failures (no results returned)
  - Type mismatch errors

  The joincompetition.competitionid column stores IDs as TEXT since it can contain
  either UUID strings or legacy uid strings.

  ## Solution:
  Cast the UUID parameter to TEXT when comparing with the competitionid column.
  This ensures proper string comparison.
*/

CREATE OR REPLACE FUNCTION reserve_tickets_atomically(
    p_user_id TEXT,
    p_competition_id UUID,
    p_ticket_numbers INTEGER[],
    p_ticket_price DECIMAL DEFAULT 1,
    p_reservation_id UUID DEFAULT gen_random_uuid(),
    p_expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '15 minutes'),
    p_session_id TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_unavailable_tickets INTEGER[] := ARRAY[]::INTEGER[];
    v_sold_tickets_jc INTEGER[] := ARRAY[]::INTEGER[];
    v_sold_tickets_table INTEGER[] := ARRAY[]::INTEGER[];
    v_all_sold_tickets INTEGER[] := ARRAY[]::INTEGER[];
    v_pending_tickets INTEGER[] := ARRAY[]::INTEGER[];
    v_competition_exists BOOLEAN;
    v_total_tickets INTEGER;
    v_max_ticket INTEGER;
    v_ticket_num INTEGER;
    v_reservation_exists BOOLEAN;
    v_comp_uid TEXT;
BEGIN
    -- Check if competition exists and get its uid for legacy entries lookup
    SELECT EXISTS(
        SELECT 1 FROM competitions
        WHERE id = p_competition_id AND status = 'active'
    ), total_tickets, uid
    INTO v_competition_exists, v_total_tickets, v_comp_uid
    FROM competitions
    WHERE id = p_competition_id;

    IF NOT v_competition_exists THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Competition not found or not active'
        );
    END IF;

    v_max_ticket := COALESCE(v_total_tickets, 1000);

    -- Check if user already has a pending reservation for this competition
    SELECT EXISTS(
        SELECT 1 FROM pending_tickets
        WHERE user_id = p_user_id
        AND competition_id = p_competition_id
        AND status = 'pending'
        AND expires_at > NOW()
    ) INTO v_reservation_exists;

    -- If reservation exists, cancel it first
    IF v_reservation_exists THEN
        UPDATE pending_tickets
        SET status = 'cancelled', updated_at = NOW()
        WHERE user_id = p_user_id
        AND competition_id = p_competition_id
        AND status = 'pending'
        AND expires_at > NOW();
    END IF;

    -- Get currently sold tickets from joincompetition table (comma-separated format)
    -- NOTE: jc.competitionid is TEXT column, can store UUID string or legacy uid
    -- We check against both the UUID (cast to text) AND the legacy uid if different
    SELECT array_agg(DISTINCT ticket_num)
    INTO v_sold_tickets_jc
    FROM (
        SELECT CAST(trim(unnest(string_to_array(jc.ticketnumbers, ','))) AS integer) AS ticket_num
        FROM joincompetition jc
        WHERE (
            jc.competitionid = p_competition_id::text
            OR (v_comp_uid IS NOT NULL AND jc.competitionid = v_comp_uid)
        )
          AND jc.ticketnumbers IS NOT NULL
          AND trim(jc.ticketnumbers) != ''
    ) AS jc_tickets
    WHERE ticket_num IS NOT NULL;

    -- Get currently sold tickets from tickets table
    SELECT array_agg(DISTINCT t.ticket_number)
    INTO v_sold_tickets_table
    FROM tickets t
    WHERE t.competition_id = p_competition_id;

    -- Combine sold tickets from both sources
    v_all_sold_tickets := COALESCE(v_sold_tickets_jc, ARRAY[]::INTEGER[]) || COALESCE(v_sold_tickets_table, ARRAY[]::INTEGER[]);

    -- Remove duplicates
    SELECT array_agg(DISTINCT u) INTO v_all_sold_tickets FROM unnest(v_all_sold_tickets) AS u;

    -- Get currently pending ticket numbers
    SELECT array_agg(pt.ticket_number) INTO v_pending_tickets
    FROM (
        SELECT unnest(ticket_numbers) as ticket_number
        FROM pending_tickets
        WHERE competition_id = p_competition_id
        AND status = 'pending'
        AND expires_at > NOW()
    ) pt;

    -- Check each selected ticket for availability
    FOREACH v_ticket_num IN ARRAY p_ticket_numbers LOOP
        -- Check if ticket is out of range
        IF v_ticket_num < 1 OR v_ticket_num > v_max_ticket THEN
            RETURN json_build_object(
                'success', false,
                'error', 'Ticket number ' || v_ticket_num || ' is out of range (1-' || v_max_ticket || ')'
            );
        END IF;

        -- Check if ticket is already sold (from either table)
        IF v_ticket_num = ANY(COALESCE(v_all_sold_tickets, ARRAY[]::INTEGER[])) THEN
            v_unavailable_tickets := array_append(v_unavailable_tickets, v_ticket_num);
        END IF;

        -- Check if ticket is currently reserved
        IF v_ticket_num = ANY(COALESCE(v_pending_tickets, ARRAY[]::INTEGER[])) THEN
            v_unavailable_tickets := array_append(v_unavailable_tickets, v_ticket_num);
        END IF;
    END LOOP;

    -- If any tickets are unavailable, return them
    IF array_length(v_unavailable_tickets, 1) > 0 THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Some tickets are not available',
            'unavailable_tickets', v_unavailable_tickets
        );
    END IF;

    -- All tickets are available, create the reservation
    INSERT INTO pending_tickets (
        id,
        user_id,
        competition_id,
        ticket_numbers,
        ticket_count,
        ticket_price,
        total_amount,
        status,
        session_id,
        expires_at,
        created_at,
        updated_at
    ) VALUES (
        p_reservation_id,
        p_user_id,
        p_competition_id,
        p_ticket_numbers,
        array_length(p_ticket_numbers, 1),
        p_ticket_price,
        p_ticket_price * array_length(p_ticket_numbers, 1),
        'pending',
        p_session_id,
        p_expires_at,
        NOW(),
        NOW()
    );

    -- Return success
    RETURN json_build_object(
        'success', true,
        'reservation_id', p_reservation_id,
        'ticket_numbers', p_ticket_numbers,
        'ticket_count', array_length(p_ticket_numbers, 1),
        'total_amount', p_ticket_price * array_length(p_ticket_numbers, 1),
        'expires_at', p_expires_at
    );

EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Failed to reserve tickets: ' || SQLERRM
        );
END;
$$;
