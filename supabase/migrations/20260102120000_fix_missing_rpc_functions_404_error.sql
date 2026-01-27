-- =====================================================
-- FIX: Missing RPC Functions Causing HTTP 404 Errors
-- =====================================================
-- This migration addresses the following error in browser console:
-- - XHRPOST get_user_tickets_for_competition [HTTP/2 404]
-- - XHRPOST get_user_wallet_balance [HTTP/2 404]
--
-- These 404 errors indicate the RPC functions don't exist in the database.
-- The functions are critical for:
-- 1. Fetching user tickets after purchase
-- 2. Getting user balance for payments
-- 3. Displaying entries in the dashboard
--
-- Root cause: Previous migrations were not applied to production
-- This migration consolidates all required functions with proper
-- error handling and grants.
-- =====================================================

BEGIN;

-- =====================================================
-- FUNCTION 1: get_user_wallet_balance
-- =====================================================
-- Returns user's USDC balance from various sources:
-- 1. sub_account_balances (primary)
-- 2. wallet_balances (secondary)
-- 3. canonical_users (legacy fallback)

DROP FUNCTION IF EXISTS get_user_wallet_balance(TEXT) CASCADE;

CREATE OR REPLACE FUNCTION get_user_wallet_balance(user_identifier TEXT)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  balance NUMERIC;
  search_wallet TEXT;
BEGIN
  -- Handle null or empty identifier
  IF user_identifier IS NULL OR user_identifier = '' THEN
    RETURN 0;
  END IF;

  -- Extract wallet address from prize:pid: format if present
  IF user_identifier LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(user_identifier FROM 11));
  ELSIF user_identifier LIKE '0x%' AND LENGTH(user_identifier) = 42 THEN
    search_wallet := LOWER(user_identifier);
  ELSE
    search_wallet := NULL;
  END IF;

  -- Try 1: Read from sub_account_balances (primary balance source)
  BEGIN
    SELECT COALESCE(available_balance, 0) INTO balance
    FROM sub_account_balances
    WHERE currency = 'USD'
      AND (
        canonical_user_id = user_identifier
        OR canonical_user_id = LOWER(user_identifier)
        OR (search_wallet IS NOT NULL AND canonical_user_id = 'prize:pid:' || search_wallet)
        OR user_id = user_identifier
        OR privy_user_id = user_identifier
      )
    ORDER BY available_balance DESC NULLS LAST
    LIMIT 1;

    IF balance IS NOT NULL AND balance > 0 THEN
      RETURN balance;
    END IF;
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;

  -- Try 2: Read from wallet_balances table
  BEGIN
    SELECT COALESCE(wb.balance, 0) INTO balance
    FROM wallet_balances wb
    WHERE
      wb.canonical_user_id = user_identifier
      OR wb.canonical_user_id = LOWER(user_identifier)
      OR (search_wallet IS NOT NULL AND LOWER(wb.wallet_address) = search_wallet)
      OR (search_wallet IS NOT NULL AND LOWER(wb.base_wallet_address) = search_wallet)
    ORDER BY wb.balance DESC NULLS LAST
    LIMIT 1;

    IF balance IS NOT NULL AND balance > 0 THEN
      RETURN balance;
    END IF;
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;

  -- Try 3: Read from canonical_users (fallback)
  BEGIN
    SELECT COALESCE(cu.usdc_balance, 0) INTO balance
    FROM canonical_users cu
    WHERE
      cu.canonical_user_id = user_identifier
      OR cu.canonical_user_id = LOWER(user_identifier)
      OR cu.privy_did = user_identifier
      OR cu.privy_user_id = user_identifier
      OR (search_wallet IS NOT NULL AND LOWER(cu.wallet_address) = search_wallet)
      OR (search_wallet IS NOT NULL AND LOWER(cu.base_wallet_address) = search_wallet)
      OR LOWER(cu.wallet_address) = LOWER(user_identifier)
      OR cu.email = user_identifier
    ORDER BY cu.usdc_balance DESC NULLS LAST
    LIMIT 1;
  EXCEPTION WHEN undefined_table THEN
    balance := 0;
  END;

  RETURN COALESCE(balance, 0);
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'get_user_wallet_balance error for %: %', LEFT(user_identifier, 20), SQLERRM;
    RETURN 0;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_user_wallet_balance(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_wallet_balance(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_user_wallet_balance(TEXT) TO service_role;

COMMENT ON FUNCTION get_user_wallet_balance(TEXT) IS
'Get user USDC balance from sub_account_balances, wallet_balances, or canonical_users.';


-- =====================================================
-- FUNCTION 2: get_user_tickets_for_competition
-- =====================================================
-- Returns tickets owned by a user for a specific competition.
-- Searches both joincompetition and tickets tables.
-- Parameters use same names as frontend calls: user_id, competition_id

DROP FUNCTION IF EXISTS get_user_tickets_for_competition(text, text) CASCADE;

CREATE OR REPLACE FUNCTION get_user_tickets_for_competition(
  user_id text,
  competition_id text
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_comp_uuid uuid;
  v_tickets integer[];
  v_ticket_count integer;
  v_search_wallet text;
  v_canonical_user_id text;
BEGIN
  -- Validate inputs
  IF user_id IS NULL OR trim(user_id) = '' OR competition_id IS NULL OR trim(competition_id) = '' THEN
    RETURN json_build_object('tickets', ARRAY[]::integer[], 'ticket_count', 0);
  END IF;

  -- Extract wallet address for matching
  IF user_id LIKE 'prize:pid:0x%' THEN
    v_search_wallet := LOWER(SUBSTRING(user_id FROM 11));
    v_canonical_user_id := 'prize:pid:' || v_search_wallet;
  ELSIF user_id LIKE '0x%' AND LENGTH(user_id) = 42 THEN
    v_search_wallet := LOWER(user_id);
    v_canonical_user_id := 'prize:pid:' || v_search_wallet;
  ELSE
    v_search_wallet := NULL;
    v_canonical_user_id := user_id;
  END IF;

  -- Parse competition ID as UUID
  BEGIN
    v_comp_uuid := competition_id::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    SELECT c.id INTO v_comp_uuid
    FROM competitions c
    WHERE c.uid = competition_id
    LIMIT 1;
  END;

  IF v_comp_uuid IS NULL THEN
    RETURN json_build_object('tickets', ARRAY[]::integer[], 'ticket_count', 0);
  END IF;

  -- Query tickets from both joincompetition and tickets tables
  WITH all_tickets AS (
    -- From joincompetition table (comma-separated ticketnumbers)
    SELECT DISTINCT CAST(trim(t_num) AS integer) AS ticket_num
    FROM (
      SELECT unnest(string_to_array(jc.ticketnumbers, ',')) AS t_num
      FROM joincompetition jc
      WHERE jc.competitionid = v_comp_uuid::text
        AND (
          jc.privy_user_id = user_id
          OR jc.privy_user_id = v_canonical_user_id
          OR jc.userid = user_id
          OR jc.userid = v_canonical_user_id
          OR (v_search_wallet IS NOT NULL AND LOWER(jc.wallet_address) = v_search_wallet)
        )
        AND jc.ticketnumbers IS NOT NULL
        AND trim(jc.ticketnumbers) != ''
    ) jc_tickets
    WHERE trim(t_num) ~ '^[0-9]+$'

    UNION

    -- From tickets table
    SELECT DISTINCT t.ticket_number AS ticket_num
    FROM tickets t
    WHERE t.competition_id = v_comp_uuid
      AND (
        t.user_id = user_id
        OR t.user_id = v_canonical_user_id
        OR (v_search_wallet IS NOT NULL AND LOWER(t.user_id) = v_search_wallet)
        OR t.privy_user_id = user_id
        OR t.privy_user_id = v_canonical_user_id
      )
  )
  SELECT array_agg(ticket_num ORDER BY ticket_num), count(*)::integer
  INTO v_tickets, v_ticket_count
  FROM all_tickets;

  RETURN json_build_object(
    'tickets', COALESCE(v_tickets, ARRAY[]::integer[]),
    'ticket_count', COALESCE(v_ticket_count, 0)
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'get_user_tickets_for_competition error: %', SQLERRM;
    RETURN json_build_object('tickets', ARRAY[]::integer[], 'ticket_count', 0);
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_user_tickets_for_competition(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_tickets_for_competition(text, text) TO anon;
GRANT EXECUTE ON FUNCTION get_user_tickets_for_competition(text, text) TO service_role;

COMMENT ON FUNCTION get_user_tickets_for_competition(text, text) IS
'Get all tickets owned by a user for a specific competition. Searches both joincompetition and tickets tables.';


-- =====================================================
-- FUNCTION 3: get_user_active_tickets
-- =====================================================
-- Counts total tickets owned by a user in active competitions

DROP FUNCTION IF EXISTS get_user_active_tickets(TEXT) CASCADE;

CREATE OR REPLACE FUNCTION get_user_active_tickets(user_identifier TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ticket_count INTEGER;
  v_search_wallet TEXT;
  v_canonical_user_id TEXT;
BEGIN
  -- Handle null or empty identifier
  IF user_identifier IS NULL OR user_identifier = '' THEN
    RETURN 0;
  END IF;

  -- Extract wallet address for matching
  IF user_identifier LIKE 'prize:pid:0x%' THEN
    v_search_wallet := LOWER(SUBSTRING(user_identifier FROM 11));
    v_canonical_user_id := 'prize:pid:' || v_search_wallet;
  ELSIF user_identifier LIKE '0x%' AND LENGTH(user_identifier) = 42 THEN
    v_search_wallet := LOWER(user_identifier);
    v_canonical_user_id := 'prize:pid:' || v_search_wallet;
  ELSE
    v_search_wallet := NULL;
    v_canonical_user_id := user_identifier;
  END IF;

  -- Count tickets in active competitions
  SELECT COALESCE(SUM(jc.numberoftickets), 0)::INTEGER INTO ticket_count
  FROM joincompetition jc
  INNER JOIN competitions c ON jc.competitionid = c.uid OR jc.competitionid::uuid = c.id
  WHERE (
    jc.userid = user_identifier
    OR jc.userid = v_canonical_user_id
    OR jc.privy_user_id = user_identifier
    OR jc.privy_user_id = v_canonical_user_id
    OR (v_search_wallet IS NOT NULL AND LOWER(jc.wallet_address) = v_search_wallet)
  )
  AND c.enddate > NOW()
  AND (c.is_active = TRUE OR c.status = 'active');

  RETURN COALESCE(ticket_count, 0);
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'get_user_active_tickets error: %', SQLERRM;
    RETURN 0;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_user_active_tickets(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_active_tickets(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_user_active_tickets(TEXT) TO service_role;

COMMENT ON FUNCTION get_user_active_tickets(TEXT) IS
'Count total tickets owned by a user in active competitions.';


-- =====================================================
-- FUNCTION 4: get_user_balance (alternate name used in some places)
-- =====================================================
-- Some code calls get_user_balance instead of get_user_wallet_balance
-- This provides an alias for compatibility

DROP FUNCTION IF EXISTS get_user_balance(TEXT) CASCADE;

CREATE OR REPLACE FUNCTION get_user_balance(p_canonical_user_id TEXT)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Delegate to the main balance function
  RETURN get_user_wallet_balance(p_canonical_user_id);
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_user_balance(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_balance(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_user_balance(TEXT) TO service_role;

COMMENT ON FUNCTION get_user_balance(TEXT) IS
'Alias for get_user_wallet_balance - returns user USDC balance.';


-- =====================================================
-- VALIDATION
-- =====================================================

DO $$
DECLARE
  func_count INTEGER;
BEGIN
  -- Count our functions
  SELECT COUNT(*) INTO func_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'get_user_wallet_balance',
      'get_user_tickets_for_competition',
      'get_user_active_tickets',
      'get_user_balance'
    );

  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'FIX: Missing RPC Functions Causing HTTP 404 Errors';
  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'Functions created/updated: %', func_count;
  RAISE NOTICE '';
  RAISE NOTICE 'Created functions:';
  RAISE NOTICE '  - get_user_wallet_balance(TEXT) -> NUMERIC';
  RAISE NOTICE '  - get_user_tickets_for_competition(text, text) -> JSON';
  RAISE NOTICE '  - get_user_active_tickets(TEXT) -> INTEGER';
  RAISE NOTICE '  - get_user_balance(TEXT) -> NUMERIC (alias)';
  RAISE NOTICE '=====================================================';

  IF func_count < 4 THEN
    RAISE WARNING 'Expected 4 functions, found only %. Some functions may not have been created.', func_count;
  END IF;
END $$;

COMMIT;
