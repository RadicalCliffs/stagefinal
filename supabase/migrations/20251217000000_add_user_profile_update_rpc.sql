/*
  # Add RPC function for user profile updates

  This migration adds a SECURITY DEFINER function to allow users to update their own profile
  information using their wallet address as the identifier. This bypasses RLS since the frontend
  uses anonymous Supabase access.

  The function validates the user exists and only allows updating specific safe fields.

  NOTE: This function dynamically checks if country/telephone_number columns exist before updating
  them, to handle cases where column migration may not have run yet.
*/

-- Drop existing function if it exists
DROP FUNCTION IF EXISTS update_user_profile_by_identifier(text, text, text, text, text, text);

-- Create function to update user profile
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
  updated_count int;
  has_country_column boolean;
  has_telephone_column boolean;
  update_sql text;
BEGIN
  -- Validate user_identifier is provided
  IF user_identifier IS NULL OR user_identifier = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'User identifier is required');
  END IF;

  -- Normalize for comparison (lowercase for wallet addresses)
  normalized_user_id := LOWER(TRIM(user_identifier));

  -- Find user by various identifier columns (case-insensitive for wallet addresses)
  SELECT id, uid, wallet_address, base_wallet_address, privy_user_id
  INTO user_record
  FROM privy_user_connections
  WHERE LOWER(wallet_address) = normalized_user_id
     OR LOWER(base_wallet_address) = normalized_user_id
     OR privy_user_id = user_identifier
     OR uid = user_identifier
     OR id::text = user_identifier
  LIMIT 1;

  IF user_record IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found');
  END IF;

  -- Check if country and telephone_number columns exist
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

  -- Build dynamic update SQL based on which columns exist
  update_sql := 'UPDATE privy_user_connections SET
    username = COALESCE(NULLIF(TRIM($2), ''''), username),
    email = COALESCE(NULLIF(TRIM($3), ''''), email),
    telegram_handle = COALESCE(NULLIF(TRIM($4), ''''), telegram_handle)';

  IF has_country_column THEN
    update_sql := update_sql || ', country = COALESCE(NULLIF(TRIM($5), ''''), country)';
  END IF;

  IF has_telephone_column THEN
    update_sql := update_sql || ', telephone_number = COALESCE(NULLIF(TRIM($6), ''''), telephone_number)';
  END IF;

  update_sql := update_sql || ', updated_at = NOW() WHERE id = $1';

  -- Execute the dynamic update
  EXECUTE update_sql USING user_record.id, new_username, new_email, new_telegram_handle, new_country, new_telephone_number;

  GET DIAGNOSTICS updated_count = ROW_COUNT;

  IF updated_count > 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'message', 'Profile updated successfully',
      'updated_fields', updated_count,
      'has_country_column', has_country_column,
      'has_telephone_column', has_telephone_column
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
