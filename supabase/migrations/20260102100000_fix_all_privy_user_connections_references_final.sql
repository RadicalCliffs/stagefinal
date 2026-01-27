-- =====================================================
-- COMPREHENSIVE FIX: REPLACE ALL privy_user_connections REFERENCES
-- =====================================================
-- This migration fixes ALL remaining functions that reference the
-- deprecated privy_user_connections table, replacing them with
-- canonical_users which is the current user data table.
--
-- Error being fixed:
-- "relation \"public.privy_user_connections\" does not exist"
-- "Could not find the table 'public.privy_user_connections' in the schema cache"
--
-- Affected functions:
-- - get_user_wallet_balance
-- - get_user_tickets_for_competition
-- - get_user_active_tickets
-- - sync_external_wallet_balances
-- - Any other functions that still reference privy_user_connections
-- =====================================================

BEGIN;

-- =====================================================
-- STEP 1: FIX get_user_wallet_balance
-- =====================================================
-- This function is critical for balance display and ticket purchases

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
    SELECT COALESCE(balance, 0) INTO balance
    FROM wallet_balances
    WHERE
      canonical_user_id = user_identifier
      OR canonical_user_id = LOWER(user_identifier)
      OR (search_wallet IS NOT NULL AND LOWER(wallet_address) = search_wallet)
      OR (search_wallet IS NOT NULL AND LOWER(base_wallet_address) = search_wallet)
    ORDER BY balance DESC NULLS LAST
    LIMIT 1;

    IF balance IS NOT NULL AND balance > 0 THEN
      RETURN balance;
    END IF;
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;

  -- Try 3: Read from canonical_users (fallback - the actual user table)
  BEGIN
    SELECT COALESCE(usdc_balance, 0) INTO balance
    FROM canonical_users
    WHERE
      canonical_user_id = user_identifier
      OR canonical_user_id = LOWER(user_identifier)
      OR privy_did = user_identifier
      OR privy_user_id = user_identifier
      OR (search_wallet IS NOT NULL AND LOWER(wallet_address) = search_wallet)
      OR (search_wallet IS NOT NULL AND LOWER(base_wallet_address) = search_wallet)
      OR LOWER(wallet_address) = LOWER(user_identifier)
      OR email = user_identifier
    ORDER BY usdc_balance DESC NULLS LAST
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

GRANT EXECUTE ON FUNCTION get_user_wallet_balance(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_wallet_balance(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_user_wallet_balance(TEXT) TO service_role;

COMMENT ON FUNCTION get_user_wallet_balance(TEXT) IS
'Get user USDC balance from sub_account_balances, wallet_balances, or canonical_users. Uses canonical_users instead of deprecated privy_user_connections.';

-- =====================================================
-- STEP 2: FIX get_user_tickets_for_competition
-- =====================================================
-- This function retrieves tickets for a user in a specific competition

DROP FUNCTION IF EXISTS get_user_tickets_for_competition(text, text) CASCADE;

CREATE OR REPLACE FUNCTION get_user_tickets_for_competition(
  p_user_id text,
  p_competition_id text
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
  IF p_user_id IS NULL OR trim(p_user_id) = '' OR p_competition_id IS NULL OR trim(p_competition_id) = '' THEN
    RETURN json_build_object('tickets', ARRAY[]::integer[], 'ticket_count', 0);
  END IF;

  -- Extract wallet address for matching
  IF p_user_id LIKE 'prize:pid:0x%' THEN
    v_search_wallet := LOWER(SUBSTRING(p_user_id FROM 11));
    v_canonical_user_id := 'prize:pid:' || v_search_wallet;
  ELSIF p_user_id LIKE '0x%' AND LENGTH(p_user_id) = 42 THEN
    v_search_wallet := LOWER(p_user_id);
    v_canonical_user_id := 'prize:pid:' || v_search_wallet;
  ELSE
    v_search_wallet := NULL;
    v_canonical_user_id := p_user_id;
  END IF;

  -- Parse competition ID as UUID
  BEGIN
    v_comp_uuid := p_competition_id::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    SELECT c.id INTO v_comp_uuid
    FROM competitions c
    WHERE c.uid = p_competition_id
    LIMIT 1;
  END;

  IF v_comp_uuid IS NULL THEN
    RETURN json_build_object('tickets', ARRAY[]::integer[], 'ticket_count', 0);
  END IF;

  -- Query tickets from both joincompetition and tickets tables
  -- Match by privy_user_id, userid, wallet_address, user_id, or canonical format
  WITH all_tickets AS (
    -- From joincompetition table (comma-separated ticketnumbers)
    SELECT DISTINCT CAST(trim(t_num) AS integer) AS ticket_num
    FROM (
      SELECT unnest(string_to_array(jc.ticketnumbers, ',')) AS t_num
      FROM joincompetition jc
      WHERE jc.competitionid = v_comp_uuid::text
        AND (
          jc.privy_user_id = p_user_id
          OR jc.privy_user_id = v_canonical_user_id
          OR jc.userid = p_user_id
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
        t.user_id = p_user_id
        OR t.user_id = v_canonical_user_id
        OR (v_search_wallet IS NOT NULL AND LOWER(t.user_id) = v_search_wallet)
        OR t.privy_user_id = p_user_id
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

GRANT EXECUTE ON FUNCTION get_user_tickets_for_competition(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_tickets_for_competition(text, text) TO anon;
GRANT EXECUTE ON FUNCTION get_user_tickets_for_competition(text, text) TO service_role;

COMMENT ON FUNCTION get_user_tickets_for_competition(text, text) IS
'Get all tickets owned by a user for a specific competition. Searches both joincompetition and tickets tables. Uses canonical_users instead of deprecated privy_user_connections.';

-- =====================================================
-- STEP 3: FIX get_user_active_tickets
-- =====================================================
-- This function counts active tickets across all competitions

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
  SELECT COALESCE(SUM(numberoftickets), 0)::INTEGER INTO ticket_count
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

GRANT EXECUTE ON FUNCTION get_user_active_tickets(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_active_tickets(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_user_active_tickets(TEXT) TO service_role;

COMMENT ON FUNCTION get_user_active_tickets(TEXT) IS
'Count total tickets owned by a user in active competitions. Uses canonical format matching.';

-- =====================================================
-- STEP 4: CREATE OR REPLACE sync_external_wallet_balances
-- =====================================================
-- This function syncs external wallet balances if it exists

DROP FUNCTION IF EXISTS sync_external_wallet_balances() CASCADE;

CREATE OR REPLACE FUNCTION sync_external_wallet_balances()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Sync from canonical_users to wallet_balances
  INSERT INTO wallet_balances (user_id, canonical_user_id, wallet_address, base_wallet_address, balance, updated_at)
  SELECT
    cu.id,
    cu.canonical_user_id,
    LOWER(cu.wallet_address),
    LOWER(cu.base_wallet_address),
    COALESCE(cu.usdc_balance, 0),
    NOW()
  FROM canonical_users cu
  WHERE cu.canonical_user_id IS NOT NULL
    AND (cu.wallet_address IS NOT NULL OR cu.base_wallet_address IS NOT NULL)
  ON CONFLICT (user_id) DO UPDATE SET
    canonical_user_id = EXCLUDED.canonical_user_id,
    wallet_address = EXCLUDED.wallet_address,
    base_wallet_address = EXCLUDED.base_wallet_address,
    balance = EXCLUDED.balance,
    updated_at = NOW();

EXCEPTION WHEN undefined_table THEN
  -- wallet_balances table doesn't exist, skip
  NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION sync_external_wallet_balances() TO service_role;

-- =====================================================
-- STEP 5: FIX normalize_privy_user_connections_wallet_trigger
-- =====================================================
-- Rename and update this function to work with canonical_users

DROP FUNCTION IF EXISTS normalize_privy_user_connections_wallet_trigger() CASCADE;

-- Create a new trigger function for canonical_users
CREATE OR REPLACE FUNCTION normalize_canonical_users_wallet_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Normalize wallet_address to lowercase if present
  IF NEW.wallet_address IS NOT NULL AND NEW.wallet_address != '' THEN
    NEW.wallet_address := LOWER(NEW.wallet_address);
  END IF;

  -- Normalize base_wallet_address to lowercase if present
  IF NEW.base_wallet_address IS NOT NULL AND NEW.base_wallet_address != '' THEN
    NEW.base_wallet_address := LOWER(NEW.base_wallet_address);
  END IF;

  -- Normalize linked_external_wallet to lowercase if present
  IF NEW.linked_external_wallet IS NOT NULL AND NEW.linked_external_wallet != '' THEN
    NEW.linked_external_wallet := LOWER(NEW.linked_external_wallet);
  END IF;

  RETURN NEW;
END;
$$;

-- Drop old trigger if exists and create new one
DROP TRIGGER IF EXISTS normalize_wallet_on_insert_update ON canonical_users;

CREATE TRIGGER normalize_wallet_on_insert_update
  BEFORE INSERT OR UPDATE ON canonical_users
  FOR EACH ROW
  EXECUTE FUNCTION normalize_canonical_users_wallet_trigger();

-- =====================================================
-- STEP 6: ENSURE PERMISSIONS ON canonical_users
-- =====================================================

GRANT SELECT ON public.canonical_users TO authenticated;
GRANT SELECT ON public.canonical_users TO anon;
GRANT SELECT, INSERT, UPDATE ON public.canonical_users TO service_role;

-- Grant on wallet_balances if exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'wallet_balances') THEN
    EXECUTE 'GRANT SELECT ON public.wallet_balances TO authenticated';
    EXECUTE 'GRANT SELECT ON public.wallet_balances TO anon';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON public.wallet_balances TO service_role';
  END IF;
END $$;

-- Grant on sub_account_balances if exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sub_account_balances') THEN
    EXECUTE 'GRANT SELECT ON public.sub_account_balances TO authenticated';
    EXECUTE 'GRANT SELECT ON public.sub_account_balances TO anon';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON public.sub_account_balances TO service_role';
  END IF;
END $$;

-- =====================================================
-- STEP 7: CREATE INDEXES FOR PERFORMANCE
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_canonical_users_canonical_user_id ON canonical_users(canonical_user_id);
CREATE INDEX IF NOT EXISTS idx_canonical_users_privy_user_id ON canonical_users(privy_user_id);
CREATE INDEX IF NOT EXISTS idx_canonical_users_privy_did ON canonical_users(privy_did);
CREATE INDEX IF NOT EXISTS idx_canonical_users_wallet_address_lower ON canonical_users(LOWER(wallet_address));
CREATE INDEX IF NOT EXISTS idx_canonical_users_base_wallet_address_lower ON canonical_users(LOWER(base_wallet_address));
CREATE INDEX IF NOT EXISTS idx_canonical_users_uid ON canonical_users(uid);
CREATE INDEX IF NOT EXISTS idx_canonical_users_email ON canonical_users(email);

-- =====================================================
-- VALIDATION
-- =====================================================

DO $$
DECLARE
  func_count INTEGER;
  canonical_exists BOOLEAN;
BEGIN
  -- Check canonical_users exists
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'canonical_users'
  ) INTO canonical_exists;

  -- Count our fixed functions
  SELECT COUNT(*) INTO func_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'get_user_wallet_balance',
      'get_user_tickets_for_competition',
      'get_user_active_tickets',
      'sync_external_wallet_balances',
      'normalize_canonical_users_wallet_trigger'
    );

  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'COMPREHENSIVE FIX FOR privy_user_connections REFERENCES';
  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'canonical_users table exists: %', canonical_exists;
  RAISE NOTICE 'Functions created/updated: %', func_count;
  RAISE NOTICE '';
  RAISE NOTICE 'Fixed functions:';
  RAISE NOTICE '  - get_user_wallet_balance';
  RAISE NOTICE '  - get_user_tickets_for_competition';
  RAISE NOTICE '  - get_user_active_tickets';
  RAISE NOTICE '  - sync_external_wallet_balances';
  RAISE NOTICE '  - normalize_canonical_users_wallet_trigger';
  RAISE NOTICE '=====================================================';

  IF NOT canonical_exists THEN
    RAISE EXCEPTION 'CRITICAL: canonical_users table does not exist!';
  END IF;
END $$;

COMMIT;
