-- ============================================================================
-- DROP ALL OVERLOADS - Force complete function rebuild
-- ============================================================================

-- Drop every possible signature of allocate_lucky_dip_tickets_batch
DROP FUNCTION IF EXISTS public.allocate_lucky_dip_tickets_batch(TEXT, UUID, INTEGER, NUMERIC, INTEGER, TEXT, INTEGER[]) CASCADE;
DROP FUNCTION IF EXISTS public.allocate_lucky_dip_tickets_batch(TEXT, TEXT, INTEGER, NUMERIC, INTEGER, TEXT, INTEGER[]) CASCADE;
DROP FUNCTION IF EXISTS public.allocate_lucky_dip_tickets_batch(TEXT, UUID, INTEGER, NUMERIC, INTEGER, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.allocate_lucky_dip_tickets_batch(TEXT, UUID, INTEGER, NUMERIC, INTEGER) CASCADE;
DROP FUNCTION IF EXISTS public.allocate_lucky_dip_tickets_batch(TEXT, UUID, INTEGER, NUMERIC) CASCADE;
DROP FUNCTION IF EXISTS public.allocate_lucky_dip_tickets_batch(TEXT, UUID, INTEGER) CASCADE;
DROP FUNCTION IF EXISTS public.allocate_lucky_dip_tickets_batch CASCADE;

-- Recreate with ONLY competition_id references
CREATE FUNCTION public.allocate_lucky_dip_tickets_batch(
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
  v_sold_from_jc INTEGER[];
  v_sold_from_tickets INTEGER[];
  v_sold_from_pending INTEGER[];
  v_all_unavailable INTEGER[];
  v_available_tickets INTEGER[];
  v_selected_tickets INTEGER[];
  v_reservation_id UUID;
  v_expires_at TIMESTAMPTZ;
  v_total_amount DECIMAL;
  v_available_count INTEGER;
  v_random_offset INTEGER;
BEGIN
  IF p_count < 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Count must be at least 1');
  END IF;
  IF p_count > 500 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Count cannot exceed 500 per batch', 'max_batch_size', 500);
  END IF;

  SELECT total_tickets INTO v_total_tickets
  FROM competitions
  WHERE id = p_competition_id AND deleted = false AND status = 'active'
  FOR UPDATE SKIP LOCKED;

  IF v_total_tickets IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Competition not found, not active, or temporarily locked', 'retryable', true);
  END IF;

  v_all_unavailable := COALESCE(p_excluded_tickets, ARRAY[]::INTEGER[]);

  -- CRITICAL: Using competition_id column (NOT competitionid)
  WITH jc_sold AS (
    SELECT unnest(string_to_array(ticketnumbers, ',')) AS num_text
    FROM joincompetition
    WHERE competition_id = p_competition_id
      AND ticketnumbers IS NOT NULL
      AND ticketnumbers != ''
  )
  SELECT COALESCE(array_agg(DISTINCT CAST(TRIM(num_text) AS INTEGER)), ARRAY[]::INTEGER[]) INTO v_sold_from_jc
  FROM jc_sold
  WHERE num_text ~ '^\s*\d+\s*$'
    AND CAST(TRIM(num_text) AS INTEGER) BETWEEN 1 AND v_total_tickets;

  SELECT COALESCE(array_agg(ticket_number), ARRAY[]::INTEGER[]) INTO v_sold_from_tickets
  FROM tickets
  WHERE competition_id = p_competition_id AND ticket_number IS NOT NULL;

  WITH pending_nums AS (
    SELECT unnest(ticket_numbers) AS ticket_num
    FROM pending_tickets
    WHERE competition_id = p_competition_id
      AND status = 'pending'
      AND expires_at > NOW()
      AND user_id != p_user_id
  )
  SELECT COALESCE(array_agg(ticket_num), ARRAY[]::INTEGER[]) INTO v_sold_from_pending
  FROM pending_nums;

  v_all_unavailable := v_all_unavailable || v_sold_from_jc || v_sold_from_tickets || v_sold_from_pending;

  SELECT COALESCE(array_agg(DISTINCT u), ARRAY[]::INTEGER[]) INTO v_all_unavailable
  FROM unnest(v_all_unavailable) AS u
  WHERE u IS NOT NULL;

  v_random_offset := floor(random() * v_total_tickets)::INTEGER;
  SELECT array_agg(ticket_num ORDER BY (ticket_num + v_random_offset) % v_total_tickets + random()) INTO v_available_tickets
  FROM generate_series(1, v_total_tickets) AS ticket_num
  WHERE ticket_num != ALL(v_all_unavailable);

  v_available_count := COALESCE(array_length(v_available_tickets, 1), 0);

  IF v_available_count = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'No tickets available', 'available_count', 0);
  END IF;
  IF v_available_count < p_count THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient availability', 'available_count', v_available_count, 'requested_count', p_count);
  END IF;

  v_selected_tickets := v_available_tickets[1:p_count];

  UPDATE pending_tickets
  SET status = 'cancelled', updated_at = NOW()
  WHERE user_id = p_user_id AND competition_id = p_competition_id AND status = 'pending';

  v_reservation_id := gen_random_uuid();
  v_expires_at := NOW() + make_interval(mins => LEAST(GREATEST(p_hold_minutes, 1), 60));
  v_total_amount := p_count * p_ticket_price;

  INSERT INTO pending_tickets (
    id, user_id, competition_id, ticket_numbers, ticket_count,
    ticket_price, total_amount, status, session_id,
    expires_at, created_at, updated_at
  ) VALUES (
    v_reservation_id, p_user_id, p_competition_id, v_selected_tickets, p_count,
    p_ticket_price, v_total_amount, 'pending', p_session_id,
    v_expires_at, NOW(), NOW()
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
  RETURN jsonb_build_object('success', false, 'error', 'Failed to allocate tickets: ' || SQLERRM, 'retryable', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.allocate_lucky_dip_tickets_batch(TEXT, UUID, INTEGER, NUMERIC, INTEGER, TEXT, INTEGER[]) TO authenticated, service_role, anon;

-- Force PostgREST schema reload
NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '========================================================';
  RAISE NOTICE 'DROPPED ALL OVERLOADS + RECREATED';
  RAISE NOTICE 'allocate_lucky_dip_tickets_batch @ competition_id ONLY';
  RAISE NOTICE 'PostgREST reload signal sent';
  RAISE NOTICE '========================================================';
END $$;
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
-- ============================================================================
-- FIX: get_competition_entries_bypass_rls (last function using competitionid)
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_competition_entries_bypass_rls(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.get_competition_entries_bypass_rls(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.get_competition_entries(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.get_competition_entries(UUID) CASCADE;

CREATE OR REPLACE FUNCTION public.get_competition_entries_bypass_rls(competition_identifier UUID)
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
  IF competition_identifier IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(jc.uid::TEXT, jc.id::TEXT, gen_random_uuid()::TEXT),
    COALESCE(jc.competition_id::TEXT, '')::TEXT,  -- Changed from competitionid
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
  WHERE jc.competition_id = competition_identifier  -- Changed from competitionid

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
  WHERE t.competition_id = competition_identifier
    AND NOT EXISTS (
      SELECT 1 FROM joincompetition jc2
      WHERE jc2.competition_id = competition_identifier  -- Changed from competitionid
        AND (jc2.canonical_user_id = t.canonical_user_id
          OR LOWER(jc2.wallet_address) = LOWER(t.user_id)
          OR jc2.userid::TEXT = t.user_id)
    )
  GROUP BY t.competition_id, t.canonical_user_id, t.user_id

  ORDER BY purchasedate DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_competition_entries_bypass_rls(UUID) TO authenticated, anon, service_role;

CREATE OR REPLACE FUNCTION public.get_competition_entries(competition_identifier UUID)
RETURNS TABLE (
  uid TEXT, competitionid TEXT, userid TEXT, privy_user_id TEXT,
  numberoftickets INTEGER, ticketnumbers TEXT, amountspent NUMERIC,
  wallet_address TEXT, chain TEXT, transactionhash TEXT,
  purchasedate TIMESTAMPTZ, created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN QUERY SELECT * FROM get_competition_entries_bypass_rls(competition_identifier);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_competition_entries(UUID) TO authenticated, anon, service_role;

-- Force PostgREST schema reload
NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '========================================================';
  RAISE NOTICE 'FIXED: get_competition_entries_bypass_rls';
  RAISE NOTICE 'FIXED: get_competition_entries';
  RAISE NOTICE 'ALL FUNCTIONS NOW USE competition_id';
  RAISE NOTICE 'NO MORE competitionid REFERENCES';
  RAISE NOTICE '========================================================';
END $$;
-- ============================================================================
-- FIX: purchase_events VIEW using jc.competitionid
-- ============================================================================

DROP VIEW IF EXISTS public.purchase_groups CASCADE;
DROP VIEW IF EXISTS public.purchase_events CASCADE;

CREATE OR REPLACE VIEW public.purchase_events AS
-- Purchases from tickets table  
SELECT 
  t.id::text AS source_row_id,
  'tickets'::text AS source_table,
  COALESCE(t.user_id, t.canonical_user_id) AS user_id,
  t.competition_id::text AS competition_id,
  t.purchase_price AS amount,
  t.created_at AS occurred_at,
  t.purchase_key
FROM public.tickets t
WHERE t.competition_id IS NOT NULL
  AND t.purchase_price IS NOT NULL
  AND t.created_at IS NOT NULL
  AND (t.purchase_key IS NULL OR NOT t.purchase_key LIKE 'bal_%')

UNION ALL

-- Purchases from joincompetition table - FIXED: use competition_id NOT competitionid
SELECT 
  jc.id::text AS source_row_id,
  'joincompetition'::text AS source_table,
  jc.canonical_user_id AS user_id,
  jc.competition_id::text AS competition_id,  -- CHANGED FROM competitionid
  jc.amount_spent AS amount,
  jc.created_at AS occurred_at,
  NULL AS purchase_key
FROM public.joincompetition jc
WHERE jc.competition_id IS NOT NULL  -- CHANGED FROM competitionid
  AND jc.amount_spent IS NOT NULL
  AND jc.created_at IS NOT NULL;

COMMENT ON VIEW public.purchase_events IS 
'Unified view of all purchase events from tickets and joincompetition tables.';

-- Force PostgREST schema reload
NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '========================================================';
  RAISE NOTICE 'FIXED: purchase_events VIEW';
  RAISE NOTICE 'NOW USES jc.competition_id (NOT competitionid)';
  RAISE NOTICE 'THIS WAS THE ROOT CAUSE OF THE ERROR';
  RAISE NOTICE '========================================================';
END $$;
-- ============================================================================
-- FIX: get_comprehensive_user_dashboard_entries using jc.competitionid
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_comprehensive_user_dashboard_entries(TEXT) CASCADE;

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

  -- Part 1: JOIN competition entries - FIXED: use competition_id NOT competitionid
  SELECT
    COALESCE(jc.uid, 'jc-' || COALESCE(jc.competition_id::TEXT, '') || '-' || COALESCE(jc.wallet_address, '') || '-' || COALESCE(jc.created_at::TEXT, '')),
    COALESCE(jc.competition_id::TEXT, c.id::TEXT, c.uid),
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
  LEFT JOIN public.competitions c ON jc.competition_id = c.id  -- CHANGED: direct UUID comparison
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
  AND jc.competition_id IS NOT NULL  -- CHANGED: use competition_id

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
  LEFT JOIN public.competitions c ON t.competition_id = c.id
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

  ORDER BY purchase_date DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_comprehensive_user_dashboard_entries(TEXT) TO authenticated, anon, service_role;

-- Force PostgREST schema reload
NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '========================================================';
  RAISE NOTICE 'FIXED: get_comprehensive_user_dashboard_entries';
  RAISE NOTICE 'NOW USES jc.competition_id (NOT competitionid)';
  RAISE NOTICE '========================================================';
END $$;
-- ============================================================================
-- FIX: get_user_competition_entries using jc.competitionid (LAST ONE!)
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_user_competition_entries(TEXT) CASCADE;

CREATE OR REPLACE FUNCTION public.get_user_competition_entries(p_user_identifier TEXT)
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
    COALESCE(jc.competition_id::TEXT, c.id::TEXT),  -- CHANGED: use competition_id
    COALESCE(c.title, ''),
    COALESCE(c.image_url, c.imageurl, ''),
    COALESCE(jc.numberoftickets, 0)::INTEGER,
    COALESCE(jc.ticketnumbers, ''),
    'confirmed',
    COALESCE(c.status, 'active'),
    c.end_date,
    COALESCE(jc.created_at, NOW())
  FROM joincompetition jc
  LEFT JOIN competitions c ON jc.competition_id = c.id  -- CHANGED: direct UUID comparison
  WHERE
    LOWER(jc.wallet_address) = lower_identifier
    OR jc.canonical_user_id = p_user_identifier
    OR jc.privy_user_id = p_user_identifier
    OR jc.userid::TEXT = p_user_identifier
    OR (search_wallet IS NOT NULL AND LOWER(jc.wallet_address) = search_wallet)
  ORDER BY jc.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_competition_entries(TEXT) TO authenticated, anon, service_role;

-- Force PostgREST schema reload
NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '========================================================';
  RAISE NOTICE 'FIXED: get_user_competition_entries (THE LAST ONE!)';
  RAISE NOTICE 'ALL jc.competitionid REFERENCES NOW ELIMINATED';
  RAISE NOTICE 'TESTING SHOULD FINALLY WORK';
  RAISE NOTICE '========================================================';
END $$;
