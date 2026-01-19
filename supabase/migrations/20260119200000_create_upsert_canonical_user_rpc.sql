-- ============================================================================
-- CREATE upsert_canonical_user RPC FUNCTION
-- ============================================================================
-- This RPC function provides an idempotent way to create or update canonical
-- user records during authentication and wallet linking flows.
--
-- Called from:
-- 1. Auth sign-in/signup flow (with email/username/etc.)
-- 2. Wallet link completion (with wallet fields and p_canonical_user_id = prize:pid:)
--
-- The function safely merges data and can be called multiple times.
--
-- Date: 2026-01-19
-- ============================================================================

BEGIN;

-- Drop function if it exists to ensure clean creation
DROP FUNCTION IF EXISTS upsert_canonical_user(
  text, text, text, text, text, text, text, text, text, text, text, boolean
);

-- Create the upsert_canonical_user RPC function
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
  v_user_id uuid;
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
  IF p_uid IS NOT NULL THEN
    SELECT id INTO v_user_id
    FROM canonical_users
    WHERE uid = p_uid
    LIMIT 1;
  END IF;
  
  -- If not found by uid, try canonical_user_id
  IF v_user_id IS NULL AND p_canonical_user_id IS NOT NULL THEN
    SELECT id INTO v_user_id
    FROM canonical_users
    WHERE canonical_user_id = p_canonical_user_id
    LIMIT 1;
  END IF;
  
  -- If not found by canonical_user_id, try email
  IF v_user_id IS NULL AND p_email IS NOT NULL THEN
    SELECT id INTO v_user_id
    FROM canonical_users
    WHERE email ILIKE p_email
    LIMIT 1;
  END IF;
  
  -- If not found by email, try wallet address
  IF v_user_id IS NULL AND v_wallet_address IS NOT NULL THEN
    SELECT id INTO v_user_id
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
    WHERE id = v_user_id;
    
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
      auth_provider,
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
      'cdp',
      NOW(),
      NOW()
    )
    RETURNING id INTO v_user_id;
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

-- Grant execute permission to authenticated users, anon, and service role
GRANT EXECUTE ON FUNCTION upsert_canonical_user TO authenticated;
GRANT EXECUTE ON FUNCTION upsert_canonical_user TO service_role;
GRANT EXECUTE ON FUNCTION upsert_canonical_user TO anon;

-- Add comment for documentation
COMMENT ON FUNCTION upsert_canonical_user IS 
'Idempotent function to create or update canonical_users records during auth and wallet linking.
Safely merges data without overwriting existing non-null values.
Can be called multiple times with the same or additional data.';

COMMIT;
