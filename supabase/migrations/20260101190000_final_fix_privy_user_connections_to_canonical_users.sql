-- =====================================================
-- FINAL FIX: REPLACE ALL privy_user_connections WITH canonical_users
-- =====================================================
-- The privy_user_connections table has been archived as privy_user_connections_archive.
-- All references must now use canonical_users, which is the primary user table.
--
-- This migration fixes the "Could not find table 'public.privy_user_connections'" error
-- by recreating all functions that previously referenced privy_user_connections to use
-- canonical_users instead.
-- =====================================================

BEGIN;

-- =====================================================
-- STEP 1: DROP AND RECREATE get_user_balance
-- =====================================================
-- This is the most critical function causing the 500 errors

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
  IF p_canonical_user_id LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(p_canonical_user_id FROM 11));
  ELSIF p_canonical_user_id LIKE '0x%' AND LENGTH(p_canonical_user_id) = 42 THEN
    search_wallet := LOWER(p_canonical_user_id);
  ELSE
    search_wallet := NULL;
  END IF;

  -- Try 1: Read from sub_account_balances (primary balance table)
  BEGIN
    SELECT COALESCE(available_balance, 0)::NUMERIC INTO user_balance
    FROM public.sub_account_balances
    WHERE currency = 'USD'
      AND (
        canonical_user_id = p_canonical_user_id
        OR canonical_user_id = LOWER(p_canonical_user_id)
        OR (search_wallet IS NOT NULL AND canonical_user_id = 'prize:pid:' || search_wallet)
        OR user_id = p_canonical_user_id
        OR privy_user_id = p_canonical_user_id
      )
    ORDER BY
      CASE
        WHEN canonical_user_id = p_canonical_user_id THEN 0
        WHEN canonical_user_id = LOWER(p_canonical_user_id) THEN 1
        ELSE 2
      END,
      available_balance DESC NULLS LAST
    LIMIT 1;

    IF user_balance IS NOT NULL AND user_balance > 0 THEN
      RETURN user_balance;
    END IF;
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;

  -- Try 2: Read from wallet_balances table
  BEGIN
    SELECT COALESCE(balance, 0)::NUMERIC INTO user_balance
    FROM public.wallet_balances
    WHERE
      canonical_user_id = p_canonical_user_id
      OR canonical_user_id = LOWER(p_canonical_user_id)
      OR (search_wallet IS NOT NULL AND LOWER(wallet_address) = search_wallet)
      OR (search_wallet IS NOT NULL AND LOWER(base_wallet_address) = search_wallet)
    ORDER BY
      CASE
        WHEN canonical_user_id = p_canonical_user_id THEN 0
        WHEN canonical_user_id = LOWER(p_canonical_user_id) THEN 1
        ELSE 2
      END,
      balance DESC NULLS LAST
    LIMIT 1;

    IF user_balance IS NOT NULL AND user_balance > 0 THEN
      RETURN user_balance;
    END IF;
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;

  -- Try 3: Read from canonical_users (the actual user table)
  BEGIN
    SELECT COALESCE(usdc_balance, 0)::NUMERIC INTO user_balance
    FROM public.canonical_users
    WHERE
      canonical_user_id = p_canonical_user_id
      OR canonical_user_id = LOWER(p_canonical_user_id)
      OR (search_wallet IS NOT NULL AND LOWER(wallet_address) = search_wallet)
      OR (search_wallet IS NOT NULL AND LOWER(base_wallet_address) = search_wallet)
      OR LOWER(wallet_address) = LOWER(p_canonical_user_id)
      OR privy_user_id = p_canonical_user_id
    ORDER BY
      CASE
        WHEN canonical_user_id = p_canonical_user_id THEN 0
        WHEN canonical_user_id = LOWER(p_canonical_user_id) THEN 1
        ELSE 2
      END,
      usdc_balance DESC NULLS LAST
    LIMIT 1;
  EXCEPTION WHEN undefined_table THEN
    user_balance := 0;
  END;

  RETURN COALESCE(user_balance, 0);
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'get_user_balance error for %: %', LEFT(p_canonical_user_id, 20), SQLERRM;
    RETURN 0;
END;
$$;

GRANT EXECUTE ON FUNCTION get_user_balance(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_balance(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_user_balance(TEXT) TO service_role;

COMMENT ON FUNCTION get_user_balance(TEXT) IS
'Get user balance from sub_account_balances, wallet_balances, or canonical_users. Never references privy_user_connections.';

-- =====================================================
-- STEP 2: DROP AND RECREATE credit_user_balance
-- =====================================================

DROP FUNCTION IF EXISTS credit_user_balance(TEXT, NUMERIC, TEXT) CASCADE;

CREATE OR REPLACE FUNCTION credit_user_balance(
  p_user_identifier TEXT,
  p_amount NUMERIC,
  p_reason TEXT DEFAULT 'credit'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_record RECORD;
  v_new_balance NUMERIC;
  v_search_wallet TEXT;
BEGIN
  -- Validate inputs
  IF p_user_identifier IS NULL OR p_user_identifier = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'User identifier is required');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be positive');
  END IF;

  -- Extract wallet address if needed
  IF p_user_identifier LIKE 'prize:pid:0x%' THEN
    v_search_wallet := LOWER(SUBSTRING(p_user_identifier FROM 11));
  ELSIF p_user_identifier LIKE '0x%' AND LENGTH(p_user_identifier) = 42 THEN
    v_search_wallet := LOWER(p_user_identifier);
  ELSE
    v_search_wallet := NULL;
  END IF;

  -- Find user in canonical_users
  SELECT id, uid, canonical_user_id, usdc_balance, wallet_address, base_wallet_address
  INTO v_user_record
  FROM public.canonical_users
  WHERE
    canonical_user_id = p_user_identifier
    OR canonical_user_id = LOWER(p_user_identifier)
    OR (v_search_wallet IS NOT NULL AND LOWER(wallet_address) = v_search_wallet)
    OR (v_search_wallet IS NOT NULL AND LOWER(base_wallet_address) = v_search_wallet)
    OR privy_user_id = p_user_identifier
  LIMIT 1;

  IF v_user_record IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found');
  END IF;

  -- Update balance in canonical_users
  UPDATE public.canonical_users
  SET
    usdc_balance = COALESCE(usdc_balance, 0) + p_amount,
    updated_at = NOW()
  WHERE id = v_user_record.id
  RETURNING usdc_balance INTO v_new_balance;

  -- Also update wallet_balances if it exists
  BEGIN
    UPDATE public.wallet_balances
    SET
      balance = COALESCE(balance, 0) + p_amount,
      updated_at = NOW()
    WHERE user_id = v_user_record.id;
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'new_balance', v_new_balance,
    'amount_credited', p_amount,
    'reason', p_reason
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION credit_user_balance(TEXT, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION credit_user_balance(TEXT, NUMERIC, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION credit_user_balance(TEXT, NUMERIC, TEXT) TO service_role;

-- =====================================================
-- STEP 3: DROP AND RECREATE debit_user_balance
-- =====================================================

DROP FUNCTION IF EXISTS debit_user_balance(TEXT, NUMERIC, TEXT) CASCADE;

CREATE OR REPLACE FUNCTION debit_user_balance(
  p_user_identifier TEXT,
  p_amount NUMERIC,
  p_reason TEXT DEFAULT 'debit'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_record RECORD;
  v_new_balance NUMERIC;
  v_search_wallet TEXT;
BEGIN
  -- Validate inputs
  IF p_user_identifier IS NULL OR p_user_identifier = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'User identifier is required');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be positive');
  END IF;

  -- Extract wallet address if needed
  IF p_user_identifier LIKE 'prize:pid:0x%' THEN
    v_search_wallet := LOWER(SUBSTRING(p_user_identifier FROM 11));
  ELSIF p_user_identifier LIKE '0x%' AND LENGTH(p_user_identifier) = 42 THEN
    v_search_wallet := LOWER(p_user_identifier);
  ELSE
    v_search_wallet := NULL;
  END IF;

  -- Find user in canonical_users
  SELECT id, uid, canonical_user_id, usdc_balance, wallet_address, base_wallet_address
  INTO v_user_record
  FROM public.canonical_users
  WHERE
    canonical_user_id = p_user_identifier
    OR canonical_user_id = LOWER(p_user_identifier)
    OR (v_search_wallet IS NOT NULL AND LOWER(wallet_address) = v_search_wallet)
    OR (v_search_wallet IS NOT NULL AND LOWER(base_wallet_address) = v_search_wallet)
    OR privy_user_id = p_user_identifier
  LIMIT 1;

  IF v_user_record IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found');
  END IF;

  -- Check sufficient balance
  IF COALESCE(v_user_record.usdc_balance, 0) < p_amount THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Insufficient balance',
      'current_balance', COALESCE(v_user_record.usdc_balance, 0),
      'required', p_amount
    );
  END IF;

  -- Update balance in canonical_users
  UPDATE public.canonical_users
  SET
    usdc_balance = COALESCE(usdc_balance, 0) - p_amount,
    updated_at = NOW()
  WHERE id = v_user_record.id
  RETURNING usdc_balance INTO v_new_balance;

  -- Also update wallet_balances if it exists
  BEGIN
    UPDATE public.wallet_balances
    SET
      balance = COALESCE(balance, 0) - p_amount,
      updated_at = NOW()
    WHERE user_id = v_user_record.id;
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'new_balance', v_new_balance,
    'amount_debited', p_amount,
    'reason', p_reason
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION debit_user_balance(TEXT, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION debit_user_balance(TEXT, NUMERIC, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION debit_user_balance(TEXT, NUMERIC, TEXT) TO service_role;

-- =====================================================
-- STEP 4: DROP AND RECREATE update_user_profile_by_identifier
-- =====================================================

DROP FUNCTION IF EXISTS update_user_profile_by_identifier(text, text, text, text, text, text) CASCADE;

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
  search_wallet text;
  rows_updated integer := 0;
BEGIN
  IF user_identifier IS NULL OR TRIM(user_identifier) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'User identifier is required');
  END IF;

  -- Extract wallet address
  IF user_identifier LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(user_identifier FROM 11));
  ELSIF user_identifier LIKE '0x%' AND LENGTH(user_identifier) = 42 THEN
    search_wallet := LOWER(user_identifier);
  ELSE
    search_wallet := NULL;
  END IF;

  -- Find user in canonical_users
  SELECT uid INTO user_uid_found
  FROM canonical_users
  WHERE
    canonical_user_id = user_identifier
    OR canonical_user_id = LOWER(user_identifier)
    OR (search_wallet IS NOT NULL AND LOWER(wallet_address) = search_wallet)
    OR (search_wallet IS NOT NULL AND LOWER(base_wallet_address) = search_wallet)
    OR privy_user_id = user_identifier
    OR uid = user_identifier
  LIMIT 1;

  IF user_uid_found IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found');
  END IF;

  -- Update profile
  UPDATE canonical_users
  SET
    username = COALESCE(NULLIF(TRIM(new_username), ''), username),
    email = COALESCE(NULLIF(TRIM(new_email), ''), email),
    telegram_handle = CASE WHEN new_telegram_handle IS NOT NULL THEN TRIM(new_telegram_handle) ELSE telegram_handle END,
    country = COALESCE(NULLIF(TRIM(new_country), ''), country),
    telephone_number = CASE WHEN new_telephone_number IS NOT NULL THEN TRIM(new_telephone_number) ELSE telephone_number END,
    updated_at = NOW()
  WHERE uid = user_uid_found;

  GET DIAGNOSTICS rows_updated = ROW_COUNT;

  IF rows_updated > 0 THEN
    RETURN jsonb_build_object('success', true, 'message', 'Profile updated', 'user_id', user_uid_found);
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'No rows updated');
  END IF;

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION update_user_profile_by_identifier(text, text, text, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION update_user_profile_by_identifier(text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION update_user_profile_by_identifier(text, text, text, text, text, text) TO service_role;

-- =====================================================
-- STEP 5: DROP AND RECREATE update_user_avatar
-- =====================================================

DROP FUNCTION IF EXISTS update_user_avatar(text, text) CASCADE;

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
  search_wallet text;
  rows_updated integer;
BEGIN
  IF user_identifier IS NULL OR TRIM(user_identifier) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'User identifier is required');
  END IF;

  IF new_avatar_url IS NULL OR TRIM(new_avatar_url) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Avatar URL is required');
  END IF;

  -- Extract wallet address
  IF user_identifier LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(user_identifier FROM 11));
  ELSIF user_identifier LIKE '0x%' AND LENGTH(user_identifier) = 42 THEN
    search_wallet := LOWER(user_identifier);
  ELSE
    search_wallet := NULL;
  END IF;

  -- Find user in canonical_users
  SELECT uid INTO user_uid_found
  FROM canonical_users
  WHERE
    canonical_user_id = user_identifier
    OR canonical_user_id = LOWER(user_identifier)
    OR (search_wallet IS NOT NULL AND LOWER(wallet_address) = search_wallet)
    OR (search_wallet IS NOT NULL AND LOWER(base_wallet_address) = search_wallet)
    OR privy_user_id = user_identifier
    OR uid = user_identifier
  LIMIT 1;

  IF user_uid_found IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found');
  END IF;

  -- Update avatar
  UPDATE canonical_users
  SET avatar_url = TRIM(new_avatar_url), updated_at = NOW()
  WHERE uid = user_uid_found;

  GET DIAGNOSTICS rows_updated = ROW_COUNT;

  IF rows_updated > 0 THEN
    RETURN jsonb_build_object('success', true, 'message', 'Avatar updated');
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'Failed to update avatar');
  END IF;

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION update_user_avatar(text, text) TO anon;
GRANT EXECUTE ON FUNCTION update_user_avatar(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION update_user_avatar(text, text) TO service_role;

-- =====================================================
-- STEP 6: ENSURE canonical_users TABLE HAS PROPER GRANTS
-- =====================================================

GRANT SELECT ON public.canonical_users TO authenticated;
GRANT SELECT ON public.canonical_users TO anon;
GRANT SELECT, INSERT, UPDATE ON public.canonical_users TO service_role;

-- Grant on wallet_balances if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'wallet_balances') THEN
    EXECUTE 'GRANT SELECT ON public.wallet_balances TO authenticated';
    EXECUTE 'GRANT SELECT ON public.wallet_balances TO anon';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON public.wallet_balances TO service_role';
  END IF;
END $$;

-- Grant on sub_account_balances if it exists
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
CREATE INDEX IF NOT EXISTS idx_canonical_users_wallet_address_lower ON canonical_users(LOWER(wallet_address));
CREATE INDEX IF NOT EXISTS idx_canonical_users_base_wallet_address_lower ON canonical_users(LOWER(base_wallet_address));
CREATE INDEX IF NOT EXISTS idx_canonical_users_uid ON canonical_users(uid);

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

  -- Count our functions
  SELECT COUNT(*) INTO func_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.proname IN ('get_user_balance', 'credit_user_balance', 'debit_user_balance', 'update_user_profile_by_identifier', 'update_user_avatar');

  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'FINAL FIX FOR privy_user_connections -> canonical_users';
  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'canonical_users table exists: %', canonical_exists;
  RAISE NOTICE 'Functions created/updated: %', func_count;
  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'All references to privy_user_connections have been replaced.';
  RAISE NOTICE 'The following functions now use canonical_users:';
  RAISE NOTICE '  - get_user_balance';
  RAISE NOTICE '  - credit_user_balance';
  RAISE NOTICE '  - debit_user_balance';
  RAISE NOTICE '  - update_user_profile_by_identifier';
  RAISE NOTICE '  - update_user_avatar';
  RAISE NOTICE '=====================================================';

  IF NOT canonical_exists THEN
    RAISE EXCEPTION 'CRITICAL: canonical_users table does not exist!';
  END IF;
END $$;

COMMIT;
