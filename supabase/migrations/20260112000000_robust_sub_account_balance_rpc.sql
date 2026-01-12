-- =====================================================
-- ROBUST SUB-ACCOUNT BALANCE RPC
-- =====================================================
-- This migration adds a robust RPC function that can look up user balances
-- by either canonical_user_id OR wallet_address, with proper case handling.
--
-- The existing get_user_balance function already works well with canonical_user_id,
-- but this migration adds an alternative function that also supports wallet lookups
-- and includes pending balance support.
--
-- Approach: Query by canonical_user_id (preferred in our dataset)
-- The client passes the canonical_user_id it already logs as "Found existing user by CANONICAL ID"
-- The RPC filters on canonical_user_id, not wallet_address (which was the previous issue)
-- =====================================================

BEGIN;

-- =====================================================
-- PART 1: CREATE/REPLACE get_sub_account_balance_flexible RPC
-- =====================================================
-- This function accepts either canonical_user_id or wallet address
-- and handles case-insensitive comparisons properly

DROP FUNCTION IF EXISTS get_sub_account_balance_flexible(TEXT, TEXT, TEXT, BOOLEAN);

CREATE OR REPLACE FUNCTION get_sub_account_balance_flexible(
  p_canonical_user_id TEXT DEFAULT NULL,
  p_wallet_address TEXT DEFAULT NULL,
  p_currency TEXT DEFAULT 'USD',
  p_include_pending BOOLEAN DEFAULT FALSE
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  resolved_cid TEXT;
  v_balance NUMERIC := 0;
  v_pending NUMERIC := 0;
  search_wallet TEXT;
BEGIN
  -- STEP 1: Resolve the canonical_user_id
  -- If p_canonical_user_id is provided, use it directly
  -- If only p_wallet_address is provided, resolve it to canonical_user_id via canonical_users

  IF p_canonical_user_id IS NOT NULL AND p_canonical_user_id != '' THEN
    -- Use the provided canonical_user_id
    resolved_cid := p_canonical_user_id;
  ELSIF p_wallet_address IS NOT NULL AND p_wallet_address != '' THEN
    -- Resolve wallet address to canonical_user_id via canonical_users
    SELECT cu.canonical_user_id INTO resolved_cid
    FROM public.canonical_users cu
    WHERE
      LOWER(COALESCE(cu.wallet_address, '')) = LOWER(p_wallet_address)
      OR LOWER(COALESCE(cu.base_wallet_address, '')) = LOWER(p_wallet_address)
      OR LOWER(COALESCE(cu.eth_wallet_address, '')) = LOWER(p_wallet_address)
    LIMIT 1;

    -- If not found in canonical_users, construct the canonical ID from wallet
    IF resolved_cid IS NULL THEN
      resolved_cid := 'prize:pid:' || LOWER(p_wallet_address);
    END IF;
  ELSE
    -- Neither provided, return 0
    RETURN 0;
  END IF;

  -- STEP 2: Extract wallet for additional matching
  IF resolved_cid LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(resolved_cid FROM 11));
  ELSIF resolved_cid LIKE '0x%' AND LENGTH(resolved_cid) = 42 THEN
    search_wallet := LOWER(resolved_cid);
  ELSE
    search_wallet := NULL;
  END IF;

  -- STEP 3: Query sub_account_balances with multiple match strategies
  SELECT
    COALESCE(b.available_balance, 0),
    COALESCE(b.pending_balance, 0)
  INTO v_balance, v_pending
  FROM public.sub_account_balances b
  WHERE b.currency = COALESCE(p_currency, 'USD')
    AND (
      -- Match by canonical_user_id (exact)
      b.canonical_user_id = resolved_cid
      -- Match by canonical_user_id (lowercase)
      OR b.canonical_user_id = LOWER(resolved_cid)
      -- Match by wallet in canonical format
      OR (search_wallet IS NOT NULL AND b.canonical_user_id = 'prize:pid:' || search_wallet)
      -- Match by user_id (legacy)
      OR b.user_id = resolved_cid
      -- Match by privy_user_id (legacy)
      OR b.privy_user_id = resolved_cid
    )
  ORDER BY
    CASE
      WHEN b.canonical_user_id = resolved_cid THEN 0
      WHEN b.canonical_user_id = LOWER(resolved_cid) THEN 1
      WHEN search_wallet IS NOT NULL AND b.canonical_user_id = 'prize:pid:' || search_wallet THEN 2
      ELSE 3
    END
  LIMIT 1;

  -- STEP 4: Return balance (with or without pending)
  IF p_include_pending THEN
    RETURN COALESCE(v_balance, 0) + COALESCE(v_pending, 0);
  ELSE
    RETURN COALESCE(v_balance, 0);
  END IF;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_sub_account_balance_flexible(TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION get_sub_account_balance_flexible(TEXT, TEXT, TEXT, BOOLEAN) TO anon;
GRANT EXECUTE ON FUNCTION get_sub_account_balance_flexible(TEXT, TEXT, TEXT, BOOLEAN) TO service_role;

COMMENT ON FUNCTION get_sub_account_balance_flexible(TEXT, TEXT, TEXT, BOOLEAN) IS
'Flexible balance lookup that accepts either canonical_user_id or wallet_address.
Parameters:
- p_canonical_user_id: prize:pid: format user ID (preferred)
- p_wallet_address: Ethereum wallet address (0x...) for fallback lookup
- p_currency: Currency code (default USD)
- p_include_pending: Include pending_balance in result (default false)

Examples:
- By canonical ID: SELECT get_sub_account_balance_flexible(''prize:pid:0xaa284ddd...'', NULL, ''USD'', true);
- By wallet: SELECT get_sub_account_balance_flexible(NULL, ''0xaa284ddd...'', ''USD'', true);';

-- =====================================================
-- PART 2: UPDATE get_user_balance to use LOWER() for case-insensitive matching
-- =====================================================
-- The existing get_user_balance function already handles this, but let's ensure
-- it uses LOWER() consistently for all wallet address comparisons

DROP FUNCTION IF EXISTS get_user_balance(TEXT);

CREATE OR REPLACE FUNCTION get_user_balance(p_canonical_user_id TEXT)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_balance NUMERIC;
  search_wallet TEXT;
BEGIN
  -- Handle null or empty identifier
  IF p_canonical_user_id IS NULL OR p_canonical_user_id = '' THEN
    RETURN 0;
  END IF;

  -- Extract wallet address from prize:pid: format if present
  -- e.g., 'prize:pid:0x1234...' -> '0x1234...'
  IF p_canonical_user_id LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(p_canonical_user_id FROM 11));
  ELSIF p_canonical_user_id LIKE '0x%' AND LENGTH(p_canonical_user_id) = 42 THEN
    search_wallet := LOWER(p_canonical_user_id);
  ELSE
    search_wallet := NULL;
  END IF;

  -- Try 1: Read from sub_account_balances (primary source of truth)
  BEGIN
    SELECT COALESCE(available_balance, 0)::NUMERIC INTO user_balance
    FROM public.sub_account_balances
    WHERE currency = 'USD'
      AND (
        -- Match by canonical_user_id (exact)
        canonical_user_id = p_canonical_user_id
        -- Match by canonical_user_id (lowercase for case-insensitive)
        OR canonical_user_id = LOWER(p_canonical_user_id)
        -- Match by wallet address in canonical format
        OR (search_wallet IS NOT NULL AND canonical_user_id = 'prize:pid:' || search_wallet)
        -- Match by user_id (legacy privy DID format)
        OR user_id = p_canonical_user_id
        -- Match by privy_user_id
        OR privy_user_id = p_canonical_user_id
      )
    ORDER BY
      CASE
        WHEN canonical_user_id = p_canonical_user_id THEN 0
        WHEN canonical_user_id = LOWER(p_canonical_user_id) THEN 1
        WHEN search_wallet IS NOT NULL AND canonical_user_id = 'prize:pid:' || search_wallet THEN 2
        ELSE 3
      END,
      available_balance DESC NULLS LAST
    LIMIT 1;

    -- If found with balance > 0, return it
    IF user_balance IS NOT NULL AND user_balance > 0 THEN
      RETURN user_balance;
    END IF;
  EXCEPTION WHEN undefined_table THEN
    -- sub_account_balances table doesn't exist, continue to fallback
    NULL;
  END;

  -- Try 2: Read from wallet_balances table (for RLS support)
  BEGIN
    SELECT COALESCE(balance, 0)::NUMERIC INTO user_balance
    FROM public.wallet_balances
    WHERE
      -- Match by canonical_user_id (exact or lowercase)
      canonical_user_id = p_canonical_user_id
      OR canonical_user_id = LOWER(p_canonical_user_id)
      -- Match by wallet address (case-insensitive using LOWER)
      OR (search_wallet IS NOT NULL AND LOWER(wallet_address) = search_wallet)
      -- Match by base_wallet_address (case-insensitive using LOWER)
      OR (search_wallet IS NOT NULL AND LOWER(base_wallet_address) = search_wallet)
    ORDER BY
      CASE
        WHEN canonical_user_id = p_canonical_user_id THEN 0
        WHEN canonical_user_id = LOWER(p_canonical_user_id) THEN 1
        ELSE 2
      END,
      balance DESC NULLS LAST
    LIMIT 1;

    -- If found with balance > 0, return it
    IF user_balance IS NOT NULL AND user_balance > 0 THEN
      RETURN user_balance;
    END IF;
  EXCEPTION WHEN undefined_table THEN
    -- wallet_balances table doesn't exist, continue to fallback
    NULL;
  END;

  -- Try 3: Fallback to canonical_users (the real user table)
  BEGIN
    SELECT COALESCE(usdc_balance, 0)::NUMERIC INTO user_balance
    FROM public.canonical_users
    WHERE
      -- Match by canonical_user_id (exact or lowercase)
      canonical_user_id = p_canonical_user_id
      OR canonical_user_id = LOWER(p_canonical_user_id)
      -- Match by wallet address (case-insensitive using LOWER)
      OR (search_wallet IS NOT NULL AND LOWER(wallet_address) = search_wallet)
      -- Match by base_wallet_address (case-insensitive using LOWER) - IMPORTANT for Base users!
      OR (search_wallet IS NOT NULL AND LOWER(base_wallet_address) = search_wallet)
      -- Match by direct wallet address comparison
      OR LOWER(wallet_address) = LOWER(p_canonical_user_id)
      -- Match by legacy privy_user_id
      OR privy_user_id = p_canonical_user_id
    ORDER BY
      CASE
        WHEN canonical_user_id = p_canonical_user_id THEN 0
        WHEN canonical_user_id = LOWER(p_canonical_user_id) THEN 1
        WHEN search_wallet IS NOT NULL AND LOWER(wallet_address) = search_wallet THEN 2
        WHEN search_wallet IS NOT NULL AND LOWER(base_wallet_address) = search_wallet THEN 3
        ELSE 4
      END,
      usdc_balance DESC NULLS LAST
    LIMIT 1;
  EXCEPTION WHEN undefined_table THEN
    -- canonical_users table doesn't exist (should never happen)
    user_balance := 0;
  END;

  RETURN COALESCE(user_balance, 0);
EXCEPTION
  WHEN OTHERS THEN
    -- Log any unexpected errors but return 0 instead of failing
    RAISE WARNING 'get_user_balance error for %: % (SQLSTATE: %)',
      LEFT(p_canonical_user_id, 20), SQLERRM, SQLSTATE;
    RETURN 0;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_user_balance(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_balance(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_user_balance(TEXT) TO service_role;

COMMENT ON FUNCTION get_user_balance(TEXT) IS
'Get user available balance by canonical_user_id (prize:pid: format).
Checks tables in priority order:
1. sub_account_balances.available_balance (primary - USD currency)
2. wallet_balances.balance (secondary - for RLS support)
3. canonical_users.usdc_balance (fallback)
Returns 0 if user not found or no balance. Never fails.
Uses LOWER() for all wallet address comparisons to ensure case-insensitive matching.';

-- =====================================================
-- PART 3: VALIDATION
-- =====================================================

DO $$
DECLARE
  func1_exists BOOLEAN;
  func2_exists BOOLEAN;
BEGIN
  -- Check functions exist
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'get_sub_account_balance_flexible'
  ) INTO func1_exists;

  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'get_user_balance'
  ) INTO func2_exists;

  RAISE NOTICE '=============================================';
  RAISE NOTICE 'ROBUST SUB-ACCOUNT BALANCE RPC MIGRATION COMPLETE';
  RAISE NOTICE '=============================================';
  RAISE NOTICE 'get_sub_account_balance_flexible exists: %', func1_exists;
  RAISE NOTICE 'get_user_balance exists: %', func2_exists;
  RAISE NOTICE '';
  RAISE NOTICE 'Changes:';
  RAISE NOTICE '  1. Added get_sub_account_balance_flexible RPC that accepts';
  RAISE NOTICE '     either canonical_user_id OR wallet_address';
  RAISE NOTICE '  2. Updated get_user_balance to use LOWER() consistently';
  RAISE NOTICE '     for all wallet address comparisons';
  RAISE NOTICE '';
  RAISE NOTICE 'The client should use canonical_user_id (preferred):';
  RAISE NOTICE '  - Pass the canonical_user_id already logged as';
  RAISE NOTICE '    "Found existing user by CANONICAL ID"';
  RAISE NOTICE '  - The RPC filters on canonical_user_id, not wallet_address';
  RAISE NOTICE '=============================================';
END $$;

COMMIT;
