-- =====================================================
-- FIX: GET_USER_BALANCE RPC FOR BASE USERS
-- =====================================================
-- This migration fixes the get_user_balance function to properly
-- handle Base wallet users by:
--
-- 1. Adding wallet_balances table lookup (missing from previous migration)
-- 2. Ensuring proper wallet address matching for Base users
-- 3. Adding base_wallet_address lookup in sub_account_balances
--
-- The issue: Base users have balance in wallet_balances or
-- privy_user_connections.usdc_balance, but the RPC was only
-- checking sub_account_balances first (which doesn't have their data).
-- =====================================================

BEGIN;

-- =====================================================
-- UPDATE get_user_balance RPC FUNCTION
-- =====================================================
-- Adds wallet_balances table lookup and improves Base wallet matching

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

  -- Try 1: Read from sub_account_balances (newest balance table)
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

  -- If found in sub_account_balances, return it
  IF user_balance IS NOT NULL AND user_balance > 0 THEN
    RETURN user_balance;
  END IF;

  -- Try 2: Read from wallet_balances table (created for RLS support)
  -- This table was populated by backfill migration but wasn't being checked
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

  -- If found in wallet_balances, return it
  IF user_balance IS NOT NULL AND user_balance > 0 THEN
    RETURN user_balance;
  END IF;

  -- Try 3: Fallback to canonical_users (the actual user table)
  BEGIN
    SELECT COALESCE(usdc_balance, 0)::NUMERIC INTO user_balance
    FROM canonical_users
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
    user_balance := 0;
  END;

  RETURN COALESCE(user_balance, 0);
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'get_user_balance error: %', SQLERRM;
    RETURN 0;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_user_balance(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_balance(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_user_balance(TEXT) TO service_role;

COMMENT ON FUNCTION get_user_balance(TEXT) IS 'Get user available balance by canonical_user_id. Checks sub_account_balances, wallet_balances, and canonical_users in order.';

-- =====================================================
-- SYNC: Ensure wallet_balances is in sync with canonical_users
-- =====================================================
-- Some users might have balance in canonical_users but not in wallet_balances

DO $$
BEGIN
  INSERT INTO public.wallet_balances (
    user_id,
    canonical_user_id,
    wallet_address,
    base_wallet_address,
    balance,
    has_used_new_user_bonus,
    updated_at,
    created_at
  )
  SELECT
    cu.id AS user_id,
    cu.canonical_user_id,
    cu.wallet_address,
    cu.base_wallet_address,
    COALESCE(cu.usdc_balance, 0) AS balance,
    COALESCE(cu.has_used_new_user_bonus, FALSE),
    COALESCE(cu.updated_at, NOW()),
    COALESCE(cu.created_at, NOW())
  FROM canonical_users cu
  WHERE cu.usdc_balance > 0
    AND NOT EXISTS (
      SELECT 1 FROM public.wallet_balances wb
      WHERE wb.user_id = cu.id
    )
  ON CONFLICT (user_id) DO UPDATE SET
    canonical_user_id = EXCLUDED.canonical_user_id,
    wallet_address = EXCLUDED.wallet_address,
    base_wallet_address = EXCLUDED.base_wallet_address,
    balance = GREATEST(wallet_balances.balance, EXCLUDED.balance),
    has_used_new_user_bonus = EXCLUDED.has_used_new_user_bonus,
    updated_at = NOW();
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'wallet_balances table does not exist, skipping sync';
END $$;

-- =====================================================
-- SYNC: Update wallet_balances where canonical_users has higher balance
-- =====================================================
-- This ensures we pick up any balances that were missed

DO $$
BEGIN
  UPDATE public.wallet_balances wb
  SET
    balance = cu.usdc_balance,
    updated_at = NOW()
  FROM canonical_users cu
  WHERE wb.user_id = cu.id
    AND COALESCE(cu.usdc_balance, 0) > COALESCE(wb.balance, 0);
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'wallet_balances or canonical_users table does not exist, skipping sync';
END $$;

-- =====================================================
-- VALIDATION
-- =====================================================

DO $$
DECLARE
  sub_account_count INTEGER;
  wallet_balances_count INTEGER;
  canonical_with_balance INTEGER;
  users_with_any_balance INTEGER;
BEGIN
  BEGIN
    SELECT COUNT(*) INTO sub_account_count
    FROM public.sub_account_balances WHERE available_balance > 0;
  EXCEPTION WHEN undefined_table THEN
    sub_account_count := 0;
  END;

  BEGIN
    SELECT COUNT(*) INTO wallet_balances_count
    FROM public.wallet_balances WHERE balance > 0;
  EXCEPTION WHEN undefined_table THEN
    wallet_balances_count := 0;
  END;

  BEGIN
    SELECT COUNT(*) INTO canonical_with_balance
    FROM canonical_users WHERE usdc_balance > 0;
  EXCEPTION WHEN undefined_table THEN
    canonical_with_balance := 0;
  END;

  RAISE NOTICE '=============================================';
  RAISE NOTICE 'GET_USER_BALANCE FIX FOR BASE USERS COMPLETE';
  RAISE NOTICE '=============================================';
  RAISE NOTICE 'Users with balance in sub_account_balances: %', sub_account_count;
  RAISE NOTICE 'Users with balance in wallet_balances: %', wallet_balances_count;
  RAISE NOTICE 'Users with balance in canonical_users: %', canonical_with_balance;
  RAISE NOTICE '=============================================';
  RAISE NOTICE 'The get_user_balance function now checks all three tables:';
  RAISE NOTICE '  1. sub_account_balances (primary)';
  RAISE NOTICE '  2. wallet_balances (secondary)';
  RAISE NOTICE '  3. canonical_users (fallback)';
  RAISE NOTICE '=============================================';
END $$;

COMMIT;
