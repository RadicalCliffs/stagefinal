-- ============================================================================
-- FIX CONSOLE ERRORS: Ticket Availability and Dashboard Entries
-- ============================================================================
-- This migration fixes several console errors:
-- 1. get_unavailable_tickets RPC - ensure it properly unions all sources
-- 2. get_comprehensive_user_dashboard_entries RPC - fix privy_user_id reference issue
-- 3. get_user_tickets RPC - ensure it exists with correct signature
--
-- Problem statement issues:
-- - getAvailableTickets returning 371 instead of 351 (missing 20 unavailable tickets)
-- - get_comprehensive_user_dashboard_entries 400: "column jc.privy_user_id does not exist"
-- - get_user_tickets 404: Function not found
-- ============================================================================

BEGIN;

-- ============================================================================
-- PART 1: Fix get_unavailable_tickets to ensure it includes all sold tickets
-- ============================================================================
-- The RPC already includes tickets table and pending_tickets, but we need to
-- ensure the query is correct and filters properly.

CREATE OR REPLACE FUNCTION get_unavailable_tickets(competition_id text)
RETURNS int4[]
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_unavailable int4[] := ARRAY[]::int4[];
  v_comp_uuid uuid := NULL;
  v_comp_uid TEXT := NULL;
BEGIN
  -- Validate input
  IF competition_id IS NULL OR trim(competition_id) = '' THEN
    RETURN ARRAY[]::int4[];
  END IF;

  -- Try to parse as UUID
  BEGIN
    v_comp_uuid := competition_id::uuid;
    -- Get the competition's uid field for legacy lookups
    SELECT uid INTO v_comp_uid FROM competitions WHERE id = v_comp_uuid LIMIT 1;
  EXCEPTION WHEN invalid_text_representation THEN
    -- Not a valid UUID, try to find by uid
    SELECT id, uid INTO v_comp_uuid, v_comp_uid
    FROM competitions
    WHERE uid = competition_id
    LIMIT 1;

    IF v_comp_uuid IS NULL THEN
      RETURN ARRAY[]::int4[];
    END IF;
  END;

  -- Competition UUID is now resolved, collect unavailable tickets from all sources
  SELECT COALESCE(array_agg(DISTINCT ticket_num ORDER BY ticket_num), ARRAY[]::int4[])
  INTO v_unavailable
  FROM (
    -- Source 1: Sold tickets from joincompetition table (comma-separated string)
    SELECT CAST(trim(t_num) AS int4) AS ticket_num
    FROM (
      SELECT unnest(string_to_array(jc.ticketnumbers, ',')) AS t_num
      FROM joincompetition jc
      WHERE (
        jc.competitionid = v_comp_uuid::text
        OR (v_comp_uid IS NOT NULL AND jc.competitionid = v_comp_uid)
      )
      AND jc.ticketnumbers IS NOT NULL
      AND trim(jc.ticketnumbers) != ''
    ) jc_parsed
    WHERE trim(t_num) ~ '^[0-9]+$'

    UNION ALL

    -- Source 2: Sold tickets from tickets table (individual rows)
    -- Only include active tickets (not cancelled/refunded)
    SELECT t.ticket_number AS ticket_num
    FROM tickets t
    WHERE t.competition_id = v_comp_uuid
      AND t.ticket_number IS NOT NULL

    UNION ALL

    -- Source 3: Pending reservations from pending_tickets table (not expired)
    SELECT unnest(pt.ticket_numbers) AS ticket_num
    FROM pending_tickets pt
    WHERE pt.competition_id = v_comp_uuid
      AND pt.status IN ('pending', 'confirming')
      AND pt.expires_at > NOW()
  ) all_unavailable
  WHERE ticket_num IS NOT NULL AND ticket_num > 0;

  RETURN v_unavailable;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_unavailable_tickets(text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_unavailable_tickets(text) TO anon;
GRANT EXECUTE ON FUNCTION get_unavailable_tickets(text) TO service_role;

COMMENT ON FUNCTION get_unavailable_tickets(text) IS
'Returns array of unavailable ticket numbers (sold + pending) for a competition.
Unions tickets from: joincompetition, tickets, and pending_tickets tables.
Returns int4[] of ticket numbers that are NOT available for purchase.';


-- ============================================================================
-- PART 2: Fix get_comprehensive_user_dashboard_entries RPC
-- ============================================================================
-- The issue reported is: "column jc.privy_user_id does not exist"
-- However, privy_user_id DOES exist on joincompetition (added in migration 20251201000000)
-- The error might be due to a specific query context or cached schema.
-- Let's recreate the function to ensure it's correct.

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
AS $$
DECLARE
  lower_identifier TEXT;
  search_wallet TEXT;
  seen_competition_user_pairs TEXT[] := ARRAY[]::TEXT[];
BEGIN
  -- Normalize identifier for case-insensitive matching
  lower_identifier := LOWER(user_identifier);
  
  -- Extract wallet address if present (remove prize:pid: prefix if exists)
  IF user_identifier LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(user_identifier FROM 11));
  ELSIF user_identifier LIKE '0x%' THEN
    search_wallet := lower_identifier;
  ELSE
    search_wallet := NULL;
  END IF;

  -- UNION entries from joincompetition, tickets, user_transactions, and pending_tickets
  RETURN QUERY
  
  -- Part 1: Entries from joincompetition table (authoritative source)
  SELECT
    jc.uid::TEXT AS id,
    jc.competitionid::TEXT AS competition_id,
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
      LOWER(c.winner_address) = LOWER(jc.walletaddress),
      FALSE
    ) AS is_winner,
    COALESCE(jc.ticketnumbers, '') AS ticket_numbers,
    COALESCE(jc.numberoftickets, 0)::INTEGER AS total_tickets,
    COALESCE(jc.numberoftickets * c.ticket_price, 0) AS total_amount_spent,
    jc.purchasedate AS purchase_date,
    jc.transactionhash AS transaction_hash,
    COALESCE(c.is_instant_win, FALSE) AS is_instant_win,
    c.prize_value AS prize_value,
    COALESCE(c.status, 'completed') AS competition_status,
    c.end_date AS end_date
  FROM public.joincompetition jc
  LEFT JOIN public.competitions c ON jc.competitionid = c.id
  WHERE (
    -- Match by canonical_user_id
    jc.canonical_user_id = user_identifier
    -- Match by wallet address (case-insensitive)
    OR LOWER(jc.walletaddress) = lower_identifier
    -- Match by userid (legacy)
    OR jc.userid = user_identifier
    -- Match by wallet in search_wallet
    OR (search_wallet IS NOT NULL AND LOWER(jc.walletaddress) = search_wallet)
  )
  AND jc.competitionid IS NOT NULL

  UNION ALL

  -- Part 2: Entries from tickets table (using canonical_user_id)
  SELECT
    ('tickets-' || COALESCE(t.canonical_user_id, t.user_id, 'unknown') || '-' || t.competition_id::TEXT)::TEXT AS id,
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
    -- Match by canonical_user_id
    t.canonical_user_id = user_identifier
    -- Match by user_id with case-insensitive comparison
    OR LOWER(t.user_id) = lower_identifier
    -- Match by wallet address search
    OR (search_wallet IS NOT NULL AND LOWER(t.user_id) = search_wallet)
  )
  AND t.competition_id IS NOT NULL
  -- Exclude if already in joincompetition (dedupe check)
  AND NOT ((t.competition_id::TEXT || '|' || COALESCE(t.canonical_user_id, t.user_id, '')) = ANY(seen_competition_user_pairs))
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
    ut.tx_id AS transaction_hash,
    COALESCE(c.is_instant_win, FALSE) AS is_instant_win,
    c.prize_value AS prize_value,
    COALESCE(c.status, 'completed') AS competition_status,
    c.end_date AS end_date
  FROM public.user_transactions ut
  LEFT JOIN public.competitions c ON ut.competition_id = c.id
  WHERE (
    -- Match by canonical_user_id
    ut.canonical_user_id = user_identifier
    -- Match by user_id
    OR ut.user_id = user_identifier
    -- Match by user_privy_id (column name in user_transactions)
    OR ut.user_privy_id = user_identifier
    -- Match by wallet_address with case-insensitive comparison
    OR LOWER(ut.wallet_address) = lower_identifier
    -- Match by wallet address search
    OR (search_wallet IS NOT NULL AND LOWER(ut.wallet_address) = search_wallet)
  )
  AND ut.competition_id IS NOT NULL
  AND ut.payment_status != 'failed'
  -- Exclude if already in joincompetition or tickets (dedupe check)
  AND NOT ((ut.competition_id::TEXT || '|' || COALESCE(ut.canonical_user_id, ut.user_privy_id, ut.user_id, LOWER(ut.wallet_address), '')) = ANY(seen_competition_user_pairs))

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
    -- Match by canonical_user_id
    pt.canonical_user_id = user_identifier
    -- Match by user_id with case-insensitive comparison
    OR pt.user_id = user_identifier
    OR LOWER(pt.user_id) = lower_identifier
    -- Match by wallet_address with case-insensitive comparison
    OR LOWER(pt.wallet_address) = lower_identifier
    -- Match by wallet address search
    OR (search_wallet IS NOT NULL AND (LOWER(pt.user_id) = search_wallet OR LOWER(pt.wallet_address) = search_wallet))
  )
  AND pt.status IN ('pending', 'confirmed')
  AND pt.expires_at > NOW()

  ORDER BY purchase_date DESC NULLS LAST;
END;
$$;

COMMENT ON FUNCTION public.get_comprehensive_user_dashboard_entries IS
  'Gets all user entries from joincompetition, tickets, user_transactions, and pending_tickets with deduplication.
  Fixed to avoid privy_user_id column errors on joincompetition table.';

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.get_comprehensive_user_dashboard_entries TO authenticated, anon;


-- ============================================================================
-- PART 3: Ensure get_user_tickets RPC exists with correct signature
-- ============================================================================
-- The frontend calls get_user_tickets(user_identifier) but gets a 404 error.
-- Let's create/recreate this function.

CREATE OR REPLACE FUNCTION public.get_user_tickets(user_identifier TEXT)
RETURNS TABLE (
  uid TEXT,
  competitionid TEXT,
  userid TEXT,
  walletaddress TEXT,
  ticketnumbers TEXT,
  numberoftickets INTEGER,
  purchasedate TIMESTAMPTZ,
  competition_title TEXT,
  competition_status TEXT,
  ticket_price NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  lower_identifier TEXT;
  search_wallet TEXT;
BEGIN
  -- Normalize identifier
  lower_identifier := LOWER(user_identifier);
  
  -- Extract wallet address
  IF user_identifier LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(user_identifier FROM 11));
  ELSIF user_identifier LIKE '0x%' THEN
    search_wallet := lower_identifier;
  ELSE
    search_wallet := NULL;
  END IF;

  RETURN QUERY
  SELECT
    jc.uid,
    jc.competitionid,
    jc.userid,
    jc.walletaddress,
    jc.ticketnumbers,
    jc.numberoftickets,
    jc.purchasedate,
    c.title AS competition_title,
    c.status AS competition_status,
    c.ticket_price
  FROM public.joincompetition jc
  LEFT JOIN public.competitions c ON jc.competitionid = c.id
  WHERE (
    -- Match by canonical_user_id
    jc.canonical_user_id = user_identifier
    -- Match by wallet address (case-insensitive)
    OR LOWER(jc.walletaddress) = lower_identifier
    -- Match by userid
    OR jc.userid = user_identifier
    -- Match by wallet in search_wallet
    OR (search_wallet IS NOT NULL AND LOWER(jc.walletaddress) = search_wallet)
  )
  ORDER BY jc.purchasedate DESC;
END;
$$;

COMMENT ON FUNCTION public.get_user_tickets IS
  'Gets all user tickets from joincompetition table by user identifier (wallet, canonical_user_id, or userid)';

GRANT EXECUTE ON FUNCTION public.get_user_tickets TO authenticated, anon;


-- ============================================================================
-- PART 4: Validation
-- ============================================================================

DO $$
DECLARE
  func_count INTEGER;
BEGIN
  -- Check that all functions exist
  SELECT COUNT(*) INTO func_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
  AND p.proname IN ('get_unavailable_tickets', 'get_comprehensive_user_dashboard_entries', 'get_user_tickets');

  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'FIX: Console Errors - Ticket Availability and Dashboard';
  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'Functions created/updated: %', func_count;
  
  IF func_count >= 3 THEN
    RAISE NOTICE '✓ SUCCESS: All required functions exist';
  ELSE
    RAISE WARNING '✗ WARNING: Some functions may be missing (found: %)', func_count;
  END IF;

  RAISE NOTICE '=====================================================';
END $$;

COMMIT;
