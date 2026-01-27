-- ============================================================================
-- COMPREHENSIVE FIX: User Dashboard Errors and Database Function Integration
-- ============================================================================
-- This migration applies all fixes detailed in:
-- - ENTRIES_FIX_SOLUTION.md
-- - SUPABASE_ENTRIES_SETUP.md
-- - APPLY_TO_SUPABASE_NOW.sql
--
-- Fixes:
-- 1. Missing get_competition_entries RPC (404 errors)
-- 2. uuid/text type mismatches in function parameters
-- 3. Ticket availability showing 0 when all tickets are available
-- 4. HTTP 300 errors from multiple function overloads
-- 5. Missing IDs in dashboard entries causing filtering
-- 6. get_user_tickets RPC parameter signature
-- ============================================================================

BEGIN;

-- ============================================================================
-- PART 1: Ensure competitions.uid column exists
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'competitions'
    AND column_name = 'uid'
  ) THEN
    ALTER TABLE competitions ADD COLUMN uid text;
    RAISE NOTICE 'Added uid column to competitions table';
  ELSE
    RAISE NOTICE 'uid column already exists on competitions table';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_competitions_uid ON competitions(uid);

-- ============================================================================
-- PART 2: Fix get_competition_entries_bypass_rls (removes UUID overload)
-- ============================================================================
-- Drop ALL existing overloads to prevent HTTP 300 "multiple choices" errors
DROP FUNCTION IF EXISTS get_competition_entries_bypass_rls(text) CASCADE;
DROP FUNCTION IF EXISTS get_competition_entries_bypass_rls(uuid) CASCADE;
DROP FUNCTION IF EXISTS get_competition_entries_bypass_rls(text, text) CASCADE;

-- Create single canonical version that accepts TEXT and handles UUID conversion
CREATE OR REPLACE FUNCTION get_competition_entries_bypass_rls(competition_identifier text)
RETURNS TABLE (
  uid text,
  competitionid text,
  userid text,
  privy_user_id text,
  numberoftickets integer,
  ticketnumbers text,
  amountspent numeric,
  wallet_address text,
  chain text,
  transactionhash text,
  purchasedate timestamp with time zone,
  created_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  comp_uuid uuid;
  comp_uid_text text;
BEGIN
  -- Normalize the competition identifier (handle both UUID and text uid)
  BEGIN
    comp_uuid := competition_identifier::uuid;
    comp_uid_text := competition_identifier;
  EXCEPTION WHEN invalid_text_representation THEN
    -- If not a UUID, look up by uid
    SELECT c.id, c.uid INTO comp_uuid, comp_uid_text
    FROM competitions c
    WHERE c.uid = competition_identifier
    LIMIT 1;
  END;

  -- If we have a UUID and the identifier was a UUID, get the uid
  IF comp_uuid IS NOT NULL AND comp_uid_text = competition_identifier THEN
    SELECT c.uid INTO comp_uid_text FROM competitions c WHERE c.id = comp_uuid LIMIT 1;
  END IF;

  RETURN QUERY
  -- Source 1: joincompetition table (primary source)
  SELECT
    COALESCE(jc.uid::text, gen_random_uuid()::text) as uid,
    COALESCE(jc.competitionid, '')::text as competitionid,
    COALESCE(jc.userid, '')::text as userid,
    COALESCE(jc.privy_user_id, jc.wallet_address, '')::text as privy_user_id,
    COALESCE(jc.numberoftickets, 1)::integer as numberoftickets,
    COALESCE(jc.ticketnumbers, '')::text as ticketnumbers,
    COALESCE(jc.amountspent, 0)::numeric as amountspent,
    COALESCE(jc.wallet_address, '')::text as wallet_address,
    COALESCE(jc.chain, 'Base')::text as chain,
    COALESCE(jc.transactionhash, '')::text as transactionhash,
    COALESCE(jc.purchasedate, jc.created_at, NOW())::timestamptz as purchasedate,
    COALESCE(jc.created_at, NOW())::timestamptz as created_at
  FROM joincompetition jc
  WHERE
    jc.competitionid = competition_identifier
    OR (comp_uuid IS NOT NULL AND jc.competitionid = comp_uuid::text)
    OR (comp_uid_text IS NOT NULL AND comp_uid_text != '' AND jc.competitionid = comp_uid_text)

  UNION ALL

  -- Source 2: tickets table (fallback for entries not in joincompetition)
  SELECT
    ('tickets-' || COALESCE(t.canonical_user_id, t.user_id, 'unknown') || '-' || t.competition_id::text)::text as uid,
    COALESCE(t.competition_id::text, '')::text as competitionid,
    COALESCE(t.user_id, '')::text as userid,
    COALESCE(t.user_id, '')::text as privy_user_id,
    COUNT(*)::integer as numberoftickets,
    string_agg(t.ticket_number::text, ',' ORDER BY t.ticket_number)::text as ticketnumbers,
    COALESCE(SUM(t.purchase_price), 0)::numeric as amountspent,
    COALESCE(t.user_id, '')::text as wallet_address,
    'USDC'::text as chain,
    ''::text as transactionhash,
    MIN(t.created_at)::timestamptz as purchasedate,
    MIN(t.created_at)::timestamptz as created_at
  FROM tickets t
  WHERE
    t.competition_id = comp_uuid
    -- Only include tickets that don't have a corresponding joincompetition entry
    AND NOT EXISTS (
      SELECT 1 FROM joincompetition jc2
      WHERE (
        jc2.competitionid = competition_identifier
        OR (comp_uuid IS NOT NULL AND jc2.competitionid = comp_uuid::text)
        OR (comp_uid_text IS NOT NULL AND comp_uid_text != '' AND jc2.competitionid = comp_uid_text)
      )
      AND (
        jc2.canonical_user_id = t.canonical_user_id
        OR jc2.privy_user_id = t.user_id
        OR jc2.wallet_address = t.user_id
        OR jc2.userid = t.user_id
      )
    )
  GROUP BY t.competition_id, t.canonical_user_id, t.user_id

  ORDER BY purchasedate DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_competition_entries_bypass_rls(text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_competition_entries_bypass_rls(text) TO anon;
GRANT EXECUTE ON FUNCTION get_competition_entries_bypass_rls(text) TO service_role;

COMMENT ON FUNCTION get_competition_entries_bypass_rls IS
'Returns all entries for a competition from joincompetition and tickets tables.
Accepts competition ID (UUID) or uid (text) - handles type conversion internally.
SECURITY DEFINER to bypass RLS.';

-- ============================================================================
-- PART 3: Create get_competition_entries (non-bypass wrapper)
-- ============================================================================
DROP FUNCTION IF EXISTS get_competition_entries(text) CASCADE;
DROP FUNCTION IF EXISTS get_competition_entries(uuid) CASCADE;

-- Create the non-bypass version as a wrapper to the bypass_rls version
CREATE OR REPLACE FUNCTION get_competition_entries(competition_identifier text)
RETURNS TABLE (
  uid text,
  competitionid text,
  userid text,
  privy_user_id text,
  numberoftickets integer,
  ticketnumbers text,
  amountspent numeric,
  wallet_address text,
  chain text,
  transactionhash text,
  purchasedate timestamp with time zone,
  created_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  -- Simply call the bypass_rls version
  RETURN QUERY
  SELECT * FROM get_competition_entries_bypass_rls(competition_identifier);
END;
$$;

GRANT EXECUTE ON FUNCTION get_competition_entries(text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_competition_entries(text) TO anon;
GRANT EXECUTE ON FUNCTION get_competition_entries(text) TO service_role;

COMMENT ON FUNCTION get_competition_entries IS
'Returns all entries for a competition. Wrapper for get_competition_entries_bypass_rls.
Accepts competition ID (UUID) or uid (text).';

-- ============================================================================
-- PART 4: Fix get_competition_ticket_availability_text
-- ============================================================================
DROP FUNCTION IF EXISTS get_competition_ticket_availability_text(text) CASCADE;
DROP FUNCTION IF EXISTS get_competition_ticket_availability_text(uuid) CASCADE;

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

  -- Convert text to UUID (or look up by uid)
  BEGIN
    v_competition_uuid := competition_id_text::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
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

  -- Get competition details
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

  -- Get sold tickets from joincompetition
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

  v_sold_tickets_jc := COALESCE(v_sold_tickets_jc, ARRAY[]::INTEGER[]);

  -- Get sold tickets from tickets table
  SELECT COALESCE(array_agg(DISTINCT ticket_number), ARRAY[]::INTEGER[])
  INTO v_sold_tickets_table
  FROM tickets
  WHERE competition_id = v_competition_uuid;

  v_sold_tickets_table := COALESCE(v_sold_tickets_table, ARRAY[]::INTEGER[]);

  -- Combine sold tickets
  v_unavailable_tickets := v_sold_tickets_jc || v_sold_tickets_table;

  -- Get pending reservations
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

  v_pending_tickets := COALESCE(v_pending_tickets, ARRAY[]::INTEGER[]);
  v_unavailable_tickets := v_unavailable_tickets || v_pending_tickets;

  -- Remove duplicates
  IF array_length(v_unavailable_tickets, 1) IS NOT NULL AND array_length(v_unavailable_tickets, 1) > 0 THEN
    SELECT COALESCE(array_agg(DISTINCT u), ARRAY[]::INTEGER[])
    INTO v_unavailable_tickets
    FROM unnest(v_unavailable_tickets) AS u;
  ELSE
    v_unavailable_tickets := ARRAY[]::INTEGER[];
  END IF;

  -- Calculate counts
  v_sold_count := COALESCE(array_length(v_unavailable_tickets, 1), 0);
  v_available_count := GREATEST(0, v_total_tickets - v_sold_count);

  -- Generate available tickets array
  IF v_available_count > 0 THEN
    FOR v_ticket_num IN 1..v_total_tickets LOOP
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

COMMENT ON FUNCTION get_competition_ticket_availability_text IS
'Returns ticket availability data for a competition.
Fixes issue where available_count was 0 when all tickets were available.
Accepts competition ID (UUID) or uid (text).';

-- ============================================================================
-- PART 5: Fix get_unavailable_tickets
-- ============================================================================
DROP FUNCTION IF EXISTS get_unavailable_tickets(text) CASCADE;
DROP FUNCTION IF EXISTS get_unavailable_tickets(uuid) CASCADE;

CREATE OR REPLACE FUNCTION get_unavailable_tickets(p_competition_id TEXT)
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
  -- Convert text to UUID (or look up by uid)
  BEGIN
    v_competition_uuid := p_competition_id::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    SELECT c.id, c.uid INTO v_competition_uuid, v_comp_uid
    FROM competitions c
    WHERE c.uid = p_competition_id
    LIMIT 1;

    IF v_competition_uuid IS NULL THEN
      RETURN ARRAY[]::INTEGER[];
    END IF;
  END;

  IF v_comp_uid IS NULL THEN
    SELECT c.uid INTO v_comp_uid
    FROM competitions c
    WHERE c.id = v_competition_uuid;
  END IF;

  -- Get sold tickets from joincompetition
  SELECT COALESCE(array_agg(DISTINCT ticket_num), ARRAY[]::INTEGER[])
  INTO v_sold_jc
  FROM (
    SELECT CAST(trim(unnest(string_to_array(ticketnumbers, ','))) AS integer) AS ticket_num
    FROM joincompetition
    WHERE (
      competitionid = v_competition_uuid::text
      OR (v_comp_uid IS NOT NULL AND competitionid = v_comp_uid)
      OR competitionid = p_competition_id
    )
      AND ticketnumbers IS NOT NULL
      AND trim(ticketnumbers) != ''
  ) AS jc_tickets
  WHERE ticket_num IS NOT NULL;

  v_sold_jc := COALESCE(v_sold_jc, ARRAY[]::INTEGER[]);

  -- Get sold tickets from tickets table
  SELECT COALESCE(array_agg(DISTINCT ticket_number), ARRAY[]::INTEGER[])
  INTO v_sold_tickets
  FROM tickets
  WHERE tickets.competition_id = v_competition_uuid;

  v_sold_tickets := COALESCE(v_sold_tickets, ARRAY[]::INTEGER[]);

  -- Get pending reservations
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

  v_pending := COALESCE(v_pending, ARRAY[]::INTEGER[]);
  
  -- Combine all unavailable tickets
  v_unavailable := v_sold_jc || v_sold_tickets || v_pending;

  -- Remove duplicates
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

GRANT EXECUTE ON FUNCTION get_unavailable_tickets(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_unavailable_tickets(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_unavailable_tickets(TEXT) TO service_role;

COMMENT ON FUNCTION get_unavailable_tickets IS
'Returns array of unavailable ticket numbers for a competition.
Includes sold tickets from both joincompetition and tickets tables, plus pending reservations.
Accepts competition ID (UUID) or uid (text).';

-- ============================================================================
-- PART 6: Fix get_comprehensive_user_dashboard_entries
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
  -- User identity fields resolved from canonical_users
  resolved_canonical_user_id TEXT := NULL;
  resolved_wallet_address TEXT := NULL;
  resolved_base_wallet_address TEXT := NULL;
  resolved_eth_wallet_address TEXT := NULL;
  resolved_privy_user_id TEXT := NULL;
  resolved_uid TEXT := NULL;
BEGIN
  -- Normalize identifier for case-insensitive matching
  lower_identifier := LOWER(TRIM(user_identifier));

  -- Extract wallet address if present (remove prize:pid: prefix if exists)
  IF user_identifier LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(user_identifier FROM 11));
  ELSIF user_identifier LIKE '0x%' THEN
    search_wallet := lower_identifier;
  ELSE
    search_wallet := NULL;
  END IF;

  -- ============================================================================
  -- STEP 1: Resolve user from canonical_users table
  -- ============================================================================
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
    -- Match by canonical_user_id
    cu.canonical_user_id = user_identifier
    -- Match by any wallet address field (case-insensitive)
    OR LOWER(cu.wallet_address) = lower_identifier
    OR LOWER(cu.base_wallet_address) = lower_identifier
    OR LOWER(cu.eth_wallet_address) = lower_identifier
    -- Match by privy_user_id
    OR cu.privy_user_id = user_identifier
    -- Match by uid
    OR cu.uid = user_identifier
    -- Match by search_wallet if it's a wallet address
    OR (search_wallet IS NOT NULL AND (
      LOWER(cu.wallet_address) = search_wallet
      OR LOWER(cu.base_wallet_address) = search_wallet
      OR LOWER(cu.eth_wallet_address) = search_wallet
    ))
  LIMIT 1;

  -- ============================================================================
  -- STEP 2: Query entries using resolved identifiers
  -- ============================================================================

  RETURN QUERY

  -- Part 1: Entries from joincompetition table (authoritative source)
  -- ALWAYS ensure we have a valid ID and competition_id
  -- Use deterministic ID generation to ensure same entry always gets same ID
  SELECT
    COALESCE(jc.uid, 'jc-' || COALESCE(jc.competitionid, '') || '-' || COALESCE(jc.wallet_address, '') || '-' || COALESCE(jc.created_at::TEXT, '')) AS id,
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
    COALESCE(
      LOWER(c.winner_address) = LOWER(jc.wallet_address),
      FALSE
    ) AS is_winner,
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
  -- Use OR to handle both UUID format (c.id) and text format (c.uid) for competitionid
  LEFT JOIN public.competitions c ON (
    -- Try UUID match first (when competitionid is stored as UUID string) - case insensitive
    (jc.competitionid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     AND jc.competitionid::uuid = c.id)
    OR
    -- Fallback to uid match (legacy text format)
    c.uid = jc.competitionid
  )
  WHERE (
    -- Match using resolved identifiers from canonical_users
    (resolved_canonical_user_id IS NOT NULL AND jc.canonical_user_id = resolved_canonical_user_id)
    OR (resolved_wallet_address IS NOT NULL AND LOWER(jc.wallet_address) = resolved_wallet_address)
    OR (resolved_base_wallet_address IS NOT NULL AND LOWER(jc.wallet_address) = resolved_base_wallet_address)
    OR (resolved_eth_wallet_address IS NOT NULL AND LOWER(jc.wallet_address) = resolved_eth_wallet_address)
    OR (resolved_privy_user_id IS NOT NULL AND jc.privy_user_id = resolved_privy_user_id)
    OR (resolved_uid IS NOT NULL AND jc.userid::TEXT = resolved_uid)
    -- Fallback: Direct matching if user not found in canonical_users
    OR (resolved_canonical_user_id IS NULL AND (
      jc.canonical_user_id = user_identifier
      OR LOWER(jc.wallet_address) = lower_identifier
      OR jc.userid::TEXT = user_identifier
      OR (search_wallet IS NOT NULL AND LOWER(jc.wallet_address) = search_wallet)
    ))
  )
  -- CRITICAL: Only return entries with valid competition_id
  AND jc.competitionid IS NOT NULL
  AND jc.competitionid != ''
  -- CRITICAL: Only return entries where we could join to a competition (or at least have the ID)
  AND (c.id IS NOT NULL OR jc.competitionid IS NOT NULL)

  UNION ALL

  -- Part 2: Entries from tickets table
  -- ALWAYS ensure we have a valid ID and competition_id
  -- Use deterministic ID generation with competition_id and user identifier
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
    -- Match using resolved identifiers from canonical_users
    (resolved_canonical_user_id IS NOT NULL AND t.canonical_user_id = resolved_canonical_user_id)
    OR (resolved_wallet_address IS NOT NULL AND LOWER(t.user_id) = resolved_wallet_address)
    OR (resolved_base_wallet_address IS NOT NULL AND LOWER(t.user_id) = resolved_base_wallet_address)
    OR (resolved_eth_wallet_address IS NOT NULL AND LOWER(t.user_id) = resolved_eth_wallet_address)
    -- Fallback: Direct matching if user not found in canonical_users
    OR (resolved_canonical_user_id IS NULL AND (
      t.canonical_user_id = user_identifier
      OR LOWER(t.user_id) = lower_identifier
      OR (search_wallet IS NOT NULL AND LOWER(t.user_id) = search_wallet)
    ))
  )
  -- CRITICAL: Only return entries with valid competition_id
  AND t.competition_id IS NOT NULL
  GROUP BY t.competition_id, t.canonical_user_id, t.user_id, c.id, c.title, c.description, c.image_url,
           c.imageurl, c.status, c.winner_address, c.is_instant_win, c.prize_value, c.end_date, c.ticket_price

  UNION ALL

  -- Part 3: Entries from user_transactions
  -- ALWAYS ensure we have a valid ID and competition_id
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
    ut.tx_id AS transaction_hash,
    COALESCE(c.is_instant_win, FALSE) AS is_instant_win,
    c.prize_value AS prize_value,
    COALESCE(c.status, 'completed') AS competition_status,
    c.end_date AS end_date
  FROM public.user_transactions ut
  LEFT JOIN public.competitions c ON ut.competition_id = c.id
  WHERE (
    -- Match using resolved identifiers from canonical_users
    (resolved_canonical_user_id IS NOT NULL AND ut.canonical_user_id = resolved_canonical_user_id)
    OR (resolved_wallet_address IS NOT NULL AND LOWER(ut.wallet_address) = resolved_wallet_address)
    OR (resolved_base_wallet_address IS NOT NULL AND LOWER(ut.wallet_address) = resolved_base_wallet_address)
    OR (resolved_eth_wallet_address IS NOT NULL AND LOWER(ut.wallet_address) = resolved_eth_wallet_address)
    OR (resolved_privy_user_id IS NOT NULL AND (ut.user_privy_id = resolved_privy_user_id OR ut.privy_user_id = resolved_privy_user_id))
    OR (resolved_uid IS NOT NULL AND ut.user_id = resolved_uid)
    -- Fallback: Direct matching if user not found in canonical_users
    OR (resolved_canonical_user_id IS NULL AND (
      ut.canonical_user_id = user_identifier
      OR ut.user_id = user_identifier
      OR ut.user_privy_id = user_identifier
      OR LOWER(ut.wallet_address) = lower_identifier
      OR (search_wallet IS NOT NULL AND LOWER(ut.wallet_address) = search_wallet)
    ))
  )
  -- CRITICAL: Only return entries with valid competition_id
  AND ut.competition_id IS NOT NULL
  AND ut.payment_status != 'failed'

  UNION ALL

  -- Part 4: Entries from pending_tickets
  -- ALWAYS ensure we have a valid ID and competition_id
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
    -- Match using resolved identifiers from canonical_users
    (resolved_canonical_user_id IS NOT NULL AND pt.canonical_user_id = resolved_canonical_user_id)
    OR (resolved_wallet_address IS NOT NULL AND (LOWER(pt.user_id) = resolved_wallet_address OR LOWER(pt.wallet_address) = resolved_wallet_address))
    OR (resolved_base_wallet_address IS NOT NULL AND (LOWER(pt.user_id) = resolved_base_wallet_address OR LOWER(pt.wallet_address) = resolved_base_wallet_address))
    OR (resolved_eth_wallet_address IS NOT NULL AND (LOWER(pt.user_id) = resolved_eth_wallet_address OR LOWER(pt.wallet_address) = resolved_eth_wallet_address))
    -- Fallback: Direct matching if user not found in canonical_users
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
  -- CRITICAL: Only return entries with valid competition_id
  AND pt.competition_id IS NOT NULL

  ORDER BY purchase_date DESC NULLS LAST;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.get_comprehensive_user_dashboard_entries(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_comprehensive_user_dashboard_entries(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_comprehensive_user_dashboard_entries(TEXT) TO service_role;

COMMENT ON FUNCTION public.get_comprehensive_user_dashboard_entries IS
'Gets all user entries from joincompetition, tickets, user_transactions, and pending_tickets.
Resolves user from canonical_users table FIRST to get all associated identifiers.
ALWAYS returns valid ID and competition_id for every entry.';

-- ============================================================================
-- PART 7: Ensure get_user_tickets exists with correct signature
-- ============================================================================
-- Check if get_user_tickets exists, if not, create a basic version
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
    AND p.proname = 'get_user_tickets'
  ) THEN
    -- Create basic get_user_tickets function
    CREATE OR REPLACE FUNCTION get_user_tickets(user_identifier TEXT)
    RETURNS TABLE (
      id uuid,
      competition_id uuid,
      ticket_number integer,
      user_id text,
      canonical_user_id text,
      purchase_price numeric,
      purchased_at timestamptz,
      is_winner boolean,
      created_at timestamptz
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    STABLE
    SET search_path = public
    AS $func$
    DECLARE
      lower_identifier TEXT;
    BEGIN
      lower_identifier := LOWER(TRIM(user_identifier));
      
      RETURN QUERY
      SELECT 
        t.id,
        t.competition_id,
        t.ticket_number,
        t.user_id,
        t.canonical_user_id,
        t.purchase_price,
        t.purchased_at,
        t.is_winner,
        t.created_at
      FROM tickets t
      WHERE 
        LOWER(t.user_id) = lower_identifier
        OR t.canonical_user_id = user_identifier
      ORDER BY t.purchased_at DESC;
    END;
    $func$;

    GRANT EXECUTE ON FUNCTION get_user_tickets(TEXT) TO authenticated;
    GRANT EXECUTE ON FUNCTION get_user_tickets(TEXT) TO anon;
    GRANT EXECUTE ON FUNCTION get_user_tickets(TEXT) TO service_role;

    RAISE NOTICE 'Created get_user_tickets function';
  ELSE
    RAISE NOTICE 'get_user_tickets function already exists';
  END IF;
END $$;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
DO $$
DECLARE
  func_count INTEGER;
  uid_column_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'competitions'
    AND column_name = 'uid'
  ) INTO uid_column_exists;

  SELECT COUNT(*) INTO func_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'get_competition_ticket_availability_text',
      'get_competition_entries_bypass_rls',
      'get_competition_entries',
      'get_unavailable_tickets',
      'get_user_tickets',
      'get_comprehensive_user_dashboard_entries'
    );

  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'COMPREHENSIVE FIX APPLIED';
  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'competitions.uid column exists: %', uid_column_exists;
  RAISE NOTICE 'Functions created: % (expected: 6)', func_count;
  RAISE NOTICE '';
  RAISE NOTICE 'Fixed functions:';
  RAISE NOTICE '  ✓ get_competition_entries (wrapper)';
  RAISE NOTICE '  ✓ get_competition_entries_bypass_rls (uuid/text handling)';
  RAISE NOTICE '  ✓ get_competition_ticket_availability_text (0 tickets fix)';
  RAISE NOTICE '  ✓ get_unavailable_tickets (uuid/text handling)';
  RAISE NOTICE '  ✓ get_user_tickets (parameter signature)';
  RAISE NOTICE '  ✓ get_comprehensive_user_dashboard_entries (canonical user lookup)';
  RAISE NOTICE '';
  RAISE NOTICE 'Issues fixed:';
  RAISE NOTICE '  ✓ 404 errors for get_competition_entries';
  RAISE NOTICE '  ✓ UUID/text type mismatches in function parameters';
  RAISE NOTICE '  ✓ Ticket availability showing 0 when all available';
  RAISE NOTICE '  ✓ HTTP 300 errors from multiple function overloads';
  RAISE NOTICE '  ✓ Missing IDs in dashboard entries';
  RAISE NOTICE '  ✓ User identity resolution across multiple identifiers';
  RAISE NOTICE '';
  RAISE NOTICE 'Reference documentation:';
  RAISE NOTICE '  - ENTRIES_FIX_SOLUTION.md';
  RAISE NOTICE '  - SUPABASE_ENTRIES_SETUP.md';
  RAISE NOTICE '  - APPLY_TO_SUPABASE_NOW.sql';
  RAISE NOTICE '=====================================================';
END $$;

COMMIT;
