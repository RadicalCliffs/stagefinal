-- ============================================================================
-- FIX UUID vs TEXT Type Mismatches in User RPC Functions
-- ============================================================================
-- This migration fixes two critical RPC functions that incorrectly declare
-- v_user_id as UUID when they should use TEXT for canonical_user_id.
--
-- Problem:
-- - canonical_users.id is UUID (database-internal ID)
-- - canonical_users.canonical_user_id is TEXT (prize:pid:0x... format)
-- - Functions were using UUID variables but need to work with TEXT identifiers
--
-- Fixed Functions:
-- 1. upsert_canonical_user - Changed v_user_id from uuid to text
-- 2. attach_identity_after_auth - Changed v_user_id from uuid to text
--
-- Date: 2026-01-20
-- ============================================================================

BEGIN;

-- ============================================================================
-- FIX 1: upsert_canonical_user - Change v_user_id from UUID to TEXT
-- ============================================================================

DROP FUNCTION IF EXISTS upsert_canonical_user(
  text, text, text, text, text, text, text, text, text, text, text, boolean
);

CREATE OR REPLACE FUNCTION upsert_canonical_user(
  p_uid text DEFAULT NULL,
  p_canonical_user_id text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_username text DEFAULT NULL,
  p_wallet_address text DEFAULT NULL,
  p_base_wallet_address text DEFAULT NULL,
  p_eth_wallet_address text DEFAULT NULL,
  p_privy_user_id text DEFAULT NULL,
  p_first_name text DEFAULT NULL,
  p_last_name text DEFAULT NULL,
  p_telegram_handle text DEFAULT NULL,
  p_wallet_linked boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id text;  -- FIXED: Changed from uuid to text
  v_canonical_user_id text;
  v_wallet_address text;
  v_result jsonb;
  v_is_new_user boolean := false;
BEGIN
  -- Normalize inputs with NULL handling
  p_email := CASE WHEN p_email IS NOT NULL THEN LOWER(TRIM(p_email)) ELSE NULL END;
  p_wallet_address := CASE WHEN p_wallet_address IS NOT NULL THEN LOWER(TRIM(p_wallet_address)) ELSE NULL END;
  p_base_wallet_address := CASE WHEN p_base_wallet_address IS NOT NULL THEN LOWER(TRIM(p_base_wallet_address)) ELSE NULL END;
  p_eth_wallet_address := CASE WHEN p_eth_wallet_address IS NOT NULL THEN LOWER(TRIM(p_eth_wallet_address)) ELSE NULL END;
  p_username := CASE WHEN p_username IS NOT NULL THEN TRIM(p_username) ELSE NULL END;
  p_first_name := CASE WHEN p_first_name IS NOT NULL THEN TRIM(p_first_name) ELSE NULL END;
  p_last_name := CASE WHEN p_last_name IS NOT NULL THEN TRIM(p_last_name) ELSE NULL END;
  p_telegram_handle := CASE WHEN p_telegram_handle IS NOT NULL THEN TRIM(p_telegram_handle) ELSE NULL END;
  
  -- Set canonical_user_id and wallet_address from parameters or generate from wallet
  v_canonical_user_id := COALESCE(p_canonical_user_id, 'prize:pid:' || p_wallet_address);
  v_wallet_address := COALESCE(p_wallet_address, p_base_wallet_address, p_eth_wallet_address);
  
  -- Log the operation (without exposing full email for security)
  RAISE NOTICE 'upsert_canonical_user: uid=%, email=%**, wallet=%', 
    COALESCE(p_uid, 'NULL'),
    CASE WHEN p_email IS NOT NULL THEN SUBSTRING(p_email, 1, 3) ELSE 'NULL' END,
    CASE WHEN v_wallet_address IS NOT NULL THEN SUBSTRING(v_wallet_address, 1, 10) ELSE 'NULL' END;
  
  -- Try to find existing user by uid, canonical_user_id, email, or wallet address
  -- FIXED: Store id::text instead of just id (which is UUID)
  IF p_uid IS NOT NULL THEN
    SELECT id::text INTO v_user_id
    FROM canonical_users
    WHERE uid = p_uid
    LIMIT 1;
  END IF;
  
  -- If not found by uid, try canonical_user_id
  IF v_user_id IS NULL AND p_canonical_user_id IS NOT NULL THEN
    SELECT id::text INTO v_user_id
    FROM canonical_users
    WHERE canonical_user_id = p_canonical_user_id
    LIMIT 1;
  END IF;
  
  -- If not found by canonical_user_id, try email
  IF v_user_id IS NULL AND p_email IS NOT NULL THEN
    SELECT id::text INTO v_user_id
    FROM canonical_users
    WHERE email ILIKE p_email
    LIMIT 1;
  END IF;
  
  -- If not found by email, try wallet address
  IF v_user_id IS NULL AND v_wallet_address IS NOT NULL THEN
    SELECT id::text INTO v_user_id
    FROM canonical_users
    WHERE wallet_address ILIKE v_wallet_address
       OR base_wallet_address ILIKE v_wallet_address
       OR eth_wallet_address ILIKE v_wallet_address
    LIMIT 1;
  END IF;
  
  -- If user exists, UPDATE (merge data, never overwrite existing non-null values)
  IF v_user_id IS NOT NULL THEN
    RAISE NOTICE 'upsert_canonical_user: Updating existing user id=%', v_user_id;
    
    UPDATE canonical_users
    SET
      uid = COALESCE(uid, p_uid),
      canonical_user_id = COALESCE(canonical_user_id, v_canonical_user_id),
      email = COALESCE(email, p_email),
      username = COALESCE(username, p_username),
      wallet_address = COALESCE(wallet_address, p_wallet_address),
      base_wallet_address = COALESCE(base_wallet_address, p_base_wallet_address, p_wallet_address),
      eth_wallet_address = COALESCE(eth_wallet_address, p_eth_wallet_address, p_wallet_address),
      privy_user_id = COALESCE(privy_user_id, p_privy_user_id),
      first_name = COALESCE(first_name, p_first_name),
      last_name = COALESCE(last_name, p_last_name),
      telegram_handle = COALESCE(telegram_handle, p_telegram_handle),
      wallet_linked = CASE 
        WHEN p_wallet_linked IS NOT NULL THEN p_wallet_linked 
        ELSE COALESCE(wallet_linked, false)
      END,
      updated_at = NOW()
    WHERE id = v_user_id::uuid;  -- FIXED: Cast text back to uuid for WHERE clause
    
  ELSE
    -- User does not exist, INSERT (create new user)
    RAISE NOTICE 'upsert_canonical_user: Creating new user';
    v_is_new_user := true;
    
    -- Generate uid if not provided
    IF p_uid IS NULL THEN
      p_uid := 'user_' || substring(md5(random()::text || clock_timestamp()::text) from 1 for 20);
    END IF;
    
    INSERT INTO canonical_users (
      uid,
      canonical_user_id,
      email,
      username,
      wallet_address,
      base_wallet_address,
      eth_wallet_address,
      privy_user_id,
      first_name,
      last_name,
      telegram_handle,
      wallet_linked,
      created_at,
      updated_at
    )
    VALUES (
      p_uid,
      v_canonical_user_id,
      p_email,
      COALESCE(p_username, CASE WHEN p_email IS NOT NULL THEN split_part(p_email, '@', 1) ELSE NULL END),
      p_wallet_address,
      COALESCE(p_base_wallet_address, p_wallet_address),
      COALESCE(p_eth_wallet_address, p_wallet_address),
      p_privy_user_id,
      p_first_name,
      p_last_name,
      p_telegram_handle,
      COALESCE(p_wallet_linked, false),
      NOW(),
      NOW()
    )
    RETURNING id::text INTO v_user_id;  -- FIXED: Return id as text
  END IF;
  
  -- Build success response
  v_result := jsonb_build_object(
    'success', true,
    'user_id', v_user_id,
    'uid', p_uid,
    'canonical_user_id', v_canonical_user_id,
    'is_new_user', v_is_new_user,
    'wallet_linked', COALESCE(p_wallet_linked, false)
  );
  
  RAISE NOTICE 'upsert_canonical_user: Success for user_id=%', v_user_id;
  
  RETURN v_result;
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'upsert_canonical_user: Error - %', SQLERRM;
    RETURN jsonb_build_object(
      'success', false,
      'error', SQLERRM
    );
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_canonical_user TO authenticated;
GRANT EXECUTE ON FUNCTION upsert_canonical_user TO service_role;
GRANT EXECUTE ON FUNCTION upsert_canonical_user TO anon;

COMMENT ON FUNCTION upsert_canonical_user IS 
'Idempotent function to create or update canonical_users records during auth and wallet linking.
Safely merges data without overwriting existing non-null values.
FIXED: v_user_id changed from UUID to TEXT to match canonical_user_id type.';

-- ============================================================================
-- FIX 2: attach_identity_after_auth - Change v_user_id from UUID to TEXT
-- ============================================================================

DROP FUNCTION IF EXISTS attach_identity_after_auth(
  text, text, text, text, jsonb, text, text
);

CREATE OR REPLACE FUNCTION attach_identity_after_auth(
  in_canonical_user_id text,
  in_wallet_address text,
  in_email text DEFAULT NULL,
  in_privy_user_id text DEFAULT NULL,
  in_prior_payload jsonb DEFAULT NULL,
  in_base_wallet_address text DEFAULT NULL,
  in_eth_wallet_address text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id text;  -- FIXED: Changed from uuid to text
  v_result jsonb;
BEGIN
  -- Normalize inputs with NULL handling
  in_wallet_address := CASE WHEN in_wallet_address IS NOT NULL THEN LOWER(TRIM(in_wallet_address)) ELSE NULL END;
  in_email := CASE WHEN in_email IS NOT NULL THEN LOWER(TRIM(in_email)) ELSE NULL END;
  in_base_wallet_address := CASE WHEN in_base_wallet_address IS NOT NULL THEN LOWER(TRIM(in_base_wallet_address)) ELSE in_wallet_address END;
  in_eth_wallet_address := CASE WHEN in_eth_wallet_address IS NOT NULL THEN LOWER(TRIM(in_eth_wallet_address)) ELSE in_wallet_address END;
  
  -- Log the operation (without exposing full email for security)
  RAISE NOTICE 'attach_identity_after_auth: email=%**, wallet=%', 
    CASE WHEN in_email IS NOT NULL THEN SUBSTRING(in_email, 1, 3) ELSE 'NULL' END,
    CASE WHEN in_wallet_address IS NOT NULL THEN SUBSTRING(in_wallet_address, 1, 10) ELSE 'NULL' END;
  
  -- Find user by email (case-insensitive) if email provided
  -- FIXED: Store id::text instead of just id (which is UUID)
  IF in_email IS NOT NULL THEN
    SELECT id::text INTO v_user_id
    FROM canonical_users
    WHERE email ILIKE in_email
    LIMIT 1;
  END IF;
  
  -- If user not found and wallet provided, try to find by wallet address
  IF v_user_id IS NULL AND in_wallet_address IS NOT NULL THEN
    SELECT id::text INTO v_user_id
    FROM canonical_users
    WHERE wallet_address ILIKE in_wallet_address
       OR base_wallet_address ILIKE in_wallet_address
       OR eth_wallet_address ILIKE in_wallet_address
    LIMIT 1;
  END IF;
  
  -- If still not found, log error and return
  IF v_user_id IS NULL THEN
    RAISE WARNING 'attach_identity_after_auth: User not found for email=%** or wallet=%', 
      CASE WHEN in_email IS NOT NULL THEN SUBSTRING(in_email, 1, 3) ELSE 'NULL' END,
      CASE WHEN in_wallet_address IS NOT NULL THEN SUBSTRING(in_wallet_address, 1, 10) ELSE 'NULL' END;
    RETURN jsonb_build_object(
      'success', false,
      'error', 'User not found',
      'has_email', (in_email IS NOT NULL),
      'has_wallet', (in_wallet_address IS NOT NULL)
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
  WHERE id = v_user_id::uuid;  -- FIXED: Cast text back to uuid for WHERE clause
  
  -- Build success response
  v_result := jsonb_build_object(
    'success', true,
    'user_id', v_user_id,
    'canonical_user_id', in_canonical_user_id,
    'wallet_linked', (in_wallet_address IS NOT NULL),
    'prior_payload_merged', (in_prior_payload IS NOT NULL)
  );
  
  RAISE NOTICE 'attach_identity_after_auth: Success for user_id=%', v_user_id;
  
  RETURN v_result;
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'attach_identity_after_auth: Error - %', SQLERRM;
    RETURN jsonb_build_object(
      'success', false,
      'error', SQLERRM
    );
END;
$$;

GRANT EXECUTE ON FUNCTION attach_identity_after_auth TO authenticated;
GRANT EXECUTE ON FUNCTION attach_identity_after_auth TO service_role;
GRANT EXECUTE ON FUNCTION attach_identity_after_auth TO anon;

COMMENT ON FUNCTION attach_identity_after_auth IS 
'Attaches wallet identity to canonical_users and merges prior signup payload data.
Called after successful wallet authentication.
FIXED: v_user_id changed from UUID to TEXT to match canonical_user_id type.';

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
DECLARE
  upsert_exists BOOLEAN;
  attach_exists BOOLEAN;
BEGIN
  -- Check functions exist
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'upsert_canonical_user'
  ) INTO upsert_exists;
  
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'attach_identity_after_auth'
  ) INTO attach_exists;
  
  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'FIX: UUID vs TEXT Type Mismatch in User Functions';
  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'upsert_canonical_user function exists: %', upsert_exists;
  RAISE NOTICE 'attach_identity_after_auth function exists: %', attach_exists;
  
  IF upsert_exists AND attach_exists THEN
    RAISE NOTICE '✓ SUCCESS: All functions fixed and recreated';
  ELSE
    RAISE WARNING '✗ WARNING: Some functions may have failed';
  END IF;
  RAISE NOTICE '=====================================================';
END $$;

COMMIT;
