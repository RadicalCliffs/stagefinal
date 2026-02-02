-- ============================================================================
-- Migration: Fix upsert_canonical_user Function Overload Issue
-- ============================================================================
-- Description: Drops all existing overloads of upsert_canonical_user and 
--              recreates with the correct 14-parameter signature
--
-- Context: Migration 20260201164500 used CREATE OR REPLACE without DROP,
--          causing multiple function signatures to coexist. This leads to
--          Postgrest schema cache errors: "function name is not unique"
--
-- Solution: Explicitly drop all existing signatures before recreating
-- ============================================================================

BEGIN;

-- ============================================================================
-- SECTION 1: Drop all existing upsert_canonical_user function overloads
-- ============================================================================

-- Drop the 12-parameter version from 20260128054900
DROP FUNCTION IF EXISTS public.upsert_canonical_user(
  TEXT,  -- p_uid
  TEXT,  -- p_canonical_user_id
  TEXT,  -- p_email
  TEXT,  -- p_username
  TEXT,  -- p_wallet_address
  TEXT,  -- p_base_wallet_address
  TEXT,  -- p_eth_wallet_address
  TEXT,  -- p_privy_user_id
  TEXT,  -- p_first_name
  TEXT,  -- p_last_name
  TEXT,  -- p_telegram_handle
  BOOLEAN  -- p_wallet_linked
) CASCADE;

-- Drop the 14-parameter version from 20260201164500 (if it exists)
DROP FUNCTION IF EXISTS public.upsert_canonical_user(
  TEXT,  -- p_uid
  TEXT,  -- p_canonical_user_id
  TEXT,  -- p_email
  TEXT,  -- p_username
  TEXT,  -- p_wallet_address
  TEXT,  -- p_base_wallet_address
  TEXT,  -- p_eth_wallet_address
  TEXT,  -- p_privy_user_id
  TEXT,  -- p_first_name
  TEXT,  -- p_last_name
  TEXT,  -- p_telegram_handle
  TEXT,  -- p_country
  TEXT,  -- p_avatar_url
  TEXT,  -- p_auth_provider
  BOOLEAN  -- p_wallet_linked
) CASCADE;

-- Drop any 8-parameter version (from very early migrations)
DROP FUNCTION IF EXISTS public.upsert_canonical_user(
  TEXT,  -- p_uid
  TEXT,  -- p_canonical_user_id
  TEXT,  -- p_email
  TEXT,  -- p_username
  TEXT,  -- p_wallet_address
  TEXT,  -- p_base_wallet_address
  TEXT,  -- p_eth_wallet_address
  TEXT   -- p_privy_user_id
) CASCADE;

-- ============================================================================
-- SECTION 2: Recreate upsert_canonical_user with correct 14-parameter signature
-- ============================================================================

CREATE FUNCTION public.upsert_canonical_user(
  p_uid TEXT,
  p_canonical_user_id TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_username TEXT DEFAULT NULL,
  p_wallet_address TEXT DEFAULT NULL,
  p_base_wallet_address TEXT DEFAULT NULL,
  p_eth_wallet_address TEXT DEFAULT NULL,
  p_privy_user_id TEXT DEFAULT NULL,
  p_first_name TEXT DEFAULT NULL,
  p_last_name TEXT DEFAULT NULL,
  p_telegram_handle TEXT DEFAULT NULL,
  p_country TEXT DEFAULT NULL,
  p_avatar_url TEXT DEFAULT NULL,
  p_auth_provider TEXT DEFAULT NULL,
  p_wallet_linked BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id TEXT;
  v_existing_canonical_id TEXT;
  v_final_canonical_id TEXT;
BEGIN
  -- Check if user exists and get their current canonical_user_id
  SELECT canonical_user_id INTO v_existing_canonical_id
  FROM canonical_users
  WHERE uid = p_uid;

  -- Determine final canonical_user_id:
  -- 1. If provided p_canonical_user_id is wallet-based (0x...), use it
  -- 2. Else if existing is placeholder (temp...) AND we have p_wallet_address, replace with wallet-based
  -- 3. Else keep existing or use provided
  IF p_canonical_user_id IS NOT NULL AND p_canonical_user_id LIKE 'prize:pid:0x%' THEN
    v_final_canonical_id := p_canonical_user_id;
  ELSIF v_existing_canonical_id IS NOT NULL AND v_existing_canonical_id LIKE 'prize:pid:temp%' 
        AND p_wallet_address IS NOT NULL THEN
    v_final_canonical_id := 'prize:pid:' || util.normalize_evm_address(p_wallet_address);
  ELSIF p_canonical_user_id IS NOT NULL THEN
    v_final_canonical_id := p_canonical_user_id;
  ELSE
    v_final_canonical_id := v_existing_canonical_id;
  END IF;

  -- Normalize wallet addresses if provided
  IF p_wallet_address IS NOT NULL THEN
    p_wallet_address := util.normalize_evm_address(p_wallet_address);
  END IF;
  
  IF p_base_wallet_address IS NOT NULL THEN
    p_base_wallet_address := util.normalize_evm_address(p_base_wallet_address);
  END IF;
  
  IF p_eth_wallet_address IS NOT NULL THEN
    p_eth_wallet_address := util.normalize_evm_address(p_eth_wallet_address);
  END IF;

  -- Insert or update canonical user
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
    country,
    avatar_url,
    auth_provider,
    created_at,
    updated_at
  )
  VALUES (
    p_uid,
    v_final_canonical_id,
    LOWER(p_email),
    LOWER(p_username),
    p_wallet_address,
    p_base_wallet_address,
    p_eth_wallet_address,
    p_privy_user_id,
    p_first_name,
    p_last_name,
    p_telegram_handle,
    p_country,
    p_avatar_url,
    p_auth_provider,
    NOW(),
    NOW()
  )
  ON CONFLICT (uid) DO UPDATE SET
    canonical_user_id = COALESCE(v_final_canonical_id, canonical_users.canonical_user_id),
    email = COALESCE(LOWER(EXCLUDED.email), canonical_users.email),
    username = COALESCE(LOWER(EXCLUDED.username), canonical_users.username),
    wallet_address = COALESCE(EXCLUDED.wallet_address, canonical_users.wallet_address),
    base_wallet_address = COALESCE(EXCLUDED.base_wallet_address, canonical_users.base_wallet_address),
    eth_wallet_address = COALESCE(EXCLUDED.eth_wallet_address, canonical_users.eth_wallet_address),
    privy_user_id = COALESCE(EXCLUDED.privy_user_id, canonical_users.privy_user_id),
    first_name = COALESCE(EXCLUDED.first_name, canonical_users.first_name),
    last_name = COALESCE(EXCLUDED.last_name, canonical_users.last_name),
    telegram_handle = COALESCE(EXCLUDED.telegram_handle, canonical_users.telegram_handle),
    country = COALESCE(EXCLUDED.country, canonical_users.country),
    avatar_url = COALESCE(EXCLUDED.avatar_url, canonical_users.avatar_url),
    auth_provider = COALESCE(EXCLUDED.auth_provider, canonical_users.auth_provider),
    updated_at = NOW()
  RETURNING id INTO v_user_id;

  -- Log the operation (non-PII)
  RAISE LOG 'upsert_canonical_user: user_id=%, canonical_user_id=%, wallet_linked=%', 
    v_user_id, v_final_canonical_id, p_wallet_linked;

  RETURN jsonb_build_object(
    'id', v_user_id,
    'canonical_user_id', v_final_canonical_id
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE LOG 'upsert_canonical_user ERROR: %', SQLERRM;
    RAISE EXCEPTION 'Failed to save user data. Please try again.';
END;
$$;

-- Add comment for documentation
COMMENT ON FUNCTION public.upsert_canonical_user IS 
  'Upserts a canonical user record with full profile data. Handles temporary placeholder replacement on wallet connection. Returns user id and canonical_user_id.';

-- Grant execute to anon and authenticated users
GRANT EXECUTE ON FUNCTION public.upsert_canonical_user(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO anon, authenticated;

COMMIT;

-- ============================================================================
-- SECTION 3: Verification query
-- ============================================================================

-- Run this to verify only one function signature exists:
-- SELECT 
--   p.proname,
--   pg_catalog.pg_get_function_arguments(p.oid) AS arguments,
--   pg_catalog.pg_get_function_result(p.oid) AS result_type,
--   n.nspname AS schema
-- FROM pg_proc p
-- JOIN pg_namespace n ON p.pronamespace = n.oid
-- WHERE p.proname = 'upsert_canonical_user'
--   AND n.nspname = 'public'
-- ORDER BY n.nspname, p.proname;
