/*
  # Add base_wallet_address column to privy_user_connections

  This migration adds the missing base_wallet_address column that is referenced
  throughout the codebase but was never created in the initial schema.

  The base_wallet_address is used as the primary identifier for Base/CDP authenticated users,
  separate from the legacy wallet_address field which was used with Privy.

  ## Changes:
  1. Add base_wallet_address column to privy_user_connections table
  2. Add index for fast lookups by base_wallet_address
  3. Update the update_user_profile_by_identifier function to properly handle the column
*/

-- Add base_wallet_address column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'privy_user_connections'
    AND column_name = 'base_wallet_address'
  ) THEN
    ALTER TABLE privy_user_connections ADD COLUMN base_wallet_address text;
  END IF;
END $$;

-- Create index for fast lookups by base_wallet_address
CREATE INDEX IF NOT EXISTS idx_privy_user_connections_base_wallet_address
  ON privy_user_connections(base_wallet_address);

-- Drop and recreate the update_user_profile_by_identifier function
-- to properly handle the base_wallet_address column
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
  user_record RECORD;
  updated_count int;
  result jsonb;
BEGIN
  -- Validate user_identifier is provided
  IF user_identifier IS NULL OR user_identifier = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'User identifier is required');
  END IF;

  -- Find user by various identifier columns
  -- Includes base_wallet_address for Base/CDP authenticated users
  SELECT id, uid, wallet_address, base_wallet_address, privy_user_id
  INTO user_record
  FROM privy_user_connections
  WHERE wallet_address = user_identifier
     OR base_wallet_address = user_identifier
     OR privy_user_id = user_identifier
     OR uid = user_identifier
     OR id::text = user_identifier
  LIMIT 1;

  IF user_record IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found');
  END IF;

  -- Update user profile fields (only non-null values)
  UPDATE privy_user_connections
  SET
    username = COALESCE(new_username, username),
    email = COALESCE(new_email, email),
    telegram_handle = COALESCE(new_telegram_handle, telegram_handle),
    country = COALESCE(new_country, country),
    telephone_number = COALESCE(new_telephone_number, telephone_number),
    updated_at = NOW()
  WHERE id = user_record.id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;

  IF updated_count > 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'message', 'Profile updated successfully',
      'updated_fields', updated_count
    );
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'Failed to update profile');
  END IF;

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Grant execute permission to anonymous and authenticated users
GRANT EXECUTE ON FUNCTION update_user_profile_by_identifier(text, text, text, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION update_user_profile_by_identifier(text, text, text, text, text, text) TO authenticated;
