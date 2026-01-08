/*
  # Fix Profile Update - Ensure columns exist and RPC handles them properly

  This migration fixes the "column country does not exist" error by:
  1. Ensuring the country and telephone_number columns exist on privy_user_connections
  2. Creating a robust RPC function that handles the update WITHOUT referencing
     optional columns directly - it uses dynamic SQL to only update columns that exist
  3. Adding proper error handling
*/

-- ============================================================================
-- PART 1: Ensure columns exist on privy_user_connections
-- ============================================================================

-- Add country column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'privy_user_connections'
    AND column_name = 'country'
  ) THEN
    ALTER TABLE privy_user_connections ADD COLUMN country text;
    COMMENT ON COLUMN privy_user_connections.country IS 'User''s country';
  END IF;
END $$;

-- Add telephone_number column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'privy_user_connections'
    AND column_name = 'telephone_number'
  ) THEN
    ALTER TABLE privy_user_connections ADD COLUMN telephone_number text;
    COMMENT ON COLUMN privy_user_connections.telephone_number IS 'User''s phone number';
  END IF;
END $$;

-- Create index on country for geographic queries
CREATE INDEX IF NOT EXISTS idx_privy_user_connections_country
  ON privy_user_connections(country);


-- ============================================================================
-- PART 2: Create robust profile update RPC function
-- ============================================================================

-- Drop existing function first
DROP FUNCTION IF EXISTS update_user_profile_by_identifier(text, text, text, text, text, text);

-- Create robust profile update function
-- This function dynamically builds the UPDATE statement based on available columns
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

  -- Find user by various identifier columns (case-insensitive for wallet addresses)
  SELECT id, uid, wallet_address, base_wallet_address, privy_user_id
  INTO user_record
  FROM privy_user_connections
  WHERE LOWER(COALESCE(wallet_address, '')) = normalized_user_id
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


-- ============================================================================
-- PART 3: Ensure avatar update function also exists and works
-- ============================================================================

-- Drop and recreate update_user_avatar function
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

  -- Find user by various identifier columns (case-insensitive for addresses)
  SELECT id
  INTO user_record
  FROM privy_user_connections
  WHERE LOWER(COALESCE(wallet_address, '')) = normalized_user_id
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
