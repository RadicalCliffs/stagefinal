-- =====================================================
-- CRITICAL FIX: REPLACE privy_user_connections WITH canonical_users
-- =====================================================
-- This migration replaces ALL references to the deprecated privy_user_connections
-- table with canonical_users, which is now the single source of truth for user data.
--
-- The privy_user_connections table NO LONGER EXISTS in production.
-- All previous migrations that referenced it will fail.
--
-- This migration:
-- 1. Drops and recreates get_user_balance to use canonical_users
-- 2. Drops and recreates update_user_profile_by_identifier to use canonical_users
-- 3. Drops and recreates update_user_avatar to use canonical_users
-- 4. Grants proper permissions on canonical_users table
-- =====================================================

BEGIN;

-- =====================================================
-- STEP 1: RECREATE get_user_balance FUNCTION
-- =====================================================
-- Uses canonical_users instead of privy_user_connections

DROP FUNCTION IF EXISTS get_user_balance(TEXT) CASCADE;

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

  -- Try 3: Fallback to canonical_users (the REAL user table)
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
Returns 0 if user not found or no balance. Never fails.';

-- =====================================================
-- STEP 2: RECREATE update_user_profile_by_identifier FUNCTION
-- =====================================================
-- Uses canonical_users instead of privy_user_connections

DROP FUNCTION IF EXISTS update_user_profile_by_identifier(text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION update_user_profile_by_identifier(
  user_identifier text,
  new_username text DEFAULT NULL,
  new_email text DEFAULT NULL,
  new_telegram_handle text DEFAULT NULL,
  new_country text DEFAULT NULL,
  new_telephone_number text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_uid_found TEXT;
  normalized_user_id text;
  search_wallet text;
  has_country_column boolean := false;
  has_telephone_column boolean := false;
  rows_updated integer := 0;
BEGIN
  -- Validate user_identifier is provided
  IF user_identifier IS NULL OR TRIM(user_identifier) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'User identifier is required');
  END IF;

  -- Normalize for comparison (lowercase for wallet addresses)
  normalized_user_id := LOWER(TRIM(user_identifier));

  -- Extract wallet address from prize:pid: format if present
  IF user_identifier LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(user_identifier FROM 11));
  ELSIF user_identifier LIKE '0x%' AND LENGTH(user_identifier) = 42 THEN
    search_wallet := LOWER(user_identifier);
  ELSE
    search_wallet := NULL;
  END IF;

  -- Find user by various identifier columns including canonical_user_id
  SELECT uid INTO user_uid_found
  FROM canonical_users
  WHERE
    canonical_user_id = user_identifier
    OR canonical_user_id = LOWER(user_identifier)
    OR (search_wallet IS NOT NULL AND LOWER(wallet_address) = search_wallet)
    OR (search_wallet IS NOT NULL AND LOWER(base_wallet_address) = search_wallet)
    OR LOWER(COALESCE(wallet_address, '')) = normalized_user_id
    OR LOWER(COALESCE(base_wallet_address, '')) = normalized_user_id
    OR privy_user_id = user_identifier
    OR uid = user_identifier
  LIMIT 1;

  IF user_uid_found IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found for identifier: ' || LEFT(user_identifier, 20) || '...');
  END IF;

  -- Check if optional columns exist
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'canonical_users'
    AND column_name = 'country'
  ) INTO has_country_column;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'canonical_users'
    AND column_name = 'telephone_number'
  ) INTO has_telephone_column;

  -- Perform a direct UPDATE with only the profile fields
  IF has_country_column AND has_telephone_column THEN
    UPDATE canonical_users
    SET
      username = COALESCE(NULLIF(TRIM(new_username), ''), username),
      email = COALESCE(NULLIF(TRIM(new_email), ''), email),
      telegram_handle = CASE
        WHEN new_telegram_handle IS NOT NULL THEN TRIM(new_telegram_handle)
        ELSE telegram_handle
      END,
      country = COALESCE(NULLIF(TRIM(new_country), ''), country),
      telephone_number = CASE
        WHEN new_telephone_number IS NOT NULL THEN TRIM(new_telephone_number)
        ELSE telephone_number
      END,
      updated_at = NOW()
    WHERE uid = user_uid_found;
  ELSIF has_country_column THEN
    UPDATE canonical_users
    SET
      username = COALESCE(NULLIF(TRIM(new_username), ''), username),
      email = COALESCE(NULLIF(TRIM(new_email), ''), email),
      telegram_handle = CASE
        WHEN new_telegram_handle IS NOT NULL THEN TRIM(new_telegram_handle)
        ELSE telegram_handle
      END,
      country = COALESCE(NULLIF(TRIM(new_country), ''), country),
      updated_at = NOW()
    WHERE uid = user_uid_found;
  ELSE
    UPDATE canonical_users
    SET
      username = COALESCE(NULLIF(TRIM(new_username), ''), username),
      email = COALESCE(NULLIF(TRIM(new_email), ''), email),
      telegram_handle = CASE
        WHEN new_telegram_handle IS NOT NULL THEN TRIM(new_telegram_handle)
        ELSE telegram_handle
      END,
      updated_at = NOW()
    WHERE uid = user_uid_found;
  END IF;

  GET DIAGNOSTICS rows_updated = ROW_COUNT;

  IF rows_updated > 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'message', 'Profile updated successfully',
      'user_id', user_uid_found
    );
  ELSE
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No rows updated - user may have been deleted'
    );
  END IF;

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Database error: ' || SQLERRM,
      'detail', SQLSTATE
    );
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION update_user_profile_by_identifier(text, text, text, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION update_user_profile_by_identifier(text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION update_user_profile_by_identifier(text, text, text, text, text, text) TO service_role;

-- =====================================================
-- STEP 3: RECREATE update_user_avatar FUNCTION
-- =====================================================
-- Uses canonical_users instead of privy_user_connections

DROP FUNCTION IF EXISTS update_user_avatar(text, text);

CREATE OR REPLACE FUNCTION update_user_avatar(
  user_identifier text,
  new_avatar_url text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_uid_found TEXT;
  normalized_user_id text;
  search_wallet text;
  rows_updated integer;
BEGIN
  -- Validate inputs
  IF user_identifier IS NULL OR TRIM(user_identifier) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'User identifier is required');
  END IF;

  IF new_avatar_url IS NULL OR TRIM(new_avatar_url) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Avatar URL is required');
  END IF;

  -- Normalize for comparison
  normalized_user_id := LOWER(TRIM(user_identifier));

  -- Extract wallet address from prize:pid: format if present
  IF user_identifier LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(user_identifier FROM 11));
  ELSIF user_identifier LIKE '0x%' AND LENGTH(user_identifier) = 42 THEN
    search_wallet := LOWER(user_identifier);
  ELSE
    search_wallet := NULL;
  END IF;

  -- Find user
  SELECT uid INTO user_uid_found
  FROM canonical_users
  WHERE
    canonical_user_id = user_identifier
    OR canonical_user_id = LOWER(user_identifier)
    OR (search_wallet IS NOT NULL AND LOWER(wallet_address) = search_wallet)
    OR (search_wallet IS NOT NULL AND LOWER(base_wallet_address) = search_wallet)
    OR LOWER(COALESCE(wallet_address, '')) = normalized_user_id
    OR LOWER(COALESCE(base_wallet_address, '')) = normalized_user_id
    OR privy_user_id = user_identifier
    OR uid = user_identifier
  LIMIT 1;

  IF user_uid_found IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found');
  END IF;

  -- Update avatar
  UPDATE canonical_users
  SET
    avatar_url = TRIM(new_avatar_url),
    updated_at = NOW()
  WHERE uid = user_uid_found;

  GET DIAGNOSTICS rows_updated = ROW_COUNT;

  IF rows_updated > 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'message', 'Avatar updated successfully'
    );
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'Failed to update avatar');
  END IF;

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'Database error: ' || SQLERRM);
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION update_user_avatar(text, text) TO anon;
GRANT EXECUTE ON FUNCTION update_user_avatar(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION update_user_avatar(text, text) TO service_role;

-- =====================================================
-- STEP 4: GRANT PERMISSIONS ON canonical_users TABLE
-- =====================================================

GRANT SELECT ON public.canonical_users TO authenticated;
GRANT SELECT ON public.canonical_users TO anon;
GRANT SELECT ON public.canonical_users TO service_role;

-- Also grant SELECT on wallet_balances and sub_account_balances if they exist
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

-- =====================================================
-- STEP 5: CREATE INDEXES IF MISSING
-- =====================================================

-- Ensure indexes exist for efficient lookups on canonical_users
CREATE INDEX IF NOT EXISTS idx_canonical_users_canonical_user_id
  ON canonical_users(canonical_user_id);
CREATE INDEX IF NOT EXISTS idx_canonical_users_privy_user_id
  ON canonical_users(privy_user_id);
CREATE INDEX IF NOT EXISTS idx_canonical_users_wallet_address_lower
  ON canonical_users(LOWER(wallet_address));
CREATE INDEX IF NOT EXISTS idx_canonical_users_base_wallet_address_lower
  ON canonical_users(LOWER(base_wallet_address));
CREATE INDEX IF NOT EXISTS idx_canonical_users_uid
  ON canonical_users(uid);

-- =====================================================
-- VALIDATION
-- =====================================================

DO $$
DECLARE
  get_balance_exists BOOLEAN;
  update_profile_exists BOOLEAN;
  update_avatar_exists BOOLEAN;
  canonical_users_exists BOOLEAN;
BEGIN
  -- Check functions exist
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'get_user_balance'
  ) INTO get_balance_exists;

  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'update_user_profile_by_identifier'
  ) INTO update_profile_exists;

  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'update_user_avatar'
  ) INTO update_avatar_exists;

  -- Check canonical_users table exists
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'canonical_users'
  ) INTO canonical_users_exists;

  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'CANONICAL_USERS MIGRATION COMPLETE';
  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'get_user_balance function exists: %', get_balance_exists;
  RAISE NOTICE 'update_user_profile_by_identifier exists: %', update_profile_exists;
  RAISE NOTICE 'update_user_avatar exists: %', update_avatar_exists;
  RAISE NOTICE 'canonical_users table exists: %', canonical_users_exists;
  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'All privy_user_connections references replaced with canonical_users';
  RAISE NOTICE '=====================================================';

  IF NOT canonical_users_exists THEN
    RAISE EXCEPTION 'CRITICAL: canonical_users table does not exist!';
  END IF;

  IF NOT get_balance_exists OR NOT update_profile_exists OR NOT update_avatar_exists THEN
    RAISE EXCEPTION 'CRITICAL: One or more required functions were not created!';
  END IF;
END $$;

COMMIT;
