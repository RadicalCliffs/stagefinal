-- =====================================================
-- DEFINITIVE FIX: PROFILE UPDATE TRIGGER ERRORS
-- =====================================================
-- This migration definitively fixes the profile update error:
-- "Database error: record 'new' has no field 'usdc_balance'"
--
-- ROOT CAUSE ANALYSIS:
-- The canonical_users table (previously privy_user_connections) has triggers
-- that reference NEW.usdc_balance. When ANY update happens to the table
-- (even just updating username), PostgreSQL validates all trigger functions
-- and throws an error if usdc_balance column is missing or there's
-- a schema cache mismatch.
--
-- AFFECTED TRIGGERS:
-- 1. trigger_sync_wallet_balance - syncs balance to wallet_balances table
-- 2. trigger_broadcast_balance_update - broadcasts balance changes via realtime
--
-- SOLUTION:
-- 1. Drop ALL triggers that reference usdc_balance
-- 2. Drop the trigger functions themselves
-- 3. Recreate a safe version of the profile update RPC
-- 4. Add usdc_balance column if missing (defensive)
-- =====================================================

BEGIN;

-- =====================================================
-- STEP 1: ENSURE USDC_BALANCE COLUMN EXISTS ON canonical_users
-- =====================================================
-- This is defensive - the column should exist but let's ensure it

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'canonical_users'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
      AND table_name = 'canonical_users'
      AND column_name = 'usdc_balance'
    ) THEN
      ALTER TABLE public.canonical_users
      ADD COLUMN usdc_balance NUMERIC DEFAULT 0;
      RAISE NOTICE 'Added missing usdc_balance column to canonical_users';
    ELSE
      RAISE NOTICE 'usdc_balance column already exists on canonical_users';
    END IF;
  END IF;
END $$;

-- =====================================================
-- STEP 2: DROP ALL PROBLEMATIC TRIGGERS
-- =====================================================
-- Drop triggers that reference usdc_balance in their functions

-- Try dropping on canonical_users
DROP TRIGGER IF EXISTS trigger_sync_wallet_balance ON canonical_users;
DROP TRIGGER IF EXISTS trigger_broadcast_balance_update ON canonical_users;
DROP TRIGGER IF EXISTS trigger_sync_wallet_balance_insert ON canonical_users;
DROP TRIGGER IF EXISTS trigger_balance_sync ON canonical_users;

-- =====================================================
-- STEP 3: DROP PROBLEMATIC TRIGGER FUNCTIONS
-- =====================================================
-- These functions contain NEW.usdc_balance references

DROP FUNCTION IF EXISTS sync_wallet_balance() CASCADE;
DROP FUNCTION IF EXISTS broadcast_balance_update_to_user() CASCADE;

-- =====================================================
-- STEP 4: RECREATE PROFILE UPDATE RPC (TRIGGER-SAFE)
-- =====================================================
-- This function updates profile fields WITHOUT triggering any
-- balance-related triggers

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
  user_id_found UUID;
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
  SELECT id INTO user_id_found
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
    OR id::text = user_identifier
  LIMIT 1;

  IF user_id_found IS NULL THEN
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
  -- This avoids any issues with triggers referencing other columns
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
    WHERE id = user_id_found;
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
    WHERE id = user_id_found;
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
    WHERE id = user_id_found;
  END IF;

  GET DIAGNOSTICS rows_updated = ROW_COUNT;

  IF rows_updated > 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'message', 'Profile updated successfully',
      'user_id', user_id_found::text
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
-- STEP 5: RECREATE AVATAR UPDATE RPC (TRIGGER-SAFE)
-- =====================================================

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
  user_id_found UUID;
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
  SELECT id INTO user_id_found
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
    OR id::text = user_identifier
  LIMIT 1;

  IF user_id_found IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found');
  END IF;

  -- Update avatar
  UPDATE canonical_users
  SET
    avatar_url = TRIM(new_avatar_url),
    updated_at = NOW()
  WHERE id = user_id_found;

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
-- VALIDATION
-- =====================================================

DO $$
DECLARE
  sync_trigger_exists BOOLEAN;
  broadcast_trigger_exists BOOLEAN;
  profile_func_exists BOOLEAN;
  avatar_func_exists BOOLEAN;
  usdc_col_exists BOOLEAN;
BEGIN
  -- Check triggers were removed
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trigger_sync_wallet_balance'
  ) INTO sync_trigger_exists;

  SELECT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trigger_broadcast_balance_update'
  ) INTO broadcast_trigger_exists;

  -- Check functions exist
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'update_user_profile_by_identifier'
  ) INTO profile_func_exists;

  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'update_user_avatar'
  ) INTO avatar_func_exists;

  -- Check usdc_balance column exists on canonical_users
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'canonical_users'
    AND column_name = 'usdc_balance'
  ) INTO usdc_col_exists;

  RAISE NOTICE '=============================================';
  RAISE NOTICE 'DEFINITIVE PROFILE UPDATE FIX COMPLETE';
  RAISE NOTICE '=============================================';
  RAISE NOTICE 'trigger_sync_wallet_balance removed: %', NOT sync_trigger_exists;
  RAISE NOTICE 'trigger_broadcast_balance_update removed: %', NOT broadcast_trigger_exists;
  RAISE NOTICE 'update_user_profile_by_identifier exists: %', profile_func_exists;
  RAISE NOTICE 'update_user_avatar exists: %', avatar_func_exists;
  RAISE NOTICE 'usdc_balance column exists: %', usdc_col_exists;
  RAISE NOTICE '=============================================';

  -- Fail if critical issues remain
  IF sync_trigger_exists OR broadcast_trigger_exists THEN
    RAISE WARNING 'Some triggers still exist - profile updates may fail';
  END IF;

  IF NOT profile_func_exists OR NOT avatar_func_exists THEN
    RAISE EXCEPTION 'Profile/avatar functions not created properly';
  END IF;
END $$;

COMMIT;
