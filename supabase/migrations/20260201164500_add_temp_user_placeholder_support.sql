-- ============================================================================
-- Migration: Add Temporary User Placeholder Support for Email-First Auth
-- ============================================================================
-- Description: Enables email-first authentication with placeholder canonical_user_id
--              format prize:pid:temp<N> that gets replaced with prize:pid:0x... on wallet connection
-- 
-- Changes:
-- 1. Create sequence for atomic temp user ID allocation
-- 2. Create RPC function to allocate temp canonical_user placeholders
-- 3. Fix trigger functions to allow placeholder format (skip normalization)
-- 4. Update upsert_canonical_user to handle placeholder replacement
-- ============================================================================

BEGIN;

-- ============================================================================
-- SECTION 1: Create sequence for temporary user IDs
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS temp_user_sequence START WITH 1;

COMMENT ON SEQUENCE temp_user_sequence IS 
'Monotonically increasing sequence for temporary user canonical_user_id placeholders (prize:pid:temp<N>)';

-- ============================================================================
-- SECTION 2: Create RPC function to allocate temporary user placeholder
-- ============================================================================

CREATE OR REPLACE FUNCTION allocate_temp_canonical_user()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_temp_id TEXT;
  v_canonical_user_id TEXT;
  v_uid TEXT;
BEGIN
  -- Allocate next temp ID atomically from sequence
  v_temp_id := nextval('temp_user_sequence')::TEXT;
  v_canonical_user_id := 'prize:pid:temp' || v_temp_id;
  
  -- Generate unique uid for this user (used as stable identifier)
  v_uid := gen_random_uuid()::TEXT;
  
  -- Return both values for frontend to use
  RETURN jsonb_build_object(
    'uid', v_uid,
    'canonical_user_id', v_canonical_user_id,
    'temp_id', v_temp_id
  );
END;
$$;

COMMENT ON FUNCTION allocate_temp_canonical_user IS 
'Allocates a unique temporary canonical_user_id (prize:pid:temp<N>) and uid for email-first signup before wallet connection';

-- Grant execute to anon and authenticated users
GRANT EXECUTE ON FUNCTION allocate_temp_canonical_user() TO anon, authenticated;

-- ============================================================================
-- SECTION 3: Fix trigger functions to handle placeholder format
-- ============================================================================

-- Drop existing triggers to recreate functions safely
DROP TRIGGER IF EXISTS trg_canonical_users_normalize ON canonical_users;
DROP TRIGGER IF EXISTS canonical_users_normalize_before_write ON canonical_users;
DROP TRIGGER IF EXISTS cu_normalize_and_enforce_trg ON canonical_users;

-- Function 1: canonical_users_normalize (updated to skip placeholders)
CREATE OR REPLACE FUNCTION canonical_users_normalize()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Normalize all wallet address fields using util function for consistency
  IF NEW.wallet_address IS NOT NULL THEN
    NEW.wallet_address := util.normalize_evm_address(NEW.wallet_address);
  END IF;
  
  IF NEW.base_wallet_address IS NOT NULL THEN
    NEW.base_wallet_address := util.normalize_evm_address(NEW.base_wallet_address);
  END IF;
  
  IF NEW.eth_wallet_address IS NOT NULL THEN
    NEW.eth_wallet_address := util.normalize_evm_address(NEW.eth_wallet_address);
  END IF;

  -- Auto-generate canonical_user_id if missing and we have a wallet address
  -- IMPORTANT: Skip this if canonical_user_id is a temporary placeholder (prize:pid:temp<N>)
  IF NEW.canonical_user_id IS NULL AND COALESCE(NEW.wallet_address, NEW.base_wallet_address, NEW.eth_wallet_address) IS NOT NULL THEN
    NEW.canonical_user_id := 'prize:pid:' || COALESCE(NEW.wallet_address, NEW.base_wallet_address, NEW.eth_wallet_address);
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION canonical_users_normalize IS 
'Normalizes wallet addresses to lowercase and auto-generates canonical_user_id (skips temp placeholders)';

-- Function 2: canonical_users_normalize_before_write (updated to skip placeholders)
CREATE OR REPLACE FUNCTION canonical_users_normalize_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Normalize wallet_address using util function
  IF NEW.wallet_address IS NOT NULL THEN
    NEW.wallet_address := util.normalize_evm_address(NEW.wallet_address);
  END IF;

  -- Set canonical_user_id based on wallet_address
  IF NEW.wallet_address IS NOT NULL THEN
    NEW.canonical_user_id := 'prize:pid:' || NEW.wallet_address;
  -- IMPORTANT: Only extract wallet from canonical_user_id if it's NOT a temporary placeholder
  ELSIF NEW.canonical_user_id IS NOT NULL AND NEW.canonical_user_id NOT LIKE 'prize:pid:temp%' THEN
    IF POSITION('prize:pid:' IN NEW.canonical_user_id) = 1 THEN
      -- Use SUBSTRING to safely extract the wallet address part
      NEW.wallet_address := SUBSTRING(NEW.canonical_user_id FROM 11);
      -- Only normalize if it looks like a valid address (starts with 0x)
      IF NEW.wallet_address LIKE '0x%' THEN
        NEW.wallet_address := util.normalize_evm_address(NEW.wallet_address);
        NEW.canonical_user_id := 'prize:pid:' || NEW.wallet_address;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION canonical_users_normalize_before_write IS 
'Advanced normalization that ensures canonical_user_id and wallet_address consistency (skips temp placeholders)';

-- Function 3: cu_normalize_and_enforce (updated to skip placeholders)
CREATE OR REPLACE FUNCTION cu_normalize_and_enforce()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Normalize all wallet fields using util function for consistency
  IF NEW.wallet_address IS NOT NULL THEN
    NEW.wallet_address := util.normalize_evm_address(NEW.wallet_address);
  END IF;
  
  IF NEW.base_wallet_address IS NOT NULL THEN
    NEW.base_wallet_address := util.normalize_evm_address(NEW.base_wallet_address);
  END IF;
  
  IF NEW.eth_wallet_address IS NOT NULL THEN
    NEW.eth_wallet_address := util.normalize_evm_address(NEW.eth_wallet_address);
  END IF;

  -- If primary wallet is missing but alternates exist, pick first non-null
  IF NEW.wallet_address IS NULL THEN
    IF NEW.base_wallet_address IS NOT NULL THEN
      NEW.wallet_address := NEW.base_wallet_address;
    ELSIF NEW.eth_wallet_address IS NOT NULL THEN
      NEW.wallet_address := NEW.eth_wallet_address;
    END IF;
  END IF;

  -- Enforce canonical_user_id when we have a wallet
  -- IMPORTANT: Only set if NOT a temporary placeholder
  IF NEW.wallet_address IS NOT NULL AND (NEW.canonical_user_id IS NULL OR NEW.canonical_user_id NOT LIKE 'prize:pid:temp%') THEN
    NEW.canonical_user_id := 'prize:pid:' || NEW.wallet_address;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION cu_normalize_and_enforce IS 
'Comprehensive normalization with fallback logic to ensure data consistency (skips temp placeholders)';

-- Recreate triggers in correct order
CREATE TRIGGER trg_canonical_users_normalize
  BEFORE INSERT OR UPDATE ON canonical_users
  FOR EACH ROW
  EXECUTE FUNCTION canonical_users_normalize();

CREATE TRIGGER canonical_users_normalize_before_write
  BEFORE INSERT OR UPDATE ON canonical_users
  FOR EACH ROW
  EXECUTE FUNCTION canonical_users_normalize_before_write();

CREATE TRIGGER cu_normalize_and_enforce_trg
  BEFORE INSERT OR UPDATE ON canonical_users
  FOR EACH ROW
  EXECUTE FUNCTION cu_normalize_and_enforce();

-- ============================================================================
-- SECTION 4: Update upsert_canonical_user to handle placeholder replacement
-- ============================================================================

CREATE OR REPLACE FUNCTION upsert_canonical_user(
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
  -- 1. If new canonical_user_id provided and it's a wallet-based ID (prize:pid:0x...), use it
  -- 2. If existing ID is a placeholder (prize:pid:temp...) and we have a wallet, replace it
  -- 3. Otherwise keep existing or use provided
  IF p_canonical_user_id IS NOT NULL AND p_canonical_user_id LIKE 'prize:pid:0x%' THEN
    -- Wallet-based ID takes priority (replaces placeholder)
    v_final_canonical_id := p_canonical_user_id;
  ELSIF v_existing_canonical_id IS NOT NULL AND v_existing_canonical_id LIKE 'prize:pid:temp%' AND p_wallet_address IS NOT NULL THEN
    -- Replace placeholder with wallet-based ID
    v_final_canonical_id := 'prize:pid:' || util.normalize_evm_address(p_wallet_address);
  ELSE
    -- Keep provided or use existing
    v_final_canonical_id := COALESCE(p_canonical_user_id, v_existing_canonical_id, p_uid);
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
    wallet_linked,
    created_at,
    updated_at
  )
  VALUES (
    p_uid,
    v_final_canonical_id,
    p_email,
    p_username,
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
    p_wallet_linked,
    NOW(),
    NOW()
  )
  ON CONFLICT (uid) DO UPDATE SET
    canonical_user_id = v_final_canonical_id,
    email = COALESCE(EXCLUDED.email, canonical_users.email),
    username = COALESCE(EXCLUDED.username, canonical_users.username),
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
    wallet_linked = COALESCE(EXCLUDED.wallet_linked, canonical_users.wallet_linked),
    updated_at = NOW()
  RETURNING id INTO v_user_id;

  -- Return user data
  RETURN jsonb_build_object(
    'id', v_user_id,
    'canonical_user_id', v_final_canonical_id
  );
END;
$$;

COMMENT ON FUNCTION upsert_canonical_user IS 
'Upserts canonical user, replacing placeholder canonical_user_id with wallet-based ID when wallet connects';

COMMIT;
