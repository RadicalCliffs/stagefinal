-- =====================================================
-- FIX PROFILE UPDATE TO SUPPORT CANONICAL USER ID
-- =====================================================
-- The update_user_profile_by_identifier function was not checking
-- the canonical_user_id column when looking up users.
--
-- When userDataService.updateUserProfile calls this RPC with
-- 'prize:pid:0x...' format (from toPrizePid), it fails to find
-- the user because canonical_user_id was not in the WHERE clause.
--
-- This migration adds canonical_user_id to the user lookup.
-- =====================================================

-- Drop existing function first
DROP FUNCTION IF EXISTS update_user_profile_by_identifier(text, text, text, text, text, text);

-- Create robust profile update function with canonical_user_id support
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
  user_record RECORD;
  normalized_user_id text;
  search_wallet text;
  has_country_column boolean := false;
  has_telephone_column boolean := false;
  update_parts text[] := ARRAY[]::text[];
  final_sql text;
  updated_count int := 0;
BEGIN
  -- Validate user_identifier is provided
  IF user_identifier IS NULL OR TRIM(user_identifier) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'User identifier is required');
  END IF;

  -- Normalize for comparison (lowercase for wallet addresses)
  normalized_user_id := LOWER(TRIM(user_identifier));

  -- Extract wallet address from prize:pid: format if present
  -- e.g., 'prize:pid:0x1234...' -> '0x1234...'
  IF user_identifier LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(user_identifier FROM 11));
  ELSIF user_identifier LIKE '0x%' AND LENGTH(user_identifier) = 42 THEN
    search_wallet := LOWER(user_identifier);
  ELSE
    search_wallet := NULL;
  END IF;

  -- Find user by various identifier columns including canonical_user_id
  SELECT id, uid, wallet_address, base_wallet_address, privy_user_id, canonical_user_id
  INTO user_record
  FROM privy_user_connections
  WHERE
    -- Match by canonical_user_id (PRIMARY for new system)
    canonical_user_id = user_identifier
    OR canonical_user_id = LOWER(user_identifier)
    -- Match by extracted wallet address from prize:pid:
    OR (search_wallet IS NOT NULL AND LOWER(wallet_address) = search_wallet)
    OR (search_wallet IS NOT NULL AND LOWER(base_wallet_address) = search_wallet)
    -- Legacy identifier matches
    OR LOWER(COALESCE(wallet_address, '')) = normalized_user_id
    OR LOWER(COALESCE(base_wallet_address, '')) = normalized_user_id
    OR privy_user_id = user_identifier
    OR uid = user_identifier
    OR id::text = user_identifier
  LIMIT 1;

  IF user_record IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found for identifier: ' || LEFT(user_identifier, 20) || '...');
  END IF;

  -- Check if optional columns exist in the database
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'privy_user_connections'
    AND column_name = 'country'
  ) INTO has_country_column;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'privy_user_connections'
    AND column_name = 'telephone_number'
  ) INTO has_telephone_column;

  -- Build update parts array based on what's provided and what columns exist
  -- Always include base columns (username, email, telegram_handle)
  IF new_username IS NOT NULL AND TRIM(new_username) != '' THEN
    update_parts := array_append(update_parts, format('username = %L', TRIM(new_username)));
  END IF;

  IF new_email IS NOT NULL AND TRIM(new_email) != '' THEN
    update_parts := array_append(update_parts, format('email = %L', TRIM(new_email)));
  END IF;

  IF new_telegram_handle IS NOT NULL AND TRIM(new_telegram_handle) != '' THEN
    update_parts := array_append(update_parts, format('telegram_handle = %L', TRIM(new_telegram_handle)));
  END IF;

  -- Only add country if column exists and value is provided
  IF has_country_column AND new_country IS NOT NULL AND TRIM(new_country) != '' THEN
    update_parts := array_append(update_parts, format('country = %L', TRIM(new_country)));
  END IF;

  -- Only add telephone_number if column exists and value is provided
  IF has_telephone_column AND new_telephone_number IS NOT NULL AND TRIM(new_telephone_number) != '' THEN
    update_parts := array_append(update_parts, format('telephone_number = %L', TRIM(new_telephone_number)));
  END IF;

  -- If no updates to make, return success with message
  IF array_length(update_parts, 1) IS NULL OR array_length(update_parts, 1) = 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'message', 'No changes to apply',
      'has_country_column', has_country_column,
      'has_telephone_column', has_telephone_column
    );
  END IF;

  -- Add updated_at timestamp
  update_parts := array_append(update_parts, 'updated_at = NOW()');

  -- Build and execute the dynamic SQL
  final_sql := format(
    'UPDATE privy_user_connections SET %s WHERE id = %L',
    array_to_string(update_parts, ', '),
    user_record.id
  );

  EXECUTE final_sql;
  GET DIAGNOSTICS updated_count = ROW_COUNT;

  IF updated_count > 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'message', 'Profile updated successfully',
      'updated_fields', array_length(update_parts, 1) - 1, -- minus updated_at
      'has_country_column', has_country_column,
      'has_telephone_column', has_telephone_column
    );
  ELSE
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Failed to update profile - no rows affected',
      'has_country_column', has_country_column,
      'has_telephone_column', has_telephone_column
    );
  END IF;

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Database error: ' || SQLERRM,
      'has_country_column', has_country_column,
      'has_telephone_column', has_telephone_column
    );
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION update_user_profile_by_identifier(text, text, text, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION update_user_profile_by_identifier(text, text, text, text, text, text) TO authenticated;


-- =====================================================
-- Also fix update_user_avatar to support canonical_user_id
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
  user_record RECORD;
  normalized_user_id text;
  search_wallet text;
  updated_count int;
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

  -- Find user by various identifier columns including canonical_user_id
  SELECT id
  INTO user_record
  FROM privy_user_connections
  WHERE
    -- Match by canonical_user_id (PRIMARY for new system)
    canonical_user_id = user_identifier
    OR canonical_user_id = LOWER(user_identifier)
    -- Match by extracted wallet address from prize:pid:
    OR (search_wallet IS NOT NULL AND LOWER(wallet_address) = search_wallet)
    OR (search_wallet IS NOT NULL AND LOWER(base_wallet_address) = search_wallet)
    -- Legacy matches
    OR LOWER(COALESCE(wallet_address, '')) = normalized_user_id
    OR LOWER(COALESCE(base_wallet_address, '')) = normalized_user_id
    OR privy_user_id = user_identifier
    OR uid = user_identifier
    OR id::text = user_identifier
  LIMIT 1;

  IF user_record IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found');
  END IF;

  -- Update avatar
  UPDATE privy_user_connections
  SET
    avatar_url = TRIM(new_avatar_url),
    updated_at = NOW()
  WHERE id = user_record.id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;

  IF updated_count > 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'message', 'Avatar updated successfully'
    );
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'Failed to update avatar');
  END IF;

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION update_user_avatar(text, text) TO anon;
GRANT EXECUTE ON FUNCTION update_user_avatar(text, text) TO authenticated;
