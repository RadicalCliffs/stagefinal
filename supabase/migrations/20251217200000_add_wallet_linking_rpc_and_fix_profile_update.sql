/*
  # Add wallet linking RPC and fix profile update case sensitivity

  This migration fixes two issues that prevent account updates and wallet linking:

  1. **Wallet Linking Issue**: The frontend attempts direct UPDATE operations on
     privy_user_connections, but RLS policies only allow 'authenticated' users where
     privy_user_id matches JWT claims. Base/CDP auth uses 'anon' access with wallet
     addresses, so direct updates fail. Solution: Create SECURITY DEFINER RPC functions.

  2. **Profile Update Case Sensitivity**: The update_user_profile_by_identifier function
     uses exact string comparison for wallet addresses, but Ethereum addresses can be
     checksummed (mixed case) or lowercase. Solution: Use case-insensitive comparison.

  ## Changes:
  1. Create link_external_wallet RPC function with SECURITY DEFINER
  2. Create unlink_external_wallet RPC function with SECURITY DEFINER
  3. Recreate update_user_profile_by_identifier with case-insensitive address matching
*/

-- ============================================================================
-- PART 1: Create wallet linking RPC functions
-- ============================================================================

-- Function to link an external wallet address to a user's account
CREATE OR REPLACE FUNCTION link_external_wallet(
  user_identifier text,
  wallet_address_to_link text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_record RECORD;
  normalized_user_id text;
  normalized_wallet text;
  updated_count int;
BEGIN
  -- Validate inputs
  IF user_identifier IS NULL OR user_identifier = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'User identifier is required');
  END IF;

  IF wallet_address_to_link IS NULL OR wallet_address_to_link = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Wallet address is required');
  END IF;

  -- Normalize addresses to lowercase for comparison
  normalized_user_id := LOWER(TRIM(user_identifier));
  normalized_wallet := TRIM(wallet_address_to_link);

  -- Validate wallet address format (0x followed by 40 hex characters)
  IF NOT normalized_wallet ~* '^0x[a-f0-9]{40}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid wallet address format');
  END IF;

  -- Find user by various identifier columns (case-insensitive for addresses)
  SELECT id, wallet_address, base_wallet_address, privy_user_id, linked_external_wallet
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

  -- Check if user already has a linked external wallet
  IF user_record.linked_external_wallet IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'An external wallet is already linked. Please unlink it first.');
  END IF;

  -- Prevent linking own primary wallet
  IF LOWER(normalized_wallet) = LOWER(COALESCE(user_record.wallet_address, ''))
     OR LOWER(normalized_wallet) = LOWER(COALESCE(user_record.base_wallet_address, '')) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot link your own primary wallet address');
  END IF;

  -- Check if wallet is already linked to another user
  IF EXISTS (
    SELECT 1 FROM privy_user_connections
    WHERE LOWER(linked_external_wallet) = LOWER(normalized_wallet)
      AND id != user_record.id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'This wallet is already linked to another account');
  END IF;

  -- Link the wallet
  UPDATE privy_user_connections
  SET
    linked_external_wallet = normalized_wallet,
    updated_at = NOW()
  WHERE id = user_record.id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;

  IF updated_count > 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'message', 'External wallet linked successfully',
      'linked_wallet', normalized_wallet
    );
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'Failed to link wallet');
  END IF;

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Function to unlink an external wallet from a user's account
CREATE OR REPLACE FUNCTION unlink_external_wallet(
  user_identifier text
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
  IF user_identifier IS NULL OR user_identifier = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'User identifier is required');
  END IF;

  -- Normalize for comparison
  normalized_user_id := LOWER(TRIM(user_identifier));

  -- Find user by various identifier columns (case-insensitive for addresses)
  SELECT id, linked_external_wallet
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

  -- Check if there's a wallet to unlink
  IF user_record.linked_external_wallet IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No external wallet is currently linked');
  END IF;

  -- Unlink the wallet
  UPDATE privy_user_connections
  SET
    linked_external_wallet = NULL,
    updated_at = NOW()
  WHERE id = user_record.id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;

  IF updated_count > 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'message', 'External wallet unlinked successfully'
    );
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'Failed to unlink wallet');
  END IF;

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Function to get linked external wallet for a user
CREATE OR REPLACE FUNCTION get_linked_external_wallet(
  user_identifier text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_record RECORD;
  normalized_user_id text;
BEGIN
  -- Validate inputs
  IF user_identifier IS NULL OR user_identifier = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'User identifier is required');
  END IF;

  -- Normalize for comparison
  normalized_user_id := LOWER(TRIM(user_identifier));

  -- Find user by various identifier columns (case-insensitive for addresses)
  SELECT id, linked_external_wallet
  INTO user_record
  FROM privy_user_connections
  WHERE LOWER(wallet_address) = normalized_user_id
     OR LOWER(base_wallet_address) = normalized_user_id
     OR privy_user_id = user_identifier
     OR uid = user_identifier
     OR id::text = user_identifier
  LIMIT 1;

  IF user_record IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found', 'linked_wallet', null);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'linked_wallet', user_record.linked_external_wallet
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'linked_wallet', null);
END;
$$;

-- Grant execute permissions to anon and authenticated roles
GRANT EXECUTE ON FUNCTION link_external_wallet(text, text) TO anon;
GRANT EXECUTE ON FUNCTION link_external_wallet(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION unlink_external_wallet(text) TO anon;
GRANT EXECUTE ON FUNCTION unlink_external_wallet(text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_linked_external_wallet(text) TO anon;
GRANT EXECUTE ON FUNCTION get_linked_external_wallet(text) TO authenticated;


-- ============================================================================
-- PART 2: Fix profile update function with case-insensitive matching
-- ============================================================================

-- Drop existing function to recreate with fixed logic
DROP FUNCTION IF EXISTS update_user_profile_by_identifier(text, text, text, text, text, text);

-- Recreate with case-insensitive wallet address matching
-- Also checks dynamically if country/telephone_number columns exist before updating
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

  -- Find user by various identifier columns
  -- Use case-insensitive comparison for wallet addresses
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

-- Re-grant execute permission to anonymous and authenticated users
GRANT EXECUTE ON FUNCTION update_user_profile_by_identifier(text, text, text, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION update_user_profile_by_identifier(text, text, text, text, text, text) TO authenticated;


-- ============================================================================
-- PART 3: Add avatar update RPC function
-- ============================================================================

-- Function to update user avatar
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
  IF user_identifier IS NULL OR user_identifier = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'User identifier is required');
  END IF;

  IF new_avatar_url IS NULL OR new_avatar_url = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Avatar URL is required');
  END IF;

  -- Normalize for comparison
  normalized_user_id := LOWER(TRIM(user_identifier));

  -- Find user by various identifier columns (case-insensitive for addresses)
  SELECT id
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
