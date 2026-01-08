-- =====================================================
-- FIX: TRIGGER COMPILATION ISSUE FOR PROFILE UPDATES
-- =====================================================
-- ROOT CAUSE:
-- The sync_wallet_balance trigger function was compiled with direct
-- references to NEW.usdc_balance. In PostgreSQL, if a trigger function
-- is compiled before a column exists (or if there's a schema cache issue),
-- accessing NEW.column_name fails with "record 'new' has no field X".
--
-- SOLUTION:
-- 1. Remove the problematic sync_wallet_balance trigger entirely from
--    canonical_users - it's not needed since we have the
--    wallet_balances table as the source of truth
-- 2. Create a cleaner profile update path that doesn't involve triggers
-- =====================================================

BEGIN;

-- =====================================================
-- PART 1: REMOVE PROBLEMATIC TRIGGERS
-- =====================================================
-- The sync_wallet_balance trigger is not necessary because:
-- - wallet_balances table is already populated via the edge function
-- - Balance changes go through the RPC/edge functions, not direct table updates
-- - The trigger causes cascading failures during simple profile updates

-- Try dropping on canonical_users
DROP TRIGGER IF EXISTS trigger_sync_wallet_balance ON canonical_users;
DROP FUNCTION IF EXISTS sync_wallet_balance() CASCADE;

-- Also remove the balance broadcast trigger that references columns that may not exist
DROP TRIGGER IF EXISTS trigger_broadcast_balance_update ON canonical_users;

-- =====================================================
-- PART 2: UPDATE PROFILE RPC TO BE TRIGGER-SAFE
-- =====================================================
-- Recreate the profile update function using canonical_users table

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
-- PART 3: ALSO FIX AVATAR UPDATE
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
-- PART 4: ENSURE WALLET BALANCE SYNC HAPPENS VIA RPC
-- =====================================================
-- Since we removed the trigger, ensure there's a way to sync balances

CREATE OR REPLACE FUNCTION sync_user_wallet_balance(
  p_user_id UUID,
  p_canonical_user_id TEXT DEFAULT NULL,
  p_wallet_address TEXT DEFAULT NULL,
  p_base_wallet_address TEXT DEFAULT NULL,
  p_balance NUMERIC DEFAULT NULL,
  p_has_used_new_user_bonus BOOLEAN DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_record RECORD;
BEGIN
  -- Get current user data if not all provided
  IF p_canonical_user_id IS NULL OR p_wallet_address IS NULL THEN
    SELECT
      canonical_user_id,
      wallet_address,
      base_wallet_address,
      COALESCE(usdc_balance, 0) as usdc_balance,
      COALESCE(has_used_new_user_bonus, false) as has_used_new_user_bonus
    INTO current_user_record
    FROM canonical_users
    WHERE id = p_user_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'User not found');
    END IF;
  END IF;

  -- Insert or update wallet_balances
  BEGIN
    INSERT INTO public.wallet_balances (
      user_id,
      canonical_user_id,
      wallet_address,
      base_wallet_address,
      balance,
      has_used_new_user_bonus,
      updated_at
    )
    VALUES (
      p_user_id,
      COALESCE(p_canonical_user_id, current_user_record.canonical_user_id),
      COALESCE(p_wallet_address, current_user_record.wallet_address),
      COALESCE(p_base_wallet_address, current_user_record.base_wallet_address),
      COALESCE(p_balance, current_user_record.usdc_balance, 0),
      COALESCE(p_has_used_new_user_bonus, current_user_record.has_used_new_user_bonus, false),
      NOW()
    )
    ON CONFLICT (user_id) DO UPDATE SET
      canonical_user_id = COALESCE(EXCLUDED.canonical_user_id, wallet_balances.canonical_user_id),
      wallet_address = COALESCE(EXCLUDED.wallet_address, wallet_balances.wallet_address),
      base_wallet_address = COALESCE(EXCLUDED.base_wallet_address, wallet_balances.base_wallet_address),
      balance = COALESCE(EXCLUDED.balance, wallet_balances.balance),
      has_used_new_user_bonus = COALESCE(EXCLUDED.has_used_new_user_bonus, wallet_balances.has_used_new_user_bonus),
      updated_at = NOW();
  EXCEPTION WHEN undefined_table THEN
    -- wallet_balances table doesn't exist
    RETURN jsonb_build_object('success', false, 'error', 'wallet_balances table does not exist');
  END;

  RETURN jsonb_build_object('success', true, 'message', 'Balance synced');
END;
$$;

GRANT EXECUTE ON FUNCTION sync_user_wallet_balance(UUID, TEXT, TEXT, TEXT, NUMERIC, BOOLEAN) TO service_role;

-- =====================================================
-- VALIDATION
-- =====================================================

DO $$
DECLARE
  trigger_exists BOOLEAN;
  profile_func_exists BOOLEAN;
  avatar_func_exists BOOLEAN;
BEGIN
  -- Check trigger was removed
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trigger_sync_wallet_balance'
  ) INTO trigger_exists;

  -- Check profile function exists
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'update_user_profile_by_identifier'
  ) INTO profile_func_exists;

  -- Check avatar function exists
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'update_user_avatar'
  ) INTO avatar_func_exists;

  RAISE NOTICE '=============================================';
  RAISE NOTICE 'PROFILE UPDATE TRIGGER FIX COMPLETE';
  RAISE NOTICE '=============================================';
  RAISE NOTICE 'trigger_sync_wallet_balance removed: %', NOT trigger_exists;
  RAISE NOTICE 'update_user_profile_by_identifier exists: %', profile_func_exists;
  RAISE NOTICE 'update_user_avatar exists: %', avatar_func_exists;
  RAISE NOTICE '=============================================';
  RAISE NOTICE 'All functions now use canonical_users table';
  RAISE NOTICE '=============================================';
END $$;

COMMIT;
