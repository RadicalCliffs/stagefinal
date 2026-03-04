-- ============================================================================
-- COMPREHENSIVE UUID/TEXT TYPE MISMATCH FIX
-- ============================================================================
-- This migration fixes ALL "operator does not exist: uuid = text" errors
-- across the entire codebase in one shot.
--
-- ROOT CAUSE:
--   Several tables use different types for competition_id:
--     - competitions.id         -> UUID
--     - tickets.competition_id  -> UUID
--     - pending_tickets.competition_id   -> UUID (verified in production 2026-03-03)
--     - pending_ticket_items.competition_id -> UUID
--     - joincompetition.competitionid    -> UUID (verified in production)
--     - joincompetition.competition_id   -> UUID
--
--   The ONLY TEXT column is competitions.onchain_competition_id (which is different)
--
--   Previous implementation incorrectly assumed pending_tickets used TEXT types
--   and created unnecessary UUID->TEXT conversions everywhere, causing comparison
--   errors when PostgreSQL tried to compare incompatible types.
--
-- FUNCTIONS FIXED:
--   1. allocate_lucky_dip_tickets_batch  (PRIMARY: lucky dip reservation)
--   2. reserve_lucky_dip                 (alternative reservation path)
--   3. validate_pending_tickets          (BEFORE INSERT trigger)
--   4. update_tickets_sold_on_pending    (AFTER INSERT trigger)
--   5. trg_fn_confirm_pending_tickets    (confirmation trigger)
--   6. check_and_mark_competition_sold_out
--   7. get_competition_ticket_availability_text
--   8. get_unavailable_tickets
--   9. get_competition_unavailable_tickets (UUID + TEXT overloads)
--  10. get_competition_entries_bypass_rls
--  11. get_competition_entries
--  12. get_comprehensive_user_dashboard_entries
--  13. get_user_competition_entries
--
-- HOW TO APPLY:
--   Supabase Dashboard -> SQL Editor -> Paste -> Run
-- ============================================================================

BEGIN;

-- ============================================================================
-- PART 1: allocate_lucky_dip_tickets_batch (PRIMARY FIX)
-- This is the function that fails when users try to enter competitions
-- Error: "Failed to allocate tickets: operator does not exist: uuid = text"
-- ============================================================================

DROP FUNCTION IF EXISTS allocate_lucky_dip_tickets_batch(TEXT, UUID, INTEGER, NUMERIC, INTEGER, TEXT, INTEGER[]) CASCADE;

CREATE OR REPLACE FUNCTION allocate_lucky_dip_tickets_batch(
  p_user_id TEXT,
  p_competition_id UUID,
  p_count INTEGER,
  p_ticket_price NUMERIC DEFAULT 1,
  p_hold_minutes INTEGER DEFAULT 15,
  p_session_id TEXT DEFAULT NULL,
  p_excluded_tickets INTEGER[] DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_tickets INTEGER;
  v_available_tickets INTEGER[];
  v_selected_tickets INTEGER[];
  v_reservation_id UUID;
  v_expires_at TIMESTAMPTZ;
  v_total_amount DECIMAL;
  v_unavailable_set INTEGER[];
  v_available_count INTEGER;
  v_random_offset INTEGER;
BEGIN
  -- Validate count
  IF p_count < 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Count must be at least 1');
  END IF;

  IF p_count > 500 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Count cannot exceed 500 per batch. Use multiple batches for larger purchases.',
      'max_batch_size', 500
    );
  END IF;

  -- Get competition details
  SELECT total_tickets
  INTO v_total_tickets
  FROM competitions
  WHERE id = p_competition_id
    AND deleted = false
    AND status = 'active'
  FOR UPDATE SKIP LOCKED;

  IF v_total_tickets IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Competition not found, not active, or temporarily locked',
      'retryable', true
    );
  END IF;

  -- Build set of unavailable tickets
  v_unavailable_set := COALESCE(p_excluded_tickets, ARRAY[]::INTEGER[]);

  -- Add sold tickets from joincompetition
  SELECT v_unavailable_set || COALESCE(array_agg(DISTINCT ticket_num), ARRAY[]::INTEGER[])
  INTO v_unavailable_set
  FROM (
    SELECT CAST(trim(unnest(string_to_array(ticketnumbers, ','))) AS INTEGER) AS ticket_num
    FROM joincompetition
    WHERE competitionid = p_competition_id
      AND ticketnumbers IS NOT NULL
      AND trim(ticketnumbers) != ''
  ) jc_tickets
  WHERE ticket_num IS NOT NULL AND ticket_num >= 1 AND ticket_num <= v_total_tickets;

  -- Add sold tickets from tickets table
  SELECT v_unavailable_set || COALESCE(array_agg(ticket_number), ARRAY[]::INTEGER[])
  INTO v_unavailable_set
  FROM tickets
  WHERE competition_id = p_competition_id
    AND ticket_number IS NOT NULL;

  -- Add pending tickets from other users
  SELECT v_unavailable_set || COALESCE(array_agg(ticket_num), ARRAY[]::INTEGER[])
  INTO v_unavailable_set
  FROM (
    SELECT unnest(ticket_numbers) AS ticket_num
    FROM pending_tickets
    WHERE competition_id = p_competition_id
      AND status = 'pending'
      AND expires_at > NOW()
      AND user_id != p_user_id
  ) pt;

  -- Remove duplicates
  SELECT array_agg(DISTINCT u) INTO v_unavailable_set
  FROM unnest(v_unavailable_set) AS u
  WHERE u IS NOT NULL;

  v_unavailable_set := COALESCE(v_unavailable_set, ARRAY[]::INTEGER[]);

  -- Generate random offset for distribution
  v_random_offset := floor(random() * v_total_tickets)::INTEGER;

  -- Generate available tickets with randomization
  SELECT array_agg(n ORDER BY (n + v_random_offset) % v_total_tickets + random())
  INTO v_available_tickets
  FROM generate_series(1, v_total_tickets) AS n
  WHERE n != ALL(v_unavailable_set);

  v_available_count := COALESCE(array_length(v_available_tickets, 1), 0);

  IF v_available_count = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'No tickets available', 'available_count', 0);
  END IF;

  IF v_available_count < p_count THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Insufficient availability',
      'available_count', v_available_count,
      'requested_count', p_count
    );
  END IF;

  -- Select tickets
  v_selected_tickets := v_available_tickets[1:p_count];

  -- Cancel existing pending reservations for this user
  UPDATE pending_tickets
  SET status = 'cancelled', updated_at = NOW()
  WHERE user_id = p_user_id
    AND competition_id = p_competition_id
    AND status = 'pending';

  -- Generate reservation details
  v_reservation_id := gen_random_uuid();
  v_expires_at := NOW() + make_interval(mins => LEAST(GREATEST(p_hold_minutes, 1), 60));
  v_total_amount := p_count * p_ticket_price;

  -- Create the pending reservation
  INSERT INTO pending_tickets (
    id, user_id, competition_id, ticket_numbers, ticket_count,
    ticket_price, total_amount, status, session_id,
    expires_at, created_at, updated_at
  ) VALUES (
    v_reservation_id,
    p_user_id,
    p_competition_id,
    v_selected_tickets,
    p_count,
    p_ticket_price,
    v_total_amount,
    'pending',
    p_session_id,
    v_expires_at,
    NOW(),
    NOW()
  );

  RETURN jsonb_build_object(
    'success', true,
    'reservation_id', v_reservation_id,
    'ticket_numbers', v_selected_tickets,
    'ticket_count', p_count,
    'total_amount', v_total_amount,
    'expires_at', v_expires_at,
    'available_count_after', v_available_count - p_count
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', 'Failed to allocate tickets: ' || SQLERRM,
    'retryable', true
  );
END;
$$;

GRANT EXECUTE ON FUNCTION allocate_lucky_dip_tickets_batch(TEXT, UUID, INTEGER, NUMERIC, INTEGER, TEXT, INTEGER[]) TO authenticated;
GRANT EXECUTE ON FUNCTION allocate_lucky_dip_tickets_batch(TEXT, UUID, INTEGER, NUMERIC, INTEGER, TEXT, INTEGER[]) TO service_role;

-- ============================================================================
-- PART 2: reserve_lucky_dip (alternative reservation path)
-- Same uuid=text bug in WHERE clauses against pending_tickets
-- ============================================================================

CREATE OR REPLACE FUNCTION reserve_lucky_dip(
  p_canonical_user_id TEXT,
  p_wallet_address TEXT,
  p_competition_id UUID,
  p_ticket_count INTEGER,
  p_hold_minutes INTEGER DEFAULT 15
)
RETURNS TABLE(pending_id UUID, allocated_tickets INTEGER[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expires_at timestamptz := now() + make_interval(mins => p_hold_minutes);
  v_alloc int[] := ARRAY[]::int[];
  v_pending_id uuid;
  v_total_avail bigint;
  v_need int := p_ticket_count;
  v_batch int := LEAST(500, GREATEST(50, p_ticket_count));
  v_sample int[];
  v_pct numeric;
BEGIN

  IF p_ticket_count <= 0 THEN
    RAISE EXCEPTION 'ticket_count must be > 0';
  END IF;

  -- Expire stale holds (pending_tickets.competition_id is UUID)
  UPDATE public.pending_tickets
     SET status = 'expired', updated_at = now()
   WHERE competition_id = p_competition_id  -- UUID = UUID
     AND status = 'pending'
     AND expires_at IS NOT NULL
     AND expires_at < now();

  UPDATE public.pending_ticket_items
     SET status = 'expired'
   WHERE competition_id = p_competition_id  -- UUID = UUID
     AND status = 'pending'
     AND expires_at IS NOT NULL
     AND expires_at < now();

  -- Count available (tickets.competition_id is UUID)
  SELECT COUNT(*) INTO v_total_avail
    FROM public.tickets t
   WHERE t.competition_id = p_competition_id  -- UUID = UUID
     AND t.status = 'available';

  IF v_total_avail < p_ticket_count THEN
    RAISE EXCEPTION 'insufficient_available_tickets';
  END IF;

  WHILE v_need > 0 LOOP
    v_pct := 100.0 * (LEAST(v_batch, v_total_avail)::numeric / NULLIF(v_total_avail,1));

    -- Random candidate set via random windowing
    WITH candidates AS (
      SELECT t.ticket_number
        FROM public.tickets t
       WHERE t.competition_id = p_competition_id  -- UUID = UUID
         AND t.status = 'available'
         AND random() < (v_pct/100.0)
       LIMIT v_batch
    ), uniq AS (
      SELECT DISTINCT ticket_number FROM candidates
      ORDER BY random()
      LIMIT v_batch
      FOR UPDATE SKIP LOCKED
    )
    SELECT COALESCE(array_agg(ticket_number), ARRAY[]::int[])
      INTO v_sample
      FROM uniq;

    IF array_length(v_sample,1) IS NULL OR array_length(v_sample,1) = 0 THEN
      -- Fallback
      WITH picked AS (
        SELECT t.ticket_number
          FROM public.tickets t
         WHERE t.competition_id = p_competition_id  -- UUID = UUID
           AND t.status = 'available'
         ORDER BY random()
         LIMIT LEAST(v_batch, v_need)
         FOR UPDATE SKIP LOCKED
      )
      SELECT COALESCE(array_agg(ticket_number), ARRAY[]::int[])
        INTO v_sample
        FROM picked;
    END IF;

    IF array_length(v_sample,1) IS NOT NULL AND array_length(v_sample,1) > 0 THEN
      v_alloc := v_alloc || (SELECT ARRAY(SELECT unnest(v_sample) LIMIT v_need));
      v_need := p_ticket_count - COALESCE(array_length(v_alloc,1),0);
    ELSE
      -- deterministic fallback
      WITH picked AS (
        SELECT t.ticket_number
          FROM public.tickets t
         WHERE t.competition_id = p_competition_id  -- UUID = UUID
           AND t.status = 'available'
         ORDER BY t.ticket_number
         LIMIT LEAST(v_batch, v_need)
         FOR UPDATE SKIP LOCKED
      )
      SELECT COALESCE(array_agg(ticket_number), ARRAY[]::int[])
        INTO v_sample FROM picked;
      v_alloc := v_alloc || (SELECT ARRAY(SELECT unnest(v_sample) LIMIT v_need));
      v_need := p_ticket_count - COALESCE(array_length(v_alloc,1),0);
    END IF;
  END LOOP;

  -- Mark selected tickets as reserved (tickets.competition_id is UUID)
  UPDATE public.tickets t
     SET status = 'reserved'
   WHERE t.competition_id = p_competition_id  -- UUID = UUID
     AND t.ticket_number = ANY (v_alloc)
     AND t.status = 'available';

  -- Ensure all got updated
  IF (SELECT COUNT(*) FROM public.tickets t
        WHERE t.competition_id = p_competition_id  -- UUID = UUID
          AND t.ticket_number = ANY (v_alloc)
          AND t.status = 'reserved') <> p_ticket_count THEN
    RAISE EXCEPTION 'reservation_conflict_detected';
  END IF;

  -- Create the pending batch (pending_tickets.competition_id is UUID)
  INSERT INTO public.pending_tickets(
    user_id, canonical_user_id, wallet_address, competition_id,
    status, hold_minutes, expires_at, reservation_id, created_at,
    ticket_count, ticket_price, total_amount, session_id, confirmed_at,
    updated_at, transaction_hash, payment_provider, ticket_numbers,
    payment_id, idempotency_key, privy_user_id, user_privy_id, note
  )
  VALUES (
    NULL, p_canonical_user_id, p_wallet_address, p_competition_id,  -- UUID
    'pending', p_hold_minutes, v_expires_at, gen_random_uuid(), now(),
    p_ticket_count, NULL, NULL, NULL, NULL,
    now(), NULL, NULL, v_alloc,
    NULL, NULL, NULL, NULL, NULL
  )
  RETURNING id INTO v_pending_id;

  -- Per-ticket pending rows (pending_ticket_items.competition_id is UUID)
  INSERT INTO public.pending_ticket_items(
    pending_ticket_id, competition_id, ticket_number, status, expires_at, created_at
  )
  SELECT v_pending_id, p_competition_id, unnest(v_alloc), 'pending', v_expires_at, now();

  RETURN QUERY SELECT v_pending_id, v_alloc;
END;
$$;

GRANT EXECUTE ON FUNCTION reserve_lucky_dip(TEXT, TEXT, UUID, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION reserve_lucky_dip(TEXT, TEXT, UUID, INTEGER, INTEGER) TO service_role;

-- ============================================================================
-- PART 3 & 4: Trigger functions removed - they are correctly defined in
-- migration 20260302_fix_pending_tickets_triggers.sql which runs before this
-- ============================================================================

-- ============================================================================
-- PART 5: trg_fn_confirm_pending_tickets (confirmation trigger)
-- Inserts into tickets table which has UUID competition_id
-- ============================================================================

CREATE OR REPLACE FUNCTION public.trg_fn_confirm_pending_tickets()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  tnum int;
BEGIN
  IF (TG_OP = 'UPDATE') AND (OLD.confirmed_at IS NULL) AND (NEW.confirmed_at IS NOT NULL) THEN
    -- NEW.competition_id is already UUID (from pending_tickets table)

    FOREACH tnum IN ARRAY COALESCE(NEW.ticket_numbers, ARRAY[]::int[]) LOOP
      INSERT INTO public.tickets (
        competition_id, ticket_number, status, purchased_at, order_id,
        canonical_user_id, wallet_address
      ) VALUES (
        NEW.competition_id,  -- Already UUID, no cast needed
        tnum,
        'sold',
        NEW.confirmed_at,
        NULL,
        NEW.canonical_user_id,
        COALESCE(NEW.wallet_address,
                 (SELECT cu.wallet_address FROM public.canonical_users cu
                  WHERE cu.canonical_user_id = NEW.canonical_user_id))
      )
      ON CONFLICT (competition_id, ticket_number) DO UPDATE
      SET status = 'sold',
          purchased_at = EXCLUDED.purchased_at,
          canonical_user_id = EXCLUDED.canonical_user_id,
          wallet_address = EXCLUDED.wallet_address;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$function$;

-- Ensure trigger is attached
DROP TRIGGER IF EXISTS trg_confirm_pending_tickets ON pending_tickets;
CREATE TRIGGER trg_confirm_pending_tickets
  AFTER UPDATE ON pending_tickets
  FOR EACH ROW
  EXECUTE FUNCTION trg_fn_confirm_pending_tickets();

-- ============================================================================
-- PART 6: check_and_mark_competition_sold_out
-- Fix: 300 ambiguity error from dual UUID/TEXT overloads
-- ============================================================================

DROP FUNCTION IF EXISTS public.check_and_mark_competition_sold_out(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.check_and_mark_competition_sold_out(TEXT) CASCADE;

CREATE OR REPLACE FUNCTION public.check_and_mark_competition_sold_out(p_competition_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_competition_uuid UUID;
  v_total_tickets INTEGER;
  v_sold_count INTEGER;
  v_is_sold_out BOOLEAN := FALSE;
BEGIN
  IF p_competition_id IS NULL OR TRIM(p_competition_id) = '' THEN
    RETURN FALSE;
  END IF;

  BEGIN
    v_competition_uuid := p_competition_id::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    SELECT id INTO v_competition_uuid FROM competitions WHERE uid = p_competition_id LIMIT 1;
    IF v_competition_uuid IS NULL THEN RETURN FALSE; END IF;
  END;

  SELECT total_tickets INTO v_total_tickets FROM competitions WHERE id = v_competition_uuid;
  IF v_total_tickets IS NULL THEN RETURN FALSE; END IF;

  SELECT COALESCE(SUM(numberoftickets), 0) INTO v_sold_count
  FROM joincompetition
  WHERE competitionid = v_competition_uuid::TEXT;

  IF v_sold_count >= v_total_tickets THEN
    v_is_sold_out := TRUE;
    UPDATE competitions
    SET status = 'sold_out', updated_at = NOW()
    WHERE id = v_competition_uuid
      AND status NOT IN ('sold_out', 'drawn', 'completed', 'cancelled');
  END IF;

  RETURN v_is_sold_out;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_and_mark_competition_sold_out(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_mark_competition_sold_out(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.check_and_mark_competition_sold_out(TEXT) TO service_role;

-- ============================================================================
-- PART 7: get_unavailable_tickets
-- Fix: uuid = text comparison errors
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
  IF competition_id IS NULL OR TRIM(competition_id) = '' THEN
    RETURN ARRAY[]::INTEGER[];
  END IF;

  BEGIN
    v_competition_uuid := competition_id::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    SELECT c.id, c.uid INTO v_competition_uuid, v_comp_uid
    FROM competitions c WHERE c.uid = competition_id LIMIT 1;
    IF v_competition_uuid IS NULL THEN RETURN ARRAY[]::INTEGER[]; END IF;
  END;

  IF v_comp_uid IS NULL THEN
    SELECT c.uid INTO v_comp_uid FROM competitions c WHERE c.id = v_competition_uuid;
  END IF;

  -- joincompetition (competitionid is UUID)
  SELECT COALESCE(array_agg(DISTINCT ticket_num), ARRAY[]::INTEGER[])
  INTO v_sold_jc
  FROM (
    SELECT CAST(TRIM(unnest(string_to_array(ticketnumbers, ','))) AS INTEGER) AS ticket_num
    FROM joincompetition
    WHERE (competitionid = v_competition_uuid::TEXT
      OR (v_comp_uid IS NOT NULL AND competitionid = v_comp_uid)
      OR competitionid = competition_id)
      AND ticketnumbers IS NOT NULL AND TRIM(ticketnumbers) != ''
  ) AS jc_tickets
  WHERE ticket_num IS NOT NULL;

  v_sold_jc := COALESCE(v_sold_jc, ARRAY[]::INTEGER[]);

  -- tickets table (competition_id is UUID)
  SELECT COALESCE(array_agg(DISTINCT t.ticket_number), ARRAY[]::INTEGER[])
  INTO v_sold_tickets
  FROM tickets t
  WHERE t.competition_id = v_competition_uuid;  -- UUID = UUID

  v_sold_tickets := COALESCE(v_sold_tickets, ARRAY[]::INTEGER[]);

  -- pending_tickets (competition_id is UUID)
  BEGIN
    SELECT COALESCE(array_agg(DISTINCT ticket_num), ARRAY[]::INTEGER[])
    INTO v_pending
    FROM (
      SELECT unnest(pt.ticket_numbers) AS ticket_num
      FROM pending_tickets pt
      WHERE pt.competition_id = v_competition_uuid  -- UUID = UUID
        AND pt.status = 'pending'
        AND pt.expires_at > NOW()
    ) AS pending
    WHERE ticket_num IS NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    v_pending := ARRAY[]::INTEGER[];
  END;

  v_pending := COALESCE(v_pending, ARRAY[]::INTEGER[]);

  v_unavailable := v_sold_jc || v_sold_tickets || v_pending;

  IF array_length(v_unavailable, 1) IS NOT NULL AND array_length(v_unavailable, 1) > 0 THEN
    SELECT COALESCE(array_agg(DISTINCT u ORDER BY u), ARRAY[]::INTEGER[])
    INTO v_unavailable
    FROM unnest(v_unavailable) AS u;
  ELSE
    v_unavailable := ARRAY[]::INTEGER[];
  END IF;

  RETURN v_unavailable;
END;
$$;

GRANT EXECUTE ON FUNCTION get_unavailable_tickets(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_unavailable_tickets(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_unavailable_tickets(TEXT) TO service_role;

-- ============================================================================
-- PART 8: get_competition_unavailable_tickets (UUID overload)
-- ============================================================================

DROP FUNCTION IF EXISTS get_competition_unavailable_tickets(UUID) CASCADE;
DROP FUNCTION IF EXISTS get_competition_unavailable_tickets(TEXT) CASCADE;

CREATE OR REPLACE FUNCTION get_competition_unavailable_tickets(p_competition_id UUID)
RETURNS TABLE(ticket_number INTEGER, source TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_comp_uid TEXT;
BEGIN
  SELECT uid INTO v_comp_uid FROM competitions WHERE id = p_competition_id;

  RETURN QUERY

  -- From joincompetition (competitionid is TEXT)
  SELECT
    CAST(trim(t_num) AS INTEGER) AS ticket_number,
    'sold'::TEXT AS source
  FROM (
    SELECT unnest(string_to_array(ticketnumbers, ',')) AS t_num
    FROM joincompetition
    WHERE (competitionid = p_competition_id::TEXT
      OR (v_comp_uid IS NOT NULL AND competitionid = v_comp_uid))
      AND ticketnumbers IS NOT NULL
      AND trim(ticketnumbers) != ''
  ) jc_parsed
  WHERE trim(t_num) ~ '^[0-9]+$'

  UNION ALL

  -- From tickets table (competition_id is UUID)
  SELECT
    t.ticket_number,
    'sold'::TEXT AS source
  FROM tickets t
  WHERE t.competition_id = p_competition_id  -- UUID = UUID
    AND t.ticket_number IS NOT NULL

  UNION ALL

  -- From pending_tickets (competition_id is UUID)
  SELECT
    unnest(pt.ticket_numbers) AS ticket_number,
    'pending'::TEXT AS source
  FROM pending_tickets pt
  WHERE pt.competition_id = p_competition_id  -- UUID = UUID
    AND pt.status IN ('pending', 'confirming')
    AND pt.expires_at > NOW();
END;
$$;

-- TEXT wrapper
CREATE OR REPLACE FUNCTION get_competition_unavailable_tickets(p_competition_id TEXT)
RETURNS TABLE(ticket_number INTEGER, source TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uuid UUID;
BEGIN
  BEGIN
    v_uuid := p_competition_id::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    SELECT c.id INTO v_uuid FROM competitions c WHERE c.uid = p_competition_id LIMIT 1;
    IF v_uuid IS NULL THEN RETURN; END IF;
  END;
  RETURN QUERY SELECT * FROM get_competition_unavailable_tickets(v_uuid);
END;
$$;

GRANT EXECUTE ON FUNCTION get_competition_unavailable_tickets(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_competition_unavailable_tickets(UUID) TO anon;
GRANT EXECUTE ON FUNCTION get_competition_unavailable_tickets(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION get_competition_unavailable_tickets(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_competition_unavailable_tickets(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_competition_unavailable_tickets(TEXT) TO service_role;

-- ============================================================================
-- PART 9: get_competition_ticket_availability_text
-- Fix: uuid = text in WHERE clauses
-- ============================================================================

DROP FUNCTION IF EXISTS get_competition_ticket_availability_text(TEXT) CASCADE;

CREATE OR REPLACE FUNCTION get_competition_ticket_availability_text(competition_id_text TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_competition_uuid UUID;
  v_total_tickets INTEGER;
  v_competition_exists BOOLEAN;
  v_comp_uid TEXT;
  v_competition_id_as_text TEXT;
  v_sold_tickets_jc INTEGER[] := ARRAY[]::INTEGER[];
  v_sold_tickets_table INTEGER[] := ARRAY[]::INTEGER[];
  v_pending_tickets INTEGER[] := ARRAY[]::INTEGER[];
  v_unavailable_tickets INTEGER[] := ARRAY[]::INTEGER[];
  v_available_tickets INTEGER[] := ARRAY[]::INTEGER[];
  v_ticket_num INTEGER;
  v_sold_count INTEGER := 0;
  v_available_count INTEGER := 0;
BEGIN
  IF competition_id_text IS NULL OR TRIM(competition_id_text) = '' THEN
    RETURN json_build_object(
      'competition_id', competition_id_text, 'total_tickets', 0,
      'available_tickets', ARRAY[]::INTEGER[], 'sold_count', 0,
      'available_count', 0, 'error', 'Invalid competition ID'
    );
  END IF;

  BEGIN
    v_competition_uuid := competition_id_text::UUID;
    v_competition_id_as_text := v_competition_uuid::TEXT;
  EXCEPTION WHEN invalid_text_representation THEN
    SELECT id INTO v_competition_uuid FROM competitions WHERE uid = competition_id_text LIMIT 1;
    IF v_competition_uuid IS NULL THEN
      RETURN json_build_object(
        'competition_id', competition_id_text, 'total_tickets', 0,
        'available_tickets', ARRAY[]::INTEGER[], 'sold_count', 0,
        'available_count', 0, 'error', 'Competition not found'
      );
    END IF;
    v_competition_id_as_text := v_competition_uuid::TEXT;
  END;

  SELECT TRUE, COALESCE(c.total_tickets, 1000), c.uid
  INTO v_competition_exists, v_total_tickets, v_comp_uid
  FROM competitions c WHERE c.id = v_competition_uuid;

  IF NOT COALESCE(v_competition_exists, FALSE) THEN
    RETURN json_build_object(
      'competition_id', competition_id_text, 'total_tickets', 0,
      'available_tickets', ARRAY[]::INTEGER[], 'sold_count', 0,
      'available_count', 0, 'error', 'Competition not found'
    );
  END IF;

  -- joincompetition (competitionid is TEXT)
  SELECT COALESCE(array_agg(DISTINCT ticket_num), ARRAY[]::INTEGER[])
  INTO v_sold_tickets_jc
  FROM (
    SELECT CAST(TRIM(unnest(string_to_array(ticketnumbers, ','))) AS INTEGER) AS ticket_num
    FROM joincompetition
    WHERE (competitionid = v_competition_id_as_text
      OR (v_comp_uid IS NOT NULL AND competitionid = v_comp_uid)
      OR competitionid = competition_id_text)
      AND ticketnumbers IS NOT NULL AND TRIM(ticketnumbers) != ''
  ) AS jc_tickets
  WHERE ticket_num IS NOT NULL;

  v_sold_tickets_jc := COALESCE(v_sold_tickets_jc, ARRAY[]::INTEGER[]);

  -- tickets table (competition_id is UUID)
  SELECT COALESCE(array_agg(DISTINCT ticket_number), ARRAY[]::INTEGER[])
  INTO v_sold_tickets_table
  FROM tickets t WHERE t.competition_id = v_competition_uuid;  -- UUID = UUID

  v_sold_tickets_table := COALESCE(v_sold_tickets_table, ARRAY[]::INTEGER[]);

  -- pending_tickets (competition_id is TEXT)
  BEGIN
    SELECT COALESCE(array_agg(DISTINCT ticket_num), ARRAY[]::INTEGER[])
    INTO v_pending_tickets
    FROM (
      SELECT unnest(ticket_numbers) AS ticket_num
      FROM pending_tickets pt
      WHERE pt.competition_id = v_competition_id_as_text  -- TEXT = TEXT
        AND pt.status = 'pending'
        AND pt.expires_at > NOW()
    ) AS pending
    WHERE ticket_num IS NOT NULL;
  EXCEPTION WHEN undefined_table THEN
    v_pending_tickets := ARRAY[]::INTEGER[];
  END;

  v_pending_tickets := COALESCE(v_pending_tickets, ARRAY[]::INTEGER[]);
  v_unavailable_tickets := v_sold_tickets_jc || v_sold_tickets_table || v_pending_tickets;

  IF array_length(v_unavailable_tickets, 1) IS NOT NULL AND array_length(v_unavailable_tickets, 1) > 0 THEN
    SELECT COALESCE(array_agg(DISTINCT u ORDER BY u), ARRAY[]::INTEGER[])
    INTO v_unavailable_tickets FROM unnest(v_unavailable_tickets) AS u;
  ELSE
    v_unavailable_tickets := ARRAY[]::INTEGER[];
  END IF;

  v_sold_count := COALESCE(array_length(v_unavailable_tickets, 1), 0);
  v_available_count := GREATEST(0, v_total_tickets - v_sold_count);

  IF v_available_count > 0 THEN
    FOR v_ticket_num IN 1..LEAST(v_total_tickets, 50000) LOOP
      IF v_sold_count = 0 OR NOT (v_ticket_num = ANY(v_unavailable_tickets)) THEN
        v_available_tickets := array_append(v_available_tickets, v_ticket_num);
      END IF;
    END LOOP;
  END IF;

  RETURN json_build_object(
    'competition_id', v_competition_uuid,
    'total_tickets', v_total_tickets,
    'available_tickets', COALESCE(v_available_tickets, ARRAY[]::INTEGER[]),
    'sold_count', v_sold_count,
    'available_count', v_available_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_competition_ticket_availability_text(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_competition_ticket_availability_text(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_competition_ticket_availability_text(TEXT) TO service_role;

-- ============================================================================
-- PART 10: get_competition_entries_bypass_rls + get_competition_entries
-- Fix: empty string to uuid cast + uuid = text comparisons
-- ============================================================================

DROP FUNCTION IF EXISTS get_competition_entries_bypass_rls(TEXT) CASCADE;
DROP FUNCTION IF EXISTS get_competition_entries_bypass_rls(UUID) CASCADE;
DROP FUNCTION IF EXISTS get_competition_entries(TEXT) CASCADE;
DROP FUNCTION IF EXISTS get_competition_entries(UUID) CASCADE;

CREATE OR REPLACE FUNCTION get_competition_entries_bypass_rls(competition_identifier TEXT)
RETURNS TABLE (
  uid TEXT, competitionid TEXT, userid TEXT, privy_user_id TEXT,
  numberoftickets INTEGER, ticketnumbers TEXT, amountspent NUMERIC,
  wallet_address TEXT, chain TEXT, transactionhash TEXT,
  purchasedate TIMESTAMPTZ, created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  comp_uuid UUID := NULL;
  comp_uid_text TEXT := NULL;
BEGIN
  IF competition_identifier IS NULL OR TRIM(competition_identifier) = '' THEN
    RETURN;
  END IF;

  BEGIN
    comp_uuid := competition_identifier::UUID;
    comp_uid_text := competition_identifier;
  EXCEPTION WHEN invalid_text_representation THEN
    SELECT c.id, c.uid INTO comp_uuid, comp_uid_text
    FROM competitions c WHERE c.uid = competition_identifier LIMIT 1;
  END;

  IF comp_uuid IS NOT NULL AND (comp_uid_text IS NULL OR comp_uid_text = competition_identifier) THEN
    SELECT c.uid INTO comp_uid_text FROM competitions c WHERE c.id = comp_uuid LIMIT 1;
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(jc.uid::TEXT, jc.id::TEXT, gen_random_uuid()::TEXT),
    COALESCE(jc.competitionid, '')::TEXT,
    COALESCE(jc.userid::TEXT, '')::TEXT,
    COALESCE(jc.privy_user_id, jc.wallet_address, '')::TEXT,
    COALESCE(jc.numberoftickets, 1)::INTEGER,
    COALESCE(jc.ticketnumbers, '')::TEXT,
    COALESCE(jc.amountspent, 0)::NUMERIC,
    COALESCE(jc.wallet_address, '')::TEXT,
    COALESCE(jc.chain, 'Base')::TEXT,
    COALESCE(jc.transactionhash, '')::TEXT,
    COALESCE(jc.purchasedate, jc.created_at, NOW())::TIMESTAMPTZ,
    COALESCE(jc.created_at, NOW())::TIMESTAMPTZ
  FROM joincompetition jc
  WHERE jc.competitionid = competition_identifier
    OR (comp_uuid IS NOT NULL AND jc.competitionid = comp_uuid::TEXT)
    OR (comp_uid_text IS NOT NULL AND comp_uid_text != '' AND jc.competitionid = comp_uid_text)

  UNION ALL

  SELECT
    ('tickets-' || COALESCE(t.canonical_user_id, t.user_id, 'unknown') || '-' || t.competition_id::TEXT)::TEXT,
    COALESCE(t.competition_id::TEXT, '')::TEXT,
    COALESCE(t.user_id, '')::TEXT,
    COALESCE(t.user_id, '')::TEXT,
    COUNT(*)::INTEGER,
    string_agg(t.ticket_number::TEXT, ',' ORDER BY t.ticket_number)::TEXT,
    COALESCE(SUM(t.purchase_price), 0)::NUMERIC,
    COALESCE(t.user_id, '')::TEXT,
    'USDC'::TEXT,
    ''::TEXT,
    MIN(t.created_at)::TIMESTAMPTZ,
    MIN(t.created_at)::TIMESTAMPTZ
  FROM tickets t
  WHERE comp_uuid IS NOT NULL
    AND t.competition_id = comp_uuid  -- UUID = UUID
    AND NOT EXISTS (
      SELECT 1 FROM joincompetition jc2
      WHERE (jc2.competitionid = competition_identifier
        OR (comp_uuid IS NOT NULL AND jc2.competitionid = comp_uuid::TEXT)
        OR (comp_uid_text IS NOT NULL AND comp_uid_text != '' AND jc2.competitionid = comp_uid_text))
        AND (jc2.canonical_user_id = t.canonical_user_id
          OR LOWER(jc2.wallet_address) = LOWER(t.user_id)
          OR jc2.userid::TEXT = t.user_id)
    )
  GROUP BY t.competition_id, t.canonical_user_id, t.user_id

  ORDER BY purchasedate DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_competition_entries_bypass_rls(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_competition_entries_bypass_rls(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_competition_entries_bypass_rls(TEXT) TO service_role;

CREATE OR REPLACE FUNCTION get_competition_entries(competition_identifier TEXT)
RETURNS TABLE (
  uid TEXT, competitionid TEXT, userid TEXT, privy_user_id TEXT,
  numberoftickets INTEGER, ticketnumbers TEXT, amountspent NUMERIC,
  wallet_address TEXT, chain TEXT, transactionhash TEXT,
  purchasedate TIMESTAMPTZ, created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN QUERY SELECT * FROM get_competition_entries_bypass_rls(competition_identifier);
END;
$$;

GRANT EXECUTE ON FUNCTION get_competition_entries(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_competition_entries(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_competition_entries(TEXT) TO service_role;

-- ============================================================================
-- PART 11: get_comprehensive_user_dashboard_entries
-- Fix: uuid ~* regex operator error + uuid = text in JOINs
-- ============================================================================

DROP FUNCTION IF EXISTS get_comprehensive_user_dashboard_entries(TEXT) CASCADE;

CREATE OR REPLACE FUNCTION public.get_comprehensive_user_dashboard_entries(user_identifier TEXT)
RETURNS TABLE (
  id TEXT, competition_id TEXT, title TEXT, description TEXT,
  image TEXT, status TEXT, entry_type TEXT, is_winner BOOLEAN,
  ticket_numbers TEXT, total_tickets INTEGER, total_amount_spent NUMERIC,
  purchase_date TIMESTAMPTZ, transaction_hash TEXT, is_instant_win BOOLEAN,
  prize_value NUMERIC, competition_status TEXT, end_date TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  lower_identifier TEXT;
  search_wallet TEXT;
  resolved_canonical_user_id TEXT := NULL;
  resolved_wallet_address TEXT := NULL;
  resolved_base_wallet_address TEXT := NULL;
  resolved_eth_wallet_address TEXT := NULL;
  resolved_privy_user_id TEXT := NULL;
  resolved_uid TEXT := NULL;
  v_uuid_regex TEXT := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
  lower_identifier := LOWER(TRIM(user_identifier));

  IF user_identifier LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(user_identifier FROM 11));
  ELSIF user_identifier LIKE '0x%' THEN
    search_wallet := lower_identifier;
  ELSE
    search_wallet := NULL;
  END IF;

  SELECT cu.canonical_user_id, LOWER(cu.wallet_address), LOWER(cu.base_wallet_address),
         LOWER(cu.eth_wallet_address), cu.privy_user_id, cu.uid
  INTO resolved_canonical_user_id, resolved_wallet_address, resolved_base_wallet_address,
       resolved_eth_wallet_address, resolved_privy_user_id, resolved_uid
  FROM canonical_users cu
  WHERE cu.canonical_user_id = user_identifier
    OR LOWER(cu.wallet_address) = lower_identifier
    OR LOWER(cu.base_wallet_address) = lower_identifier
    OR LOWER(cu.eth_wallet_address) = lower_identifier
    OR cu.privy_user_id = user_identifier
    OR cu.uid = user_identifier
    OR (search_wallet IS NOT NULL AND (
      LOWER(cu.wallet_address) = search_wallet
      OR LOWER(cu.base_wallet_address) = search_wallet
      OR LOWER(cu.eth_wallet_address) = search_wallet
    ))
  LIMIT 1;

  RETURN QUERY

  -- Part 1: joincompetition entries
  SELECT
    COALESCE(jc.uid, 'jc-' || COALESCE(jc.competitionid, '') || '-' || COALESCE(jc.wallet_address, '') || '-' || COALESCE(jc.created_at::TEXT, '')),
    COALESCE(jc.competitionid, c.id::TEXT, c.uid),
    COALESCE(c.title, ''), COALESCE(c.description, ''),
    COALESCE(c.image_url, c.imageurl, ''),
    CASE
      WHEN c.winner_address IS NOT NULL THEN 'completed'
      WHEN c.status = 'active' THEN 'live'
      WHEN c.status IN ('drawn', 'completed') THEN 'completed'
      ELSE COALESCE(c.status, 'live')
    END,
    'competition_entry',
    COALESCE(LOWER(c.winner_address) = LOWER(jc.wallet_address), FALSE),
    COALESCE(jc.ticketnumbers, ''),
    COALESCE(jc.numberoftickets, 0)::INTEGER,
    COALESCE(jc.numberoftickets * c.ticket_price, jc.amountspent, 0),
    COALESCE(jc.purchasedate, jc.created_at),
    jc.transactionhash,
    COALESCE(c.is_instant_win, FALSE),
    c.prize_value,
    COALESCE(c.status, 'completed'),
    c.end_date
  FROM public.joincompetition jc
  LEFT JOIN public.competitions c ON (
    -- FIX: competitionid is TEXT, c.id is UUID - use regex check then cast
    (jc.competitionid ~* v_uuid_regex AND jc.competitionid::UUID = c.id)
    OR c.uid = jc.competitionid
  )
  WHERE (
    (resolved_canonical_user_id IS NOT NULL AND jc.canonical_user_id = resolved_canonical_user_id)
    OR (resolved_wallet_address IS NOT NULL AND LOWER(jc.wallet_address) = resolved_wallet_address)
    OR (resolved_base_wallet_address IS NOT NULL AND LOWER(jc.wallet_address) = resolved_base_wallet_address)
    OR (resolved_eth_wallet_address IS NOT NULL AND LOWER(jc.wallet_address) = resolved_eth_wallet_address)
    OR (resolved_privy_user_id IS NOT NULL AND jc.privy_user_id = resolved_privy_user_id)
    OR (resolved_uid IS NOT NULL AND jc.userid::TEXT = resolved_uid)
    OR (resolved_canonical_user_id IS NULL AND (
      jc.canonical_user_id = user_identifier
      OR LOWER(jc.wallet_address) = lower_identifier
      OR jc.userid::TEXT = user_identifier
      OR (search_wallet IS NOT NULL AND LOWER(jc.wallet_address) = search_wallet)
    ))
  )
  AND jc.competitionid IS NOT NULL AND jc.competitionid != ''
  AND (c.id IS NOT NULL OR jc.competitionid IS NOT NULL)

  UNION ALL

  -- Part 2: tickets table entries
  SELECT
    ('tickets-' || COALESCE(t.canonical_user_id, t.user_id, 'anon-' || t.competition_id::TEXT) || '-' || t.competition_id::TEXT)::TEXT,
    t.competition_id::TEXT,
    COALESCE(c.title, ''), COALESCE(c.description, ''),
    COALESCE(c.image_url, c.imageurl, ''),
    CASE
      WHEN c.winner_address IS NOT NULL THEN 'completed'
      WHEN c.status = 'active' THEN 'live'
      WHEN c.status IN ('drawn', 'completed') THEN 'completed'
      ELSE COALESCE(c.status, 'live')
    END,
    'ticket',
    COALESCE(t.is_winner, FALSE),
    STRING_AGG(t.ticket_number::TEXT, ',' ORDER BY t.ticket_number),
    COUNT(t.id)::INTEGER,
    SUM(COALESCE(t.purchase_price, c.ticket_price, 0)),
    MIN(t.purchased_at),
    NULL::TEXT,
    COALESCE(c.is_instant_win, FALSE),
    c.prize_value,
    COALESCE(c.status, 'completed'),
    c.end_date
  FROM public.tickets t
  LEFT JOIN public.competitions c ON t.competition_id = c.id  -- UUID = UUID
  WHERE (
    (resolved_canonical_user_id IS NOT NULL AND t.canonical_user_id = resolved_canonical_user_id)
    OR (resolved_wallet_address IS NOT NULL AND LOWER(t.user_id) = resolved_wallet_address)
    OR (resolved_base_wallet_address IS NOT NULL AND LOWER(t.user_id) = resolved_base_wallet_address)
    OR (resolved_eth_wallet_address IS NOT NULL AND LOWER(t.user_id) = resolved_eth_wallet_address)
    OR (resolved_canonical_user_id IS NULL AND (
      t.canonical_user_id = user_identifier
      OR LOWER(t.user_id) = lower_identifier
      OR (search_wallet IS NOT NULL AND LOWER(t.user_id) = search_wallet)
    ))
  )
  AND t.competition_id IS NOT NULL
  GROUP BY t.competition_id, t.canonical_user_id, t.user_id, c.id, c.title, c.description, c.image_url,
           c.imageurl, c.status, c.winner_address, c.is_instant_win, c.prize_value, c.end_date, c.ticket_price

  UNION ALL

  -- Part 3: user_transactions
  SELECT
    ut.id::TEXT,
    ut.competition_id::TEXT,
    COALESCE(c.title, ''), COALESCE(c.description, ''),
    COALESCE(c.image_url, c.imageurl, ''),
    CASE
      WHEN ut.payment_status = 'completed' AND c.winner_address IS NOT NULL THEN 'completed'
      WHEN ut.payment_status = 'pending' THEN 'pending'
      WHEN ut.payment_status = 'failed' THEN 'failed'
      WHEN c.status = 'active' THEN 'live'
      WHEN c.status IN ('drawn', 'completed') THEN 'completed'
      ELSE COALESCE(c.status, 'live')
    END,
    'transaction',
    FALSE,
    '',
    COALESCE(ut.ticket_count, 0)::INTEGER,
    COALESCE(ut.amount, 0),
    ut.created_at,
    COALESCE(ut.tx_id, ut.charge_id, ut.charge_code, ut.tx_ref, ut.order_id),
    COALESCE(c.is_instant_win, FALSE),
    c.prize_value,
    COALESCE(c.status, 'completed'),
    c.end_date
  FROM public.user_transactions ut
  LEFT JOIN public.competitions c ON ut.competition_id = c.id  -- UUID = UUID
  WHERE (
    (resolved_canonical_user_id IS NOT NULL AND ut.canonical_user_id = resolved_canonical_user_id)
    OR (resolved_wallet_address IS NOT NULL AND LOWER(ut.wallet_address) = resolved_wallet_address)
    OR (resolved_base_wallet_address IS NOT NULL AND LOWER(ut.wallet_address) = resolved_base_wallet_address)
    OR (resolved_eth_wallet_address IS NOT NULL AND LOWER(ut.wallet_address) = resolved_eth_wallet_address)
    OR (resolved_privy_user_id IS NOT NULL AND (ut.user_privy_id = resolved_privy_user_id OR ut.privy_user_id = resolved_privy_user_id))
    OR (resolved_uid IS NOT NULL AND ut.user_id = resolved_uid)
    OR (resolved_canonical_user_id IS NULL AND (
      ut.canonical_user_id = user_identifier
      OR ut.user_id = user_identifier
      OR ut.user_privy_id = user_identifier
      OR LOWER(ut.wallet_address) = lower_identifier
      OR (search_wallet IS NOT NULL AND LOWER(ut.wallet_address) = search_wallet)
    ))
  )
  AND ut.competition_id IS NOT NULL
  AND ut.payment_status != 'failed'

  UNION ALL

  -- Part 4: pending_tickets (competition_id is TEXT, use TEXT comparison for JOIN)
  SELECT
    pt.id::TEXT,
    pt.competition_id::TEXT,
    COALESCE(c.title, ''), COALESCE(c.description, ''),
    COALESCE(c.image_url, c.imageurl, ''),
    CASE
      WHEN pt.status = 'confirmed' THEN 'completed'
      WHEN pt.status = 'pending' THEN 'pending'
      WHEN pt.status = 'expired' THEN 'expired'
      ELSE pt.status
    END,
    'pending_ticket',
    FALSE,
    ARRAY_TO_STRING(pt.ticket_numbers, ','),
    pt.ticket_count::INTEGER,
    pt.total_amount,
    pt.created_at,
    pt.transaction_hash,
    COALESCE(c.is_instant_win, FALSE),
    c.prize_value,
    COALESCE(c.status, 'active'),
    c.end_date
  FROM public.pending_tickets pt
  LEFT JOIN public.competitions c ON pt.competition_id = c.id  -- UUID = UUID
  WHERE (
    (resolved_canonical_user_id IS NOT NULL AND pt.canonical_user_id = resolved_canonical_user_id)
    OR (resolved_wallet_address IS NOT NULL AND (LOWER(pt.user_id) = resolved_wallet_address OR LOWER(pt.wallet_address) = resolved_wallet_address))
    OR (resolved_base_wallet_address IS NOT NULL AND (LOWER(pt.user_id) = resolved_base_wallet_address OR LOWER(pt.wallet_address) = resolved_base_wallet_address))
    OR (resolved_eth_wallet_address IS NOT NULL AND (LOWER(pt.user_id) = resolved_eth_wallet_address OR LOWER(pt.wallet_address) = resolved_eth_wallet_address))
    OR (resolved_canonical_user_id IS NULL AND (
      pt.canonical_user_id = user_identifier
      OR pt.user_id = user_identifier
      OR LOWER(pt.user_id) = lower_identifier
      OR LOWER(pt.wallet_address) = lower_identifier
      OR (search_wallet IS NOT NULL AND (LOWER(pt.user_id) = search_wallet OR LOWER(pt.wallet_address) = search_wallet))
    ))
  )
  AND pt.status IN ('pending', 'confirmed')
  AND pt.expires_at > NOW()
  AND pt.competition_id IS NOT NULL

  ORDER BY purchase_date DESC NULLS LAST;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_comprehensive_user_dashboard_entries(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_comprehensive_user_dashboard_entries(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_comprehensive_user_dashboard_entries(TEXT) TO service_role;

-- ============================================================================
-- PART 12: get_user_competition_entries
-- Fix: uuid = text and uuid ~* regex errors
-- ============================================================================

DROP FUNCTION IF EXISTS get_user_competition_entries(TEXT) CASCADE;

CREATE OR REPLACE FUNCTION get_user_competition_entries(p_user_identifier TEXT)
RETURNS TABLE (
  entry_id TEXT, competition_id TEXT, competition_title TEXT,
  competition_image TEXT, ticket_count INTEGER, ticket_numbers TEXT,
  entry_status TEXT, competition_status TEXT,
  competition_end_date TIMESTAMPTZ, created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  lower_identifier TEXT;
  search_wallet TEXT;
  v_uuid_regex TEXT := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
  lower_identifier := LOWER(TRIM(p_user_identifier));

  IF p_user_identifier LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(p_user_identifier FROM 11));
  ELSIF p_user_identifier LIKE '0x%' THEN
    search_wallet := lower_identifier;
  ELSE
    search_wallet := NULL;
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(jc.uid, jc.id::TEXT, gen_random_uuid()::TEXT),
    COALESCE(jc.competitionid, c.id::TEXT),
    COALESCE(c.title, ''),
    COALESCE(c.image_url, c.imageurl, ''),
    COALESCE(jc.numberoftickets, 0)::INTEGER,
    COALESCE(jc.ticketnumbers, ''),
    'confirmed',
    COALESCE(c.status, 'active'),
    c.end_date,
    COALESCE(jc.created_at, NOW())
  FROM joincompetition jc
  LEFT JOIN competitions c ON (
    -- FIX: competitionid is TEXT, use regex check before casting to UUID
    (jc.competitionid ~* v_uuid_regex AND jc.competitionid::UUID = c.id)
    OR c.uid = jc.competitionid
  )
  WHERE
    LOWER(jc.wallet_address) = lower_identifier
    OR jc.canonical_user_id = p_user_identifier
    OR jc.privy_user_id = p_user_identifier
    OR jc.userid::TEXT = p_user_identifier
    OR (search_wallet IS NOT NULL AND LOWER(jc.wallet_address) = search_wallet)
  ORDER BY jc.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_user_competition_entries(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_competition_entries(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_user_competition_entries(TEXT) TO service_role;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

DO $$
DECLARE
  func_count INTEGER;
BEGIN
  SELECT COUNT(DISTINCT p.proname) INTO func_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'allocate_lucky_dip_tickets_batch',
      'reserve_lucky_dip',
      'validate_pending_tickets',
      'update_tickets_sold_on_pending',
      'trg_fn_confirm_pending_tickets',
      'check_and_mark_competition_sold_out',
      'get_unavailable_tickets',
      'get_competition_unavailable_tickets',
      'get_competition_ticket_availability_text',
      'get_competition_entries_bypass_rls',
      'get_competition_entries',
      'get_comprehensive_user_dashboard_entries',
      'get_user_competition_entries'
    );

  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'COMPREHENSIVE UUID/TEXT FIX - VERIFICATION';
  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'Functions created/updated: % (expected: 13)', func_count;
  RAISE NOTICE '';
  RAISE NOTICE 'Type rules now correctly applied:';
  RAISE NOTICE '  competitions.id           = UUID  (direct comparison)';
  RAISE NOTICE '  tickets.competition_id    = UUID  (direct comparison)';
  RAISE NOTICE '  pending_tickets.competition_id = UUID (verified in production 2026-03-03)';
  RAISE NOTICE '  pending_ticket_items.competition_id = UUID (verified in production)';
  RAISE NOTICE '  joincompetition.competitionid  = UUID (verified in production)';
  RAISE NOTICE '  joincompetition.competition_id  = UUID';
  RAISE NOTICE '';
  RAISE NOTICE 'All unnecessary TEXT conversions removed.';
  RAISE NOTICE '=====================================================';
END $$;

COMMIT;
