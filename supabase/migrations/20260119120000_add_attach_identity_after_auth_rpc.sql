-- ============================================================================
-- ADD MISSING attach_identity_after_auth RPC FUNCTION
-- ============================================================================
-- This RPC function handles identity attachment and profile linking after
-- a user successfully authenticates with their wallet.
--
-- It is called from:
-- 1. BaseWalletAuthModal.tsx (after wallet linking)
-- 2. upsert-user edge function (after user creation)
--
-- Purpose:
-- - Link wallet address to canonical user record
-- - Merge prior signup payload data into user profile
-- - Ensure profiles table is synced with canonical_users
--
-- Date: 2026-01-19
-- ============================================================================

BEGIN;

-- Drop function if it exists to ensure clean creation
DROP FUNCTION IF EXISTS attach_identity_after_auth(
  text, text, text, text, jsonb, text, text
);

-- Create the attach_identity_after_auth RPC function
CREATE OR REPLACE FUNCTION attach_identity_after_auth(
  in_canonical_user_id text,
  in_wallet_address text,
  in_email text,
  in_privy_user_id text,
  in_prior_payload jsonb DEFAULT NULL,
  in_base_wallet_address text DEFAULT NULL,
  in_eth_wallet_address text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid;
  v_result jsonb;
BEGIN
  -- Normalize inputs
  in_wallet_address := LOWER(TRIM(in_wallet_address));
  in_email := LOWER(TRIM(in_email));
  in_base_wallet_address := COALESCE(LOWER(TRIM(in_base_wallet_address)), in_wallet_address);
  in_eth_wallet_address := COALESCE(LOWER(TRIM(in_eth_wallet_address)), in_wallet_address);
  
  -- Log the operation
  RAISE NOTICE 'attach_identity_after_auth: email=%, wallet=%', in_email, SUBSTRING(in_wallet_address, 1, 10);
  
  -- Find user by email (case-insensitive)
  -- CRITICAL: Use ILIKE for case-insensitive matching
  SELECT id INTO v_user_id
  FROM canonical_users
  WHERE email ILIKE in_email
  LIMIT 1;
  
  -- If user not found, try to find by wallet address
  IF v_user_id IS NULL THEN
    SELECT id INTO v_user_id
    FROM canonical_users
    WHERE wallet_address ILIKE in_wallet_address
       OR base_wallet_address ILIKE in_wallet_address
       OR eth_wallet_address ILIKE in_wallet_address
    LIMIT 1;
  END IF;
  
  -- If still not found, log error and return
  IF v_user_id IS NULL THEN
    RAISE WARNING 'attach_identity_after_auth: User not found for email=% or wallet=%', in_email, in_wallet_address;
    RETURN jsonb_build_object(
      'success', false,
      'error', 'User not found',
      'email', in_email,
      'wallet', in_wallet_address
    );
  END IF;
  
  -- Update user with wallet information and merge prior_payload if provided
  UPDATE canonical_users
  SET
    canonical_user_id = COALESCE(canonical_user_id, in_canonical_user_id),
    wallet_address = COALESCE(wallet_address, in_wallet_address),
    base_wallet_address = COALESCE(base_wallet_address, in_base_wallet_address),
    eth_wallet_address = COALESCE(eth_wallet_address, in_eth_wallet_address),
    privy_user_id = COALESCE(privy_user_id, in_privy_user_id),
    -- Merge prior_payload fields if provided and current value is null
    username = CASE
      WHEN username IS NULL AND in_prior_payload IS NOT NULL
      THEN in_prior_payload->>'username'
      ELSE username
    END,
    first_name = CASE
      WHEN first_name IS NULL AND in_prior_payload IS NOT NULL
      THEN in_prior_payload->>'first_name'
      ELSE first_name
    END,
    last_name = CASE
      WHEN last_name IS NULL AND in_prior_payload IS NOT NULL
      THEN in_prior_payload->>'last_name'
      ELSE last_name
    END,
    country = CASE
      WHEN country IS NULL AND in_prior_payload IS NOT NULL
      THEN in_prior_payload->>'country'
      ELSE country
    END,
    telegram_handle = CASE
      WHEN telegram_handle IS NULL AND in_prior_payload IS NOT NULL
      THEN in_prior_payload->>'telegram_handle'
      ELSE telegram_handle
    END,
    avatar_url = CASE
      WHEN avatar_url IS NULL AND in_prior_payload IS NOT NULL
      THEN in_prior_payload->>'avatar_url'
      ELSE avatar_url
    END,
    updated_at = NOW()
  WHERE id = v_user_id;
  
  -- Build success response
  v_result := jsonb_build_object(
    'success', true,
    'user_id', v_user_id,
    'canonical_user_id', in_canonical_user_id,
    'wallet_address', in_wallet_address,
    'email', in_email,
    'prior_payload_merged', (in_prior_payload IS NOT NULL)
  );
  
  RAISE NOTICE 'attach_identity_after_auth: Success for user_id=%', v_user_id;
  
  RETURN v_result;
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'attach_identity_after_auth: Error - %', SQLERRM;
    RETURN jsonb_build_object(
      'success', false,
      'error', SQLERRM,
      'email', in_email,
      'wallet', in_wallet_address
    );
END;
$$;

-- Grant execute permission to authenticated users and service role
GRANT EXECUTE ON FUNCTION attach_identity_after_auth TO authenticated;
GRANT EXECUTE ON FUNCTION attach_identity_after_auth TO service_role;
GRANT EXECUTE ON FUNCTION attach_identity_after_auth TO anon;

-- Add comment for documentation
COMMENT ON FUNCTION attach_identity_after_auth IS 
'Attaches wallet identity to canonical_users and merges prior signup payload data. Called after successful wallet authentication.';

COMMIT;
