-- ============================================================================
-- FIX ALL FUNCTIONS STILL USING jc.competitionid
-- ============================================================================

-- 1. check_and_mark_competition_sold_out
-- ============================================================================
DROP FUNCTION IF EXISTS public.check_and_mark_competition_sold_out(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.check_and_mark_competition_sold_out(UUID) CASCADE;

CREATE OR REPLACE FUNCTION public.check_and_mark_competition_sold_out(p_competition_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_tickets INTEGER;
  v_sold_count INTEGER;
  v_is_sold_out BOOLEAN := FALSE;
BEGIN
  IF p_competition_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT total_tickets INTO v_total_tickets FROM competitions WHERE id = p_competition_id;
  IF v_total_tickets IS NULL THEN RETURN FALSE; END IF;

  -- Use competition_id NOT competitionid
  SELECT COALESCE(SUM(numberoftickets), 0) INTO v_sold_count
  FROM joincompetition
  WHERE competition_id = p_competition_id;

  IF v_sold_count >= v_total_tickets THEN
    v_is_sold_out := TRUE;
    UPDATE competitions SET status = 'sold_out', updated_at = NOW() WHERE id = p_competition_id AND status != 'sold_out';
  END IF;

  RETURN v_is_sold_out;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_and_mark_competition_sold_out(UUID) TO authenticated, service_role, anon;

-- 2. get_unavailable_tickets
-- ============================================================================
DROP FUNCTION IF EXISTS public.get_unavailable_tickets(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.get_unavailable_tickets(UUID) CASCADE;

CREATE OR REPLACE FUNCTION public.get_unavailable_tickets(competition_id UUID)
RETURNS INTEGER[]
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_sold_jc INTEGER[];
  v_sold_tickets INTEGER[];
  v_pending INTEGER[];
  v_all_unavailable INTEGER[];
BEGIN
  IF competition_id IS NULL THEN
    RETURN ARRAY[]::INTEGER[];
  END IF;

  -- joincompetition - use competition_id NOT competitionid
  SELECT COALESCE(array_agg(DISTINCT ticket_num), ARRAY[]::INTEGER[])
  INTO v_sold_jc
  FROM (
    SELECT CAST(TRIM(unnest(string_to_array(ticketnumbers, ','))) AS INTEGER) AS ticket_num
    FROM joincompetition
    WHERE competition_id = $1
      AND ticketnumbers IS NOT NULL AND TRIM(ticketnumbers) != ''
  ) AS jc_tickets
  WHERE ticket_num IS NOT NULL;

  v_sold_jc := COALESCE(v_sold_jc, ARRAY[]::INTEGER[]);

  -- tickets table
  SELECT COALESCE(array_agg(DISTINCT t.ticket_number), ARRAY[]::INTEGER[])
  INTO v_sold_tickets
  FROM tickets t
  WHERE t.competition_id = $1 AND t.ticket_number IS NOT NULL;

  v_sold_tickets := COALESCE(v_sold_tickets, ARRAY[]::INTEGER[]);

  -- pending_tickets
  SELECT COALESCE(array_agg(DISTINCT pnum), ARRAY[]::INTEGER[])
  INTO v_pending
  FROM (
    SELECT unnest(ticket_numbers) AS pnum
    FROM pending_tickets
    WHERE competition_id = $1
      AND status = 'pending'
      AND expires_at > NOW()
  ) AS pending_nums;

  v_pending := COALESCE(v_pending, ARRAY[]::INTEGER[]);

  v_all_unavailable := v_sold_jc || v_sold_tickets || v_pending;
  SELECT COALESCE(array_agg(DISTINCT u), ARRAY[]::INTEGER[]) INTO v_all_unavailable
  FROM unnest(v_all_unavailable) AS u WHERE u IS NOT NULL;

  RETURN COALESCE(v_all_unavailable, ARRAY[]::INTEGER[]);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_unavailable_tickets(UUID) TO authenticated, service_role, anon;

-- 3. get_competition_unavailable_tickets  
-- ============================================================================
DROP FUNCTION IF EXISTS public.get_competition_unavailable_tickets(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.get_competition_unavailable_tickets(TEXT) CASCADE;

CREATE OR REPLACE FUNCTION public.get_competition_unavailable_tickets(p_competition_id UUID)
RETURNS TABLE (ticket_number INTEGER, source TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN QUERY

  -- From joincompetition - use competition_id NOT competitionid
  SELECT
    CAST(trim(t_num) AS INTEGER) AS ticket_number,
    'sold'::TEXT AS source
  FROM (
    SELECT unnest(string_to_array(ticketnumbers, ',')) AS t_num
    FROM joincompetition
    WHERE competition_id = p_competition_id
      AND ticketnumbers IS NOT NULL
      AND trim(ticketnumbers) != ''
  ) jc_parsed
  WHERE trim(t_num) ~ '^[0-9]+$'

  UNION ALL

  -- From tickets table
  SELECT
    t.ticket_number,
    'sold'::TEXT AS source
  FROM tickets t
  WHERE t.competition_id = p_competition_id
    AND t.ticket_number IS NOT NULL

  UNION ALL

  -- From pending_tickets
  SELECT
    unnest(pt.ticket_numbers) AS ticket_number,
    'pending'::TEXT AS source
  FROM pending_tickets pt
  WHERE pt.competition_id = p_competition_id
    AND pt.status = 'pending'
    AND pt.expires_at > NOW();
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_competition_unavailable_tickets(UUID) TO authenticated, service_role, anon;

-- 4. reserve_lucky_dip
-- ============================================================================
DROP FUNCTION IF EXISTS public.reserve_lucky_dip(TEXT, TEXT, UUID, INTEGER, INTEGER) CASCADE;
DROP FUNCTION IF EXISTS public.reserve_lucky_dip(TEXT, TEXT, TEXT, INTEGER, INTEGER) CASCADE;

CREATE OR REPLACE FUNCTION public.reserve_lucky_dip(
  p_canonical_user_id TEXT,
  p_wallet_address TEXT,
  p_competition_id UUID,
  p_ticket_count INTEGER,
  p_hold_minutes INTEGER DEFAULT 15
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_competition_exists BOOLEAN;
  v_total_tickets INTEGER;
  v_comp_uid TEXT;
  v_competition_uuid UUID;
  v_competition_id_as_text TEXT;
  v_sold_tickets_jc INTEGER[];
  v_sold_tickets_table INTEGER[];
  v_pending_tickets INTEGER[];
  v_all_unavailable INTEGER[];
  v_available_tickets INTEGER[];
  v_available_count INTEGER;
  v_selected_tickets INTEGER[];
  v_reservation_id UUID;
  v_expires_at TIMESTAMPTZ;
  v_total_amount NUMERIC;
BEGIN
  IF p_canonical_user_id IS NULL OR TRIM(p_canonical_user_id) = '' THEN
    RAISE EXCEPTION 'invalid_user_id';
  END IF;
  IF p_ticket_count < 1 OR p_ticket_count > 500 THEN
    RAISE EXCEPTION 'invalid_ticket_count';
  END IF;

  v_competition_uuid := p_competition_id;
  v_competition_id_as_text := p_competition_id::TEXT;

  SELECT TRUE, COALESCE(c.total_tickets, 1000), c.uid
  INTO v_competition_exists, v_total_tickets, v_comp_uid
  FROM competitions c WHERE c.id = v_competition_uuid;

  IF NOT COALESCE(v_competition_exists, FALSE) THEN
    RAISE EXCEPTION 'competition_not_found';
  END IF;

  -- joincompetition - use competition_id NOT competitionid
  SELECT COALESCE(array_agg(DISTINCT ticket_num), ARRAY[]::INTEGER[])
  INTO v_sold_tickets_jc
  FROM (
    SELECT CAST(TRIM(unnest(string_to_array(ticketnumbers, ','))) AS INTEGER) AS ticket_num
    FROM joincompetition
    WHERE competition_id = v_competition_uuid
      AND ticketnumbers IS NOT NULL AND TRIM(ticketnumbers) != ''
  ) AS jc_tickets
  WHERE ticket_num IS NOT NULL;

  v_sold_tickets_jc := COALESCE(v_sold_tickets_jc, ARRAY[]::INTEGER[]);

  -- tickets table
  SELECT COALESCE(array_agg(DISTINCT ticket_number), ARRAY[]::INTEGER[])
  INTO v_sold_tickets_table
  FROM tickets
  WHERE competition_id = v_competition_uuid AND ticket_number IS NOT NULL;

  v_sold_tickets_table := COALESCE(v_sold_tickets_table, ARRAY[]::INTEGER[]);

  -- pending_tickets
  SELECT COALESCE(array_agg(DISTINCT pnum), ARRAY[]::INTEGER[])
  INTO v_pending_tickets
  FROM (
    SELECT unnest(ticket_numbers) AS pnum
    FROM pending_tickets
    WHERE competition_id = v_competition_uuid
      AND status = 'pending'
      AND expires_at > NOW()
      AND canonical_user_id != p_canonical_user_id
  ) AS pending_nums;

  v_pending_tickets := COALESCE(v_pending_tickets, ARRAY[]::INTEGER[]);

  v_all_unavailable := v_sold_tickets_jc || v_sold_tickets_table || v_pending_tickets;
  SELECT COALESCE(array_agg(DISTINCT u), ARRAY[]::INTEGER[]) INTO v_all_unavailable
  FROM unnest(v_all_unavailable) AS u WHERE u IS NOT NULL;

  SELECT array_agg(n ORDER BY random()) INTO v_available_tickets
  FROM generate_series(1, v_total_tickets) AS n
  WHERE n != ALL(COALESCE(v_all_unavailable, ARRAY[]::INTEGER[]));

  v_available_count := COALESCE(array_length(v_available_tickets, 1), 0);

  IF v_available_count < p_ticket_count THEN
    RAISE EXCEPTION 'insufficient_available_tickets';
  END IF;

  v_selected_tickets := v_available_tickets[1:p_ticket_count];

  UPDATE pending_tickets
  SET status = 'cancelled', updated_at = NOW()
  WHERE canonical_user_id = p_canonical_user_id
    AND competition_id = v_competition_uuid
    AND status = 'pending';

  v_reservation_id := gen_random_uuid();
  v_expires_at := NOW() + make_interval(mins => LEAST(GREATEST(p_hold_minutes, 1), 60));
  v_total_amount := p_ticket_count * 0.50;

  INSERT INTO pending_tickets (
    id, canonical_user_id, wallet_address, competition_id,
    ticket_numbers, ticket_count, ticket_price, total_amount,
    status, expires_at, created_at, updated_at
  ) VALUES (
    v_reservation_id, p_canonical_user_id, p_wallet_address, v_competition_uuid,
    v_selected_tickets, p_ticket_count, 0.50, v_total_amount,
    'pending', v_expires_at, NOW(), NOW()
  );

  RETURN jsonb_build_object(
    'success', true,
    'reservation_id', v_reservation_id,
    'ticket_numbers', v_selected_tickets,
    'ticket_count', p_ticket_count,
    'expires_at', v_expires_at,
    'available_count_after', v_available_count - p_ticket_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reserve_lucky_dip(TEXT, TEXT, UUID, INTEGER, INTEGER) TO authenticated, service_role, anon;

-- Force PostgREST schema reload
NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '========================================================';
  RAISE NOTICE 'FIXED ALL 5 FUNCTIONS:';
  RAISE NOTICE '  1. check_and_mark_competition_sold_out';
  RAISE NOTICE '  2. get_unavailable_tickets';
  RAISE NOTICE '  3. get_competition_unavailable_tickets';
  RAISE NOTICE '  4. reserve_lucky_dip';
  RAISE NOTICE '  5. allocate_lucky_dip_tickets_batch (previous)';
  RAISE NOTICE 'ALL NOW USE competition_id ONLY';
  RAISE NOTICE '========================================================';
END $$;
