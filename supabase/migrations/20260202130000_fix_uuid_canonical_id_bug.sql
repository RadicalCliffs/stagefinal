-- ============================================================================
-- Migration: Fix UUID Canonical ID Bug
-- ============================================================================
-- Date: 2026-02-02
-- Issue: sub_account_balances contains user_id values in wrong format:
--        prize:pid:{uuid} instead of prize:pid:0x{wallet} or prize:pid:temp{N}
--
-- Root Cause: upsert_canonical_user falls back to p_uid (UUID) when 
--             p_canonical_user_id is NULL, creating invalid format IDs
--
-- Fix: Update upsert_canonical_user to NEVER use bare UUID as canonical_user_id
--      Only accept: prize:pid:0x{wallet} or prize:pid:temp{N}
-- ============================================================================

BEGIN;

-- ============================================================================
-- SECTION 1: Drop existing upsert_canonical_user functions
-- ============================================================================

DROP FUNCTION IF EXISTS public.upsert_canonical_user(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN
) CASCADE;

DROP FUNCTION IF EXISTS public.upsert_canonical_user(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN
) CASCADE;

-- ============================================================================
-- SECTION 2: Recreate upsert_canonical_user with UUID rejection
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
  v_normalized_wallet TEXT;
BEGIN
  -- Check if user exists and get their current canonical_user_id
  SELECT canonical_user_id INTO v_existing_canonical_id
  FROM canonical_users
  WHERE uid = p_uid;

  -- Normalize wallet addresses if provided
  IF p_wallet_address IS NOT NULL THEN
    v_normalized_wallet := util.normalize_evm_address(p_wallet_address);
  ELSIF p_base_wallet_address IS NOT NULL THEN
    v_normalized_wallet := util.normalize_evm_address(p_base_wallet_address);
  ELSIF p_eth_wallet_address IS NOT NULL THEN
    v_normalized_wallet := util.normalize_evm_address(p_eth_wallet_address);
  END IF;

  -- Determine final canonical_user_id:
  -- Priority order:
  -- 1. Wallet-based ID from parameter (prize:pid:0x...)
  -- 2. Replace existing temp placeholder with wallet if wallet provided
  -- 3. Existing wallet-based or temp ID
  -- 4. Create wallet-based ID from provided wallet
  -- 5. NULL (triggers will create temp placeholder)
  -- NEVER: Use bare UUID

  IF p_canonical_user_id IS NOT NULL AND p_canonical_user_id LIKE 'prize:pid:0x%' THEN
    -- Wallet-based ID provided - use it
    v_final_canonical_id := p_canonical_user_id;
    
  ELSIF v_existing_canonical_id IS NOT NULL AND v_existing_canonical_id LIKE 'prize:pid:temp%' 
        AND v_normalized_wallet IS NOT NULL THEN
    -- Replace temp placeholder with wallet-based ID
    v_final_canonical_id := 'prize:pid:' || v_normalized_wallet;
    
  ELSIF v_existing_canonical_id IS NOT NULL AND 
        (v_existing_canonical_id LIKE 'prize:pid:0x%' OR v_existing_canonical_id LIKE 'prize:pid:temp%') THEN
    -- Keep existing valid ID
    v_final_canonical_id := v_existing_canonical_id;
    
  ELSIF v_normalized_wallet IS NOT NULL THEN
    -- Create new wallet-based ID
    v_final_canonical_id := 'prize:pid:' || v_normalized_wallet;
    
  ELSE
    -- No wallet, no existing valid ID - leave NULL so triggers create temp placeholder
    v_final_canonical_id := NULL;
  END IF;

  -- CRITICAL: Validate we're not using a bare UUID format
  IF v_final_canonical_id IS NOT NULL AND 
     v_final_canonical_id ~ 'prize:pid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' AND
     v_final_canonical_id NOT LIKE 'prize:pid:0x%' AND
     v_final_canonical_id NOT LIKE 'prize:pid:temp%' THEN
    RAISE EXCEPTION 'Invalid canonical_user_id format: %. Must be prize:pid:0x{wallet} or prize:pid:temp{N}', v_final_canonical_id;
  END IF;

  -- Normalize all wallet addresses
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
    v_final_canonical_id,  -- May be NULL - triggers will handle
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
  RETURNING id, canonical_user_id INTO v_user_id, v_final_canonical_id;

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
    RAISE EXCEPTION 'Failed to save user data: %', SQLERRM;
END;
$$;

-- Add comment for documentation
COMMENT ON FUNCTION public.upsert_canonical_user IS 
  'Upserts a canonical user record. NEVER uses bare UUID as canonical_user_id. Only accepts prize:pid:0x{wallet} or prize:pid:temp{N} formats. Returns user id and canonical_user_id.';

-- Grant execute to anon and authenticated users
GRANT EXECUTE ON FUNCTION public.upsert_canonical_user(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO anon, authenticated;

COMMIT;

-- ============================================================================
-- SECTION 3: Verification
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '========================================================';
  RAISE NOTICE 'UUID CANONICAL ID BUG FIX APPLIED';
  RAISE NOTICE '========================================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Changes:';
  RAISE NOTICE '  ✓ upsert_canonical_user now rejects bare UUID format';
  RAISE NOTICE '  ✓ Only accepts: prize:pid:0x{wallet} or prize:pid:temp{N}';
  RAISE NOTICE '  ✓ Validation added to prevent UUID canonical IDs';
  RAISE NOTICE '';
  RAISE NOTICE 'Next Steps:';
  RAISE NOTICE '  1. Run cleanup migration to fix existing wrong-format IDs';
  RAISE NOTICE '  2. Update edge functions to not pass bare UUIDs';
  RAISE NOTICE '  3. Run sync_balance_discrepancies() to fix balances';
  RAISE NOTICE '';
  RAISE NOTICE '========================================================';
END $$;
