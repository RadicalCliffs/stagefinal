-- ============================================================================
-- FIX: Missing RPC Functions and UUID/TEXT Type Mismatch Errors
-- ============================================================================
-- Date: 2026-01-21
--
-- This migration fixes three critical issues from console errors:
--
-- 1. get_comprehensive_user_dashboard_entries - Error: "operator does not exist: uuid ~ unknown"
--    CAUSE: Using regex operator (~*) on jc.competitionid which may be UUID type
--    FIX: Cast to TEXT before using regex operators
--
-- 2. get_unavailable_tickets - 404 Not Found
--    CAUSE: Function doesn't exist in database
--    FIX: Create the function
--
-- 3. upsert_canonical_user - 404 Not Found
--    CAUSE: Function doesn't exist in database
--    FIX: Create the function
--
-- ============================================================================

BEGIN;

-- ============================================================================
-- PART 1: Fix get_comprehensive_user_dashboard_entries
-- The key fix is casting jc.competitionid::TEXT before using regex
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

  -- ============================================================================
  -- STEP 2: Query entries using resolved identifiers
  -- ============================================================================

  RETURN QUERY

  -- Part 1: Entries from joincompetition table (authoritative source)
  SELECT
    COALESCE(jc.uid, 'jc-' || COALESCE(jc.competitionid::TEXT, '') || '-' || COALESCE(jc.wallet_address, '') || '-' || COALESCE(jc.created_at::TEXT, '')) AS id,
    COALESCE(jc.competitionid::TEXT, c.id::TEXT, c.uid) AS competition_id,
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
  -- FIX: Cast competitionid to TEXT before using regex to avoid "uuid ~ unknown" error
  LEFT JOIN public.competitions c ON (
    -- Try UUID match first (when competitionid is stored as UUID string)
    -- CRITICAL FIX: Cast to TEXT first before regex
    (jc.competitionid::TEXT ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     AND jc.competitionid::uuid = c.id)
    OR
    -- Fallback to uid match (legacy text format)
    c.uid = jc.competitionid::TEXT
    OR
    -- Direct text equality
    jc.competitionid::TEXT = c.id::TEXT
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
  AND jc.competitionid IS NOT NULL
  AND jc.competitionid::TEXT != ''

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
    ut.tx_id AS transaction_hash,
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

COMMENT ON FUNCTION public.get_comprehensive_user_dashboard_entries IS
'Returns all user entries across joincompetition, tickets, user_transactions, and pending_tickets.
Fixed: Cast competitionid to TEXT before regex to avoid "uuid ~ unknown" error.';

-- ============================================================================
-- PART 2: Create/Replace get_unavailable_tickets function
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

  -- Collect all unavailable tickets from multiple sources
  SELECT COALESCE(array_agg(DISTINCT ticket_num ORDER BY ticket_num), ARRAY[]::INTEGER[])
  INTO v_unavailable
  FROM (
    -- From joincompetition (parse comma-separated ticket numbers)
    SELECT CAST(trim(t_num) AS integer) AS ticket_num
    FROM (
      SELECT unnest(string_to_array(ticketnumbers, ',')) AS t_num
      FROM joincompetition
      WHERE (
        competitionid::TEXT = v_competition_uuid::text
        OR (v_comp_uid IS NOT NULL AND competitionid::TEXT = v_comp_uid)
        OR competitionid::TEXT = p_competition_id
      )
      AND ticketnumbers IS NOT NULL
      AND trim(ticketnumbers) != ''
    ) jc_parsed
    WHERE trim(t_num) ~ '^[0-9]+$'

    UNION ALL

    -- From tickets table
    SELECT ticket_number AS ticket_num
    FROM tickets
    WHERE competition_id = v_competition_uuid
      AND ticket_number IS NOT NULL

    UNION ALL

    -- From pending_tickets (active reservations)
    SELECT unnest(ticket_numbers) AS ticket_num
    FROM pending_tickets
    WHERE competition_id = v_competition_uuid
      AND status IN ('pending', 'confirming')
      AND expires_at > NOW()
  ) all_unavailable
  WHERE ticket_num IS NOT NULL AND ticket_num > 0;

  RETURN COALESCE(v_unavailable, ARRAY[]::INTEGER[]);
END;
$$;

GRANT EXECUTE ON FUNCTION get_unavailable_tickets(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_unavailable_tickets(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_unavailable_tickets(TEXT) TO service_role;

COMMENT ON FUNCTION get_unavailable_tickets IS
'Returns array of unavailable ticket numbers for a competition.
Includes sold tickets from joincompetition and tickets tables, plus pending reservations.';

-- ============================================================================
-- PART 3: Create/Replace upsert_canonical_user function
-- ============================================================================
DROP FUNCTION IF EXISTS upsert_canonical_user(
  text, text, text, text, text, text, text, text, text, text, text, boolean
) CASCADE;

CREATE OR REPLACE FUNCTION upsert_canonical_user(
  p_uid text DEFAULT NULL,
  p_canonical_user_id text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_username text DEFAULT NULL,
  p_wallet_address text DEFAULT NULL,
  p_base_wallet_address text DEFAULT NULL,
  p_eth_wallet_address text DEFAULT NULL,
  p_privy_user_id text DEFAULT NULL,
  p_first_name text DEFAULT NULL,
  p_last_name text DEFAULT NULL,
  p_telegram_handle text DEFAULT NULL,
  p_wallet_linked boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_canonical_user_id text;
  v_wallet_address text;
  v_result jsonb;
  v_is_new_user boolean := false;
BEGIN
  -- Normalize inputs
  p_email := CASE WHEN p_email IS NOT NULL THEN LOWER(TRIM(p_email)) ELSE NULL END;
  p_wallet_address := CASE WHEN p_wallet_address IS NOT NULL THEN LOWER(TRIM(p_wallet_address)) ELSE NULL END;
  p_base_wallet_address := CASE WHEN p_base_wallet_address IS NOT NULL THEN LOWER(TRIM(p_base_wallet_address)) ELSE NULL END;
  p_eth_wallet_address := CASE WHEN p_eth_wallet_address IS NOT NULL THEN LOWER(TRIM(p_eth_wallet_address)) ELSE NULL END;
  p_username := CASE WHEN p_username IS NOT NULL THEN TRIM(p_username) ELSE NULL END;
  p_first_name := CASE WHEN p_first_name IS NOT NULL THEN TRIM(p_first_name) ELSE NULL END;
  p_last_name := CASE WHEN p_last_name IS NOT NULL THEN TRIM(p_last_name) ELSE NULL END;
  p_telegram_handle := CASE WHEN p_telegram_handle IS NOT NULL THEN TRIM(p_telegram_handle) ELSE NULL END;

  -- Set canonical_user_id and wallet_address from parameters or generate from wallet
  v_canonical_user_id := COALESCE(p_canonical_user_id, 'prize:pid:' || p_wallet_address);
  v_wallet_address := COALESCE(p_wallet_address, p_base_wallet_address, p_eth_wallet_address);

  -- Try to find existing user by uid, canonical_user_id, email, or wallet address
  IF p_uid IS NOT NULL THEN
    SELECT id INTO v_user_id FROM canonical_users WHERE uid = p_uid LIMIT 1;
  END IF;

  IF v_user_id IS NULL AND p_canonical_user_id IS NOT NULL THEN
    SELECT id INTO v_user_id FROM canonical_users WHERE canonical_user_id = p_canonical_user_id LIMIT 1;
  END IF;

  IF v_user_id IS NULL AND p_email IS NOT NULL THEN
    SELECT id INTO v_user_id FROM canonical_users WHERE email ILIKE p_email LIMIT 1;
  END IF;

  IF v_user_id IS NULL AND v_wallet_address IS NOT NULL THEN
    SELECT id INTO v_user_id
    FROM canonical_users
    WHERE wallet_address ILIKE v_wallet_address
       OR base_wallet_address ILIKE v_wallet_address
       OR eth_wallet_address ILIKE v_wallet_address
    LIMIT 1;
  END IF;

  -- If user exists, UPDATE (merge data)
  IF v_user_id IS NOT NULL THEN
    UPDATE canonical_users
    SET
      uid = COALESCE(uid, p_uid),
      canonical_user_id = COALESCE(canonical_user_id, v_canonical_user_id),
      email = COALESCE(email, p_email),
      username = COALESCE(username, p_username),
      wallet_address = COALESCE(wallet_address, p_wallet_address),
      base_wallet_address = COALESCE(base_wallet_address, p_base_wallet_address, p_wallet_address),
      eth_wallet_address = COALESCE(eth_wallet_address, p_eth_wallet_address, p_wallet_address),
      privy_user_id = COALESCE(privy_user_id, p_privy_user_id),
      first_name = COALESCE(first_name, p_first_name),
      last_name = COALESCE(last_name, p_last_name),
      telegram_handle = COALESCE(telegram_handle, p_telegram_handle),
      wallet_linked = CASE
        WHEN p_wallet_linked IS NOT NULL THEN p_wallet_linked
        ELSE COALESCE(wallet_linked, false)
      END,
      updated_at = NOW()
    WHERE id = v_user_id;

  ELSE
    -- User does not exist, INSERT
    v_is_new_user := true;

    -- Generate uid if not provided
    IF p_uid IS NULL THEN
      p_uid := 'user_' || substring(md5(random()::text || clock_timestamp()::text) from 1 for 20);
    END IF;

    INSERT INTO canonical_users (
      uid,
      canonical_user_id,
      email,
      username,
      wallet_address,
      base_wallet_address,
      eth_wallet_address,
      privy_user_id,
      first_name,
      last_name,
      telegram_handle,
      wallet_linked,
      auth_provider,
      created_at,
      updated_at
    )
    VALUES (
      p_uid,
      v_canonical_user_id,
      p_email,
      COALESCE(p_username, CASE WHEN p_email IS NOT NULL THEN split_part(p_email, '@', 1) ELSE NULL END),
      p_wallet_address,
      COALESCE(p_base_wallet_address, p_wallet_address),
      COALESCE(p_eth_wallet_address, p_wallet_address),
      p_privy_user_id,
      p_first_name,
      p_last_name,
      p_telegram_handle,
      COALESCE(p_wallet_linked, false),
      'cdp',
      NOW(),
      NOW()
    )
    RETURNING id INTO v_user_id;
  END IF;

  -- Build success response
  v_result := jsonb_build_object(
    'success', true,
    'user_id', v_user_id,
    'uid', p_uid,
    'canonical_user_id', v_canonical_user_id,
    'is_new_user', v_is_new_user,
    'wallet_linked', COALESCE(p_wallet_linked, false)
  );

  RETURN v_result;

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', SQLERRM
    );
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_canonical_user TO authenticated;
GRANT EXECUTE ON FUNCTION upsert_canonical_user TO service_role;
GRANT EXECUTE ON FUNCTION upsert_canonical_user TO anon;

COMMENT ON FUNCTION upsert_canonical_user IS
'Idempotent function to create or update canonical_users records during auth and wallet linking.
Safely merges data without overwriting existing non-null values.';

-- ============================================================================
-- VERIFICATION
-- ============================================================================
DO $$
DECLARE
  func_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO func_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'get_comprehensive_user_dashboard_entries',
      'get_unavailable_tickets',
      'upsert_canonical_user'
    );

  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'RPC FUNCTIONS FIX MIGRATION APPLIED';
  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'Functions created/updated: % (expected: 3)', func_count;
  RAISE NOTICE '';
  RAISE NOTICE 'Fixed issues:';
  RAISE NOTICE '  1. get_comprehensive_user_dashboard_entries:';
  RAISE NOTICE '     - Fixed "uuid ~ unknown" error by casting competitionid to TEXT';
  RAISE NOTICE '  2. get_unavailable_tickets:';
  RAISE NOTICE '     - Created function (was returning 404)';
  RAISE NOTICE '  3. upsert_canonical_user:';
  RAISE NOTICE '     - Created function (was returning 404)';
  RAISE NOTICE '=====================================================';
END $$;

COMMIT;
