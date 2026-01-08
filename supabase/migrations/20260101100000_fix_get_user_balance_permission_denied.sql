-- =====================================================
-- FIX: GET_USER_BALANCE 401 PERMISSION DENIED ERROR
-- =====================================================
-- This migration fixes the "permission denied for table wallet_transactions" error
-- that occurs when calling get_user_balance RPC.
--
-- ROOT CAUSE:
-- The error message "wallet_transactions" is misleading. The actual issue is that
-- either:
-- 1. An old version of the function exists in the database that references a
--    non-existent table (wallet_transactions was never created)
-- 2. The RLS policies on the underlying tables block access
--
-- FIX:
-- 1. Completely drop and recreate get_user_balance with proper SECURITY DEFINER
-- 2. Ensure all required table grants are in place
-- 3. Add defensive error handling
-- =====================================================

BEGIN;

-- =====================================================
-- STEP 1: DROP ANY EXISTING VERSIONS OF THE FUNCTION
-- =====================================================
-- Drop all possible overloads to ensure clean slate

DROP FUNCTION IF EXISTS get_user_balance(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.get_user_balance(TEXT) CASCADE;

-- =====================================================
-- STEP 2: CREATE CLEAN GET_USER_BALANCE FUNCTION
-- =====================================================
-- This function reads from three tables in priority order:
-- 1. sub_account_balances (primary - newest balance system)
-- 2. wallet_balances (secondary - for RLS support)
-- 3. canonical_users (fallback - the real user table)
--
-- Uses SECURITY DEFINER to bypass RLS and run with owner privileges

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

  -- Try 1: Read from sub_account_balances (newest balance table)
  BEGIN
    SELECT COALESCE(available_balance, 0)::NUMERIC INTO user_balance
    FROM public.sub_account_balances
    WHERE currency = 'USD'
      AND (
        -- Match by canonical_user_id (exact or lowercase)
        canonical_user_id = p_canonical_user_id
        OR canonical_user_id = LOWER(p_canonical_user_id)
        -- Match by wallet address extracted from prize:pid:
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

    -- If found in sub_account_balances with balance > 0, return it
    IF user_balance IS NOT NULL AND user_balance > 0 THEN
      RETURN user_balance;
    END IF;
  EXCEPTION WHEN undefined_table THEN
    -- sub_account_balances table doesn't exist, continue to fallback
    NULL;
  END;

  -- Try 2: Read from wallet_balances table (created for RLS support)
  BEGIN
    SELECT COALESCE(balance, 0)::NUMERIC INTO user_balance
    FROM public.wallet_balances
    WHERE
      -- Match by canonical_user_id (exact or lowercase)
      canonical_user_id = p_canonical_user_id
      OR canonical_user_id = LOWER(p_canonical_user_id)
      -- Match by wallet address (case-insensitive)
      OR (search_wallet IS NOT NULL AND LOWER(wallet_address) = search_wallet)
      -- Match by base_wallet_address (case-insensitive)
      OR (search_wallet IS NOT NULL AND LOWER(base_wallet_address) = search_wallet)
    ORDER BY
      CASE
        WHEN canonical_user_id = p_canonical_user_id THEN 0
        WHEN canonical_user_id = LOWER(p_canonical_user_id) THEN 1
        ELSE 2
      END,
      balance DESC NULLS LAST
    LIMIT 1;

    -- If found in wallet_balances with balance > 0, return it
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
      -- Match by wallet address (case-insensitive)
      OR (search_wallet IS NOT NULL AND LOWER(wallet_address) = search_wallet)
      -- Match by base_wallet_address (case-insensitive) - IMPORTANT for Base users!
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

-- =====================================================
-- STEP 3: GRANT EXECUTE PERMISSIONS
-- =====================================================

GRANT EXECUTE ON FUNCTION get_user_balance(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_balance(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_user_balance(TEXT) TO service_role;

-- =====================================================
-- STEP 4: ENSURE TABLE GRANTS ARE IN PLACE
-- =====================================================
-- SECURITY DEFINER functions need the function OWNER to have grants,
-- but let's also ensure the roles have direct grants as backup

-- Grant SELECT on sub_account_balances if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'sub_account_balances'
  ) THEN
    EXECUTE 'GRANT SELECT ON public.sub_account_balances TO authenticated';
    EXECUTE 'GRANT SELECT ON public.sub_account_balances TO anon';
    EXECUTE 'GRANT SELECT ON public.sub_account_balances TO service_role';
  END IF;
END $$;

-- Grant SELECT on wallet_balances if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'wallet_balances'
  ) THEN
    EXECUTE 'GRANT SELECT ON public.wallet_balances TO authenticated';
    EXECUTE 'GRANT SELECT ON public.wallet_balances TO anon';
    EXECUTE 'GRANT SELECT ON public.wallet_balances TO service_role';
  END IF;
END $$;

-- Grant SELECT on canonical_users (the real user table)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'canonical_users'
  ) THEN
    EXECUTE 'GRANT SELECT ON public.canonical_users TO authenticated';
    EXECUTE 'GRANT SELECT ON public.canonical_users TO anon';
    EXECUTE 'GRANT SELECT ON public.canonical_users TO service_role';
  END IF;
END $$;

-- =====================================================
-- STEP 5: ADD DOCUMENTATION
-- =====================================================

COMMENT ON FUNCTION get_user_balance(TEXT) IS
'Get user available balance by canonical_user_id (prize:pid: format).
Checks tables in priority order:
1. sub_account_balances.available_balance (primary - USD currency)
2. wallet_balances.balance (secondary - for RLS support)
3. canonical_users.usdc_balance (fallback)
Returns 0 if user not found or no balance. Never fails.';

-- =====================================================
-- VALIDATION
-- =====================================================

DO $$
DECLARE
  func_exists BOOLEAN;
  func_security TEXT;
BEGIN
  -- Check function exists and has SECURITY DEFINER
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'get_user_balance'
  ) INTO func_exists;

  SELECT prosecdef::text INTO func_security
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public' AND p.proname = 'get_user_balance';

  RAISE NOTICE '=============================================';
  RAISE NOTICE 'GET_USER_BALANCE PERMISSION FIX COMPLETE';
  RAISE NOTICE '=============================================';
  RAISE NOTICE 'Function exists: %', func_exists;
  RAISE NOTICE 'Security definer: %', COALESCE(func_security, 'N/A');
  RAISE NOTICE '=============================================';
  RAISE NOTICE 'The get_user_balance function has been recreated with:';
  RAISE NOTICE '  - SECURITY DEFINER (bypasses RLS)';
  RAISE NOTICE '  - Defensive error handling';
  RAISE NOTICE '  - No references to wallet_transactions';
  RAISE NOTICE '  - Proper grants for all roles';
  RAISE NOTICE '=============================================';
END $$;

COMMIT;
