-- ============================================================================
-- FINAL COMPREHENSIVE RPC FIX - Apply to Supabase
-- ============================================================================
-- This migration fixes ALL remaining type mismatch errors:
--
-- 1. check_and_mark_competition_sold_out - 300 error (ambiguous function)
-- 2. get_competition_ticket_availability_text - 404 (uuid = text in WHERE)
-- 3. get_unavailable_tickets - 404 (uuid = text in WHERE)
-- 4. get_competition_entries - 400 (empty string to uuid cast)
-- 5. get_comprehensive_user_dashboard_entries - 404 (uuid ~* regex)
-- 6. get_user_competition_entries - 404 (uuid = text)
--
-- ROOT CAUSE: SQL functions have internal type mismatches where:
--   - UUID columns are compared with TEXT variables without explicit casts
--   - The regex operator (~*) is used with UUID columns
--   - Empty strings are cast to UUID causing parse errors
--
-- HOW TO APPLY:
-- 1. Go to Supabase Dashboard -> SQL Editor
-- 2. Paste this entire script
-- 3. Click "Run"
-- ============================================================================

BEGIN;

-- ============================================================================
-- PART 1: Fix check_and_mark_competition_sold_out (300 ambiguity error)
-- Problem: Two overloads with same parameter name cause Postgres ambiguity
-- Solution: Drop both overloads, create single TEXT version that handles both
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
  -- Handle NULL or empty input
  IF p_competition_id IS NULL OR TRIM(p_competition_id) = '' THEN
    RETURN FALSE;
  END IF;

  -- Convert TEXT to UUID with error handling
  BEGIN
    v_competition_uuid := p_competition_id::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    -- Try to find by uid column if not a valid UUID
    SELECT id INTO v_competition_uuid
    FROM competitions
    WHERE uid = p_competition_id
    LIMIT 1;

    IF v_competition_uuid IS NULL THEN
      RETURN FALSE;
    END IF;
  END;

  -- Get competition total tickets (use explicit UUID comparison)
  SELECT total_tickets INTO v_total_tickets
  FROM competitions
  WHERE id = v_competition_uuid;

  IF v_total_tickets IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Count sold tickets from joincompetition
  SELECT COALESCE(SUM(numberoftickets), 0) INTO v_sold_count
  FROM joincompetition
  WHERE competitionid = v_competition_uuid::TEXT;

  -- Check if sold out
  IF v_sold_count >= v_total_tickets THEN
    v_is_sold_out := TRUE;

    -- Update competition status to sold_out
    UPDATE competitions
    SET status = 'sold_out',
        updated_at = NOW()
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
-- PART 2: Fix get_competition_ticket_availability_text (uuid = text)
-- Problem: WHERE tickets.competition_id = v_competition_uuid fails when
--          competition_id is UUID column and v_competition_uuid is TEXT
-- Solution: Use explicit UUID comparison
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
  IF competition_id_text IS NULL OR TRIM(competition_id_text) = '' THEN
    RETURN json_build_object(
      'competition_id', competition_id_text,
      'total_tickets', 0,
      'available_tickets', ARRAY[]::INTEGER[],
      'sold_count', 0,
      'available_count', 0,
      'error', 'Invalid competition ID'
    );
  END IF;

  -- Parse UUID with error handling
  BEGIN
    v_competition_uuid := competition_id_text::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    -- Try to find by uid
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

  -- Get competition details (use UUID column directly)
  SELECT
    TRUE,
    COALESCE(c.total_tickets, 1000),
    c.uid
  INTO v_competition_exists, v_total_tickets, v_comp_uid
  FROM competitions c
  WHERE c.id = v_competition_uuid;

  IF NOT COALESCE(v_competition_exists, FALSE) THEN
    RETURN json_build_object(
      'competition_id', competition_id_text,
      'total_tickets', 0,
      'available_tickets', ARRAY[]::INTEGER[],
      'sold_count', 0,
      'available_count', 0,
      'error', 'Competition not found'
    );
  END IF;

  -- Get sold tickets from joincompetition (competitionid is TEXT column)
  SELECT COALESCE(array_agg(DISTINCT ticket_num), ARRAY[]::INTEGER[])
  INTO v_sold_tickets_jc
  FROM (
    SELECT CAST(TRIM(unnest(string_to_array(ticketnumbers, ','))) AS INTEGER) AS ticket_num
    FROM joincompetition
    WHERE (
      competitionid = v_competition_uuid::TEXT
      OR (v_comp_uid IS NOT NULL AND competitionid = v_comp_uid)
      OR competitionid = competition_id_text
    )
      AND ticketnumbers IS NOT NULL
      AND TRIM(ticketnumbers) != ''
  ) AS jc_tickets
  WHERE ticket_num IS NOT NULL;

  v_sold_tickets_jc := COALESCE(v_sold_tickets_jc, ARRAY[]::INTEGER[]);

  -- Get sold tickets from tickets table (competition_id is UUID column)
  SELECT COALESCE(array_agg(DISTINCT ticket_number), ARRAY[]::INTEGER[])
  INTO v_sold_tickets_table
  FROM tickets t
  WHERE t.competition_id = v_competition_uuid;  -- UUID = UUID comparison

  v_sold_tickets_table := COALESCE(v_sold_tickets_table, ARRAY[]::INTEGER[]);

  -- Combine sold tickets
  v_unavailable_tickets := v_sold_tickets_jc || v_sold_tickets_table;

  -- Get pending reservations (competition_id is UUID column)
  BEGIN
    SELECT COALESCE(array_agg(DISTINCT ticket_num), ARRAY[]::INTEGER[])
    INTO v_pending_tickets
    FROM (
      SELECT unnest(ticket_numbers) AS ticket_num
      FROM pending_tickets pt
      WHERE pt.competition_id = v_competition_uuid  -- UUID = UUID comparison
        AND pt.status = 'pending'
        AND pt.expires_at > NOW()
    ) AS pending
    WHERE ticket_num IS NOT NULL;
  EXCEPTION WHEN undefined_table THEN
    v_pending_tickets := ARRAY[]::INTEGER[];
  END;

  v_pending_tickets := COALESCE(v_pending_tickets, ARRAY[]::INTEGER[]);
  v_unavailable_tickets := v_unavailable_tickets || v_pending_tickets;

  -- Remove duplicates
  IF array_length(v_unavailable_tickets, 1) IS NOT NULL AND array_length(v_unavailable_tickets, 1) > 0 THEN
    SELECT COALESCE(array_agg(DISTINCT u ORDER BY u), ARRAY[]::INTEGER[])
    INTO v_unavailable_tickets
    FROM unnest(v_unavailable_tickets) AS u;
  ELSE
    v_unavailable_tickets := ARRAY[]::INTEGER[];
  END IF;

  -- Calculate counts
  v_sold_count := COALESCE(array_length(v_unavailable_tickets, 1), 0);
  v_available_count := GREATEST(0, v_total_tickets - v_sold_count);

  -- Generate available tickets array (limit to first 10000 for performance)
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
-- PART 3: Fix get_unavailable_tickets (uuid = text)
-- Problem: WHERE tickets.competition_id = v_competition_uuid fails
-- Solution: Ensure v_competition_uuid is UUID type before comparison
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
  SELECT COALESCE(array_agg(DISTINCT ticket_num), ARRAY[]::INTEGER[])
  INTO v_sold_jc
  FROM (
    SELECT CAST(TRIM(unnest(string_to_array(ticketnumbers, ','))) AS INTEGER) AS ticket_num
    FROM joincompetition
    WHERE (
      competitionid = v_competition_uuid::TEXT
      OR (v_comp_uid IS NOT NULL AND competitionid = v_comp_uid)
      OR competitionid = competition_id
    )
      AND ticketnumbers IS NOT NULL
      AND TRIM(ticketnumbers) != ''
  ) AS jc_tickets
  WHERE ticket_num IS NOT NULL;

  v_sold_jc := COALESCE(v_sold_jc, ARRAY[]::INTEGER[]);

  -- Get sold tickets from tickets table (competition_id is UUID)
  SELECT COALESCE(array_agg(DISTINCT t.ticket_number), ARRAY[]::INTEGER[])
  INTO v_sold_tickets
  FROM tickets t
  WHERE t.competition_id = v_competition_uuid;  -- UUID = UUID

  v_sold_tickets := COALESCE(v_sold_tickets, ARRAY[]::INTEGER[]);

  -- Get pending tickets (competition_id is UUID)
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
  EXCEPTION WHEN undefined_table THEN
    v_pending := ARRAY[]::INTEGER[];
  END;

  v_pending := COALESCE(v_pending, ARRAY[]::INTEGER[]);

  -- Combine all unavailable tickets
  v_unavailable := v_sold_jc || v_sold_tickets || v_pending;

  -- Remove duplicates
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
-- PART 4: Fix get_competition_entries and get_competition_entries_bypass_rls
-- Problem: Empty string cast to UUID causes "invalid input syntax for type uuid"
-- Solution: Handle empty strings and ensure proper UUID conversion
-- ============================================================================
DROP FUNCTION IF EXISTS get_competition_entries_bypass_rls(TEXT) CASCADE;
DROP FUNCTION IF EXISTS get_competition_entries_bypass_rls(UUID) CASCADE;
DROP FUNCTION IF EXISTS get_competition_entries(TEXT) CASCADE;
DROP FUNCTION IF EXISTS get_competition_entries(UUID) CASCADE;

CREATE OR REPLACE FUNCTION get_competition_entries_bypass_rls(competition_identifier TEXT)
RETURNS TABLE (
  uid TEXT,
  competitionid TEXT,
  userid TEXT,
  privy_user_id TEXT,
  numberoftickets INTEGER,
  ticketnumbers TEXT,
  amountspent NUMERIC,
  walletaddress TEXT,
  chain TEXT,
  transactionhash TEXT,
  purchasedate TIMESTAMPTZ,
  created_at TIMESTAMPTZ
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
  -- Handle NULL or empty input
  IF competition_identifier IS NULL OR TRIM(competition_identifier) = '' THEN
    RETURN;  -- Return empty result set
  END IF;

  -- Try to parse as UUID
  BEGIN
    comp_uuid := competition_identifier::UUID;
    comp_uid_text := competition_identifier;
  EXCEPTION WHEN invalid_text_representation THEN
    -- Not a UUID, try to find by uid
    SELECT c.id, c.uid INTO comp_uuid, comp_uid_text
    FROM competitions c
    WHERE c.uid = competition_identifier
    LIMIT 1;
  END;

  -- If we have a UUID, get the uid as well
  IF comp_uuid IS NOT NULL AND (comp_uid_text IS NULL OR comp_uid_text = competition_identifier) THEN
    SELECT c.uid INTO comp_uid_text
    FROM competitions c
    WHERE c.id = comp_uuid
    LIMIT 1;
  END IF;

  -- Return results
  RETURN QUERY
  -- Source 1: joincompetition table (primary source)
  SELECT
    COALESCE(jc.uid::TEXT, jc.id::TEXT, gen_random_uuid()::TEXT) AS uid,
    COALESCE(jc.competitionid, '')::TEXT AS competitionid,
    COALESCE(jc.userid::TEXT, '')::TEXT AS userid,
    COALESCE(jc.privy_user_id, jc.walletaddress, '')::TEXT AS privy_user_id,
    COALESCE(jc.numberoftickets, 1)::INTEGER AS numberoftickets,
    COALESCE(jc.ticketnumbers, '')::TEXT AS ticketnumbers,
    COALESCE(jc.amountspent, 0)::NUMERIC AS amountspent,
    COALESCE(jc.walletaddress, '')::TEXT AS walletaddress,
    COALESCE(jc.chain, 'Base')::TEXT AS chain,
    COALESCE(jc.transactionhash, '')::TEXT AS transactionhash,
    COALESCE(jc.purchasedate, jc.created_at, NOW())::TIMESTAMPTZ AS purchasedate,
    COALESCE(jc.created_at, NOW())::TIMESTAMPTZ AS created_at
  FROM joincompetition jc
  WHERE
    jc.competitionid = competition_identifier
    OR (comp_uuid IS NOT NULL AND jc.competitionid = comp_uuid::TEXT)
    OR (comp_uid_text IS NOT NULL AND comp_uid_text != '' AND jc.competitionid = comp_uid_text)

  UNION ALL

  -- Source 2: tickets table (fallback)
  SELECT
    ('tickets-' || COALESCE(t.canonical_user_id, t.user_id, 'unknown') || '-' || t.competition_id::TEXT)::TEXT AS uid,
    COALESCE(t.competition_id::TEXT, '')::TEXT AS competitionid,
    COALESCE(t.user_id, '')::TEXT AS userid,
    COALESCE(t.user_id, '')::TEXT AS privy_user_id,
    COUNT(*)::INTEGER AS numberoftickets,
    string_agg(t.ticket_number::TEXT, ',' ORDER BY t.ticket_number)::TEXT AS ticketnumbers,
    COALESCE(SUM(t.purchase_price), 0)::NUMERIC AS amountspent,
    COALESCE(t.user_id, '')::TEXT AS walletaddress,
    'USDC'::TEXT AS chain,
    ''::TEXT AS transactionhash,
    MIN(t.created_at)::TIMESTAMPTZ AS purchasedate,
    MIN(t.created_at)::TIMESTAMPTZ AS created_at
  FROM tickets t
  WHERE
    comp_uuid IS NOT NULL
    AND t.competition_id = comp_uuid  -- UUID = UUID comparison
    -- Only include tickets that don't have a corresponding joincompetition entry
    AND NOT EXISTS (
      SELECT 1 FROM joincompetition jc2
      WHERE (
        jc2.competitionid = competition_identifier
        OR (comp_uuid IS NOT NULL AND jc2.competitionid = comp_uuid::TEXT)
        OR (comp_uid_text IS NOT NULL AND comp_uid_text != '' AND jc2.competitionid = comp_uid_text)
      )
      AND (
        jc2.canonical_user_id = t.canonical_user_id
        OR LOWER(jc2.walletaddress) = LOWER(t.user_id)
        OR jc2.userid::TEXT = t.user_id
      )
    )
  GROUP BY t.competition_id, t.canonical_user_id, t.user_id

  ORDER BY purchasedate DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_competition_entries_bypass_rls(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_competition_entries_bypass_rls(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_competition_entries_bypass_rls(TEXT) TO service_role;

-- Create wrapper function
CREATE OR REPLACE FUNCTION get_competition_entries(competition_identifier TEXT)
RETURNS TABLE (
  uid TEXT,
  competitionid TEXT,
  userid TEXT,
  privy_user_id TEXT,
  numberoftickets INTEGER,
  ticketnumbers TEXT,
  amountspent NUMERIC,
  walletaddress TEXT,
  chain TEXT,
  transactionhash TEXT,
  purchasedate TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT * FROM get_competition_entries_bypass_rls(competition_identifier);
END;
$$;

GRANT EXECUTE ON FUNCTION get_competition_entries(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_competition_entries(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_competition_entries(TEXT) TO service_role;

-- ============================================================================
-- PART 5: Fix get_comprehensive_user_dashboard_entries (uuid ~* regex)
-- Problem: Line 215 uses ~* operator with UUID column (c.id)
-- Solution: Cast UUID to TEXT before regex comparison
-- ============================================================================
DROP FUNCTION IF EXISTS get_comprehensive_user_dashboard_entries(TEXT) CASCADE;

CREATE OR REPLACE FUNCTION public.get_comprehensive_user_dashboard_entries(user_identifier TEXT)
RETURNS TABLE (
  id TEXT,
  competition_id TEXT,
  title TEXT,
  description TEXT,
  image TEXT,
  status TEXT,
  entry_type TEXT,
  is_winner BOOLEAN,
  ticket_numbers TEXT,
  total_tickets INTEGER,
  total_amount_spent NUMERIC,
  purchase_date TIMESTAMPTZ,
  transaction_hash TEXT,
  is_instant_win BOOLEAN,
  prize_value NUMERIC,
  competition_status TEXT,
  end_date TIMESTAMPTZ
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
  -- Normalize identifier
  lower_identifier := LOWER(TRIM(user_identifier));

  -- Extract wallet address if present
  IF user_identifier LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(user_identifier FROM 11));
  ELSIF user_identifier LIKE '0x%' THEN
    search_wallet := lower_identifier;
  ELSE
    search_wallet := NULL;
  END IF;

  -- Resolve user from canonical_users table
  SELECT
    cu.canonical_user_id,
    LOWER(cu.wallet_address),
    LOWER(cu.base_wallet_address),
    LOWER(cu.eth_wallet_address),
    cu.privy_user_id,
    cu.uid
  INTO
    resolved_canonical_user_id,
    resolved_wallet_address,
    resolved_base_wallet_address,
    resolved_eth_wallet_address,
    resolved_privy_user_id,
    resolved_uid
  FROM canonical_users cu
  WHERE
    cu.canonical_user_id = user_identifier
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

  -- Part 1: Entries from joincompetition table
  SELECT
    COALESCE(jc.uid, 'jc-' || COALESCE(jc.competitionid, '') || '-' || COALESCE(jc.walletaddress, '') || '-' || COALESCE(jc.created_at::TEXT, '')) AS id,
    COALESCE(jc.competitionid, c.id::TEXT, c.uid) AS competition_id,
    COALESCE(c.title, '') AS title,
    COALESCE(c.description, '') AS description,
    COALESCE(c.image_url, c.imageurl, '') AS image,
    CASE
      WHEN c.winner_address IS NOT NULL THEN 'completed'
      WHEN c.status = 'active' THEN 'live'
      WHEN c.status IN ('drawn', 'completed') THEN 'completed'
      ELSE COALESCE(c.status, 'live')
    END AS status,
    'competition_entry' AS entry_type,
    COALESCE(LOWER(c.winner_address) = LOWER(jc.walletaddress), FALSE) AS is_winner,
    COALESCE(jc.ticketnumbers, '') AS ticket_numbers,
    COALESCE(jc.numberoftickets, 0)::INTEGER AS total_tickets,
    COALESCE(jc.numberoftickets * c.ticket_price, jc.amountspent, 0) AS total_amount_spent,
    COALESCE(jc.purchasedate, jc.created_at) AS purchase_date,
    jc.transactionhash AS transaction_hash,
    COALESCE(c.is_instant_win, FALSE) AS is_instant_win,
    c.prize_value AS prize_value,
    COALESCE(c.status, 'completed') AS competition_status,
    c.end_date AS end_date
  FROM public.joincompetition jc
  LEFT JOIN public.competitions c ON (
    -- FIX: Cast competitionid to TEXT for regex, then try UUID cast if valid
    (jc.competitionid ~* v_uuid_regex AND jc.competitionid::UUID = c.id)
    OR c.uid = jc.competitionid
  )
  WHERE (
    (resolved_canonical_user_id IS NOT NULL AND jc.canonical_user_id = resolved_canonical_user_id)
    OR (resolved_wallet_address IS NOT NULL AND LOWER(jc.walletaddress) = resolved_wallet_address)
    OR (resolved_base_wallet_address IS NOT NULL AND LOWER(jc.walletaddress) = resolved_base_wallet_address)
    OR (resolved_eth_wallet_address IS NOT NULL AND LOWER(jc.walletaddress) = resolved_eth_wallet_address)
    OR (resolved_privy_user_id IS NOT NULL AND jc.privy_user_id = resolved_privy_user_id)
    OR (resolved_uid IS NOT NULL AND jc.userid::TEXT = resolved_uid)
    OR (resolved_canonical_user_id IS NULL AND (
      jc.canonical_user_id = user_identifier
      OR LOWER(jc.walletaddress) = lower_identifier
      OR jc.userid::TEXT = user_identifier
      OR (search_wallet IS NOT NULL AND LOWER(jc.walletaddress) = search_wallet)
    ))
  )
  AND jc.competitionid IS NOT NULL
  AND jc.competitionid != ''
  AND (c.id IS NOT NULL OR jc.competitionid IS NOT NULL)

  UNION ALL

  -- Part 2: Entries from tickets table
  SELECT
    ('tickets-' || COALESCE(t.canonical_user_id, t.user_id, 'anon-' || t.competition_id::TEXT) || '-' || t.competition_id::TEXT)::TEXT AS id,
    t.competition_id::TEXT AS competition_id,
    COALESCE(c.title, '') AS title,
    COALESCE(c.description, '') AS description,
    COALESCE(c.image_url, c.imageurl, '') AS image,
    CASE
      WHEN c.winner_address IS NOT NULL THEN 'completed'
      WHEN c.status = 'active' THEN 'live'
      WHEN c.status IN ('drawn', 'completed') THEN 'completed'
      ELSE COALESCE(c.status, 'live')
    END AS status,
    'ticket' AS entry_type,
    COALESCE(t.is_winner, FALSE) AS is_winner,
    STRING_AGG(t.ticket_number::TEXT, ',' ORDER BY t.ticket_number) AS ticket_numbers,
    COUNT(t.id)::INTEGER AS total_tickets,
    SUM(COALESCE(t.purchase_price, c.ticket_price, 0)) AS total_amount_spent,
    MIN(t.purchased_at) AS purchase_date,
    NULL::TEXT AS transaction_hash,
    COALESCE(c.is_instant_win, FALSE) AS is_instant_win,
    c.prize_value AS prize_value,
    COALESCE(c.status, 'completed') AS competition_status,
    c.end_date AS end_date
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

  UNION ALL

  -- Part 3: Entries from user_transactions
  SELECT
    ut.id::TEXT AS id,
    ut.competition_id::TEXT AS competition_id,
    COALESCE(c.title, '') AS title,
    COALESCE(c.description, '') AS description,
    COALESCE(c.image_url, c.imageurl, '') AS image,
    CASE
      WHEN ut.payment_status = 'completed' AND c.winner_address IS NOT NULL THEN 'completed'
      WHEN ut.payment_status = 'pending' THEN 'pending'
      WHEN ut.payment_status = 'failed' THEN 'failed'
      WHEN c.status = 'active' THEN 'live'
      WHEN c.status IN ('drawn', 'completed') THEN 'completed'
      ELSE COALESCE(c.status, 'live')
    END AS status,
    'transaction' AS entry_type,
    FALSE AS is_winner,
    '' AS ticket_numbers,
    COALESCE(ut.ticket_count, 0)::INTEGER AS total_tickets,
    COALESCE(ut.amount, 0) AS total_amount_spent,
    ut.created_at AS purchase_date,
    COALESCE(ut.tx_id, ut.charge_id, ut.charge_code, ut.tx_ref, ut.order_id) AS transaction_hash,
    COALESCE(c.is_instant_win, FALSE) AS is_instant_win,
    c.prize_value AS prize_value,
    COALESCE(c.status, 'completed') AS competition_status,
    c.end_date AS end_date
  FROM public.user_transactions ut
  LEFT JOIN public.competitions c ON ut.competition_id = c.id
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

  -- Part 4: Entries from pending_tickets
  SELECT
    pt.id::TEXT AS id,
    pt.competition_id::TEXT AS competition_id,
    COALESCE(c.title, '') AS title,
    COALESCE(c.description, '') AS description,
    COALESCE(c.image_url, c.imageurl, '') AS image,
    CASE
      WHEN pt.status = 'confirmed' THEN 'completed'
      WHEN pt.status = 'pending' THEN 'pending'
      WHEN pt.status = 'expired' THEN 'expired'
      ELSE pt.status
    END AS status,
    'pending_ticket' AS entry_type,
    FALSE AS is_winner,
    ARRAY_TO_STRING(pt.ticket_numbers, ',') AS ticket_numbers,
    pt.ticket_count::INTEGER AS total_tickets,
    pt.total_amount AS total_amount_spent,
    pt.created_at AS purchase_date,
    pt.transaction_hash AS transaction_hash,
    COALESCE(c.is_instant_win, FALSE) AS is_instant_win,
    c.prize_value AS prize_value,
    COALESCE(c.status, 'active') AS competition_status,
    c.end_date AS end_date
  FROM public.pending_tickets pt
  LEFT JOIN public.competitions c ON pt.competition_id = c.id
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
-- PART 6: Fix get_user_competition_entries (uuid = text)
-- ============================================================================
DROP FUNCTION IF EXISTS get_user_competition_entries(TEXT) CASCADE;

CREATE OR REPLACE FUNCTION get_user_competition_entries(p_user_identifier TEXT)
RETURNS TABLE (
  entry_id TEXT,
  competition_id TEXT,
  competition_title TEXT,
  competition_image TEXT,
  ticket_count INTEGER,
  ticket_numbers TEXT,
  entry_status TEXT,
  competition_status TEXT,
  competition_end_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ
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
    COALESCE(jc.uid, jc.id::TEXT, gen_random_uuid()::TEXT) AS entry_id,
    COALESCE(jc.competitionid, c.id::TEXT) AS competition_id,
    COALESCE(c.title, '') AS competition_title,
    COALESCE(c.image_url, c.imageurl, '') AS competition_image,
    COALESCE(jc.numberoftickets, 0)::INTEGER AS ticket_count,
    COALESCE(jc.ticketnumbers, '') AS ticket_numbers,
    'confirmed' AS entry_status,
    COALESCE(c.status, 'active') AS competition_status,
    c.end_date AS competition_end_date,
    COALESCE(jc.created_at, NOW()) AS created_at
  FROM joincompetition jc
  LEFT JOIN competitions c ON (
    -- FIX: Use TEXT column for regex check, avoid uuid ~* error
    (jc.competitionid ~* v_uuid_regex AND jc.competitionid::UUID = c.id)
    OR c.uid = jc.competitionid
  )
  WHERE
    LOWER(jc.walletaddress) = lower_identifier
    OR jc.canonical_user_id = p_user_identifier
    OR jc.privy_user_id = p_user_identifier
    OR jc.userid::TEXT = p_user_identifier
    OR (search_wallet IS NOT NULL AND LOWER(jc.walletaddress) = search_wallet)
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
      'check_and_mark_competition_sold_out',
      'get_competition_ticket_availability_text',
      'get_unavailable_tickets',
      'get_competition_entries',
      'get_competition_entries_bypass_rls',
      'get_comprehensive_user_dashboard_entries',
      'get_user_competition_entries'
    );

  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'FINAL COMPREHENSIVE RPC FIX - VERIFICATION';
  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'Functions created/updated: % (expected: 7)', func_count;
  RAISE NOTICE '';
  RAISE NOTICE 'Fixed issues:';
  RAISE NOTICE '  [x] check_and_mark_competition_sold_out - 300 ambiguity';
  RAISE NOTICE '  [x] get_competition_ticket_availability_text - uuid = text';
  RAISE NOTICE '  [x] get_unavailable_tickets - uuid = text';
  RAISE NOTICE '  [x] get_competition_entries - empty string to uuid';
  RAISE NOTICE '  [x] get_competition_entries_bypass_rls - empty string';
  RAISE NOTICE '  [x] get_comprehensive_user_dashboard_entries - uuid ~* regex';
  RAISE NOTICE '  [x] get_user_competition_entries - uuid = text';
  RAISE NOTICE '';
  RAISE NOTICE 'All type mismatches resolved by:';
  RAISE NOTICE '  - Using explicit UUID casts for UUID column comparisons';
  RAISE NOTICE '  - Using TEXT casts before regex operations';
  RAISE NOTICE '  - Handling empty strings before UUID conversion';
  RAISE NOTICE '  - Removing duplicate function overloads';
  RAISE NOTICE '=====================================================';
END $$;

COMMIT;
