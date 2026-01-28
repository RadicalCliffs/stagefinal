-- Migration: Fix upsert_canonical_user function signature
-- Date: 2026-01-28
-- Purpose: Update function to accept all parameters being passed from frontend
--          Fixes membership detection bug where user records weren't being created

-- Drop existing function first
DROP FUNCTION IF EXISTS upsert_canonical_user(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);

-- Recreate with full parameter set
CREATE OR REPLACE FUNCTION upsert_canonical_user(
  p_uid TEXT,
  p_canonical_user_id TEXT,
  p_email TEXT DEFAULT NULL,
  p_username TEXT DEFAULT NULL,
  p_wallet_address TEXT DEFAULT NULL,
  p_base_wallet_address TEXT DEFAULT NULL,
  p_eth_wallet_address TEXT DEFAULT NULL,
  p_privy_user_id TEXT DEFAULT NULL,
  p_first_name TEXT DEFAULT NULL,
  p_last_name TEXT DEFAULT NULL,
  p_telegram_handle TEXT DEFAULT NULL,
  p_wallet_linked BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id TEXT;
  v_is_new_user BOOLEAN := FALSE;
BEGIN
  -- Check if user already exists
  SELECT id INTO v_user_id
  FROM canonical_users
  WHERE uid = p_uid;

  IF v_user_id IS NULL THEN
    v_is_new_user := TRUE;
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
    created_at,
    updated_at
  )
  VALUES (
    p_uid,
    COALESCE(p_canonical_user_id, p_uid),
    p_email,
    COALESCE(p_username, p_email),
    LOWER(p_wallet_address),
    LOWER(p_base_wallet_address),
    LOWER(p_eth_wallet_address),
    p_privy_user_id,
    p_first_name,
    p_last_name,
    p_telegram_handle,
    NOW(),
    NOW()
  )
  ON CONFLICT (uid) DO UPDATE SET
    canonical_user_id = COALESCE(EXCLUDED.canonical_user_id, canonical_users.canonical_user_id),
    email = COALESCE(EXCLUDED.email, canonical_users.email),
    username = COALESCE(EXCLUDED.username, canonical_users.username),
    wallet_address = COALESCE(EXCLUDED.wallet_address, canonical_users.wallet_address),
    base_wallet_address = COALESCE(EXCLUDED.base_wallet_address, canonical_users.base_wallet_address),
    eth_wallet_address = COALESCE(EXCLUDED.eth_wallet_address, canonical_users.eth_wallet_address),
    privy_user_id = COALESCE(EXCLUDED.privy_user_id, canonical_users.privy_user_id),
    first_name = COALESCE(EXCLUDED.first_name, canonical_users.first_name),
    last_name = COALESCE(EXCLUDED.last_name, canonical_users.last_name),
    telegram_handle = COALESCE(EXCLUDED.telegram_handle, canonical_users.telegram_handle),
    updated_at = NOW()
  RETURNING id INTO v_user_id;

  -- Log the operation (non-PII)
  RAISE LOG 'upsert_canonical_user: user_id=%, is_new=%, wallet_linked=%', 
    v_user_id, v_is_new_user, p_wallet_linked;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', v_user_id,
    'canonical_user_id', COALESCE(p_canonical_user_id, p_uid),
    'is_new_user', v_is_new_user,
    'wallet_linked', p_wallet_linked
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE LOG 'upsert_canonical_user ERROR: %', SQLERRM;
    RETURN jsonb_build_object(
      'success', false,
      'error', SQLERRM
    );
END;
$$;

-- Add comment for documentation
COMMENT ON FUNCTION upsert_canonical_user IS 
  'Upserts a canonical user record with full profile data. Returns success flag, user_id, and is_new_user flag for welcome email logic.';
