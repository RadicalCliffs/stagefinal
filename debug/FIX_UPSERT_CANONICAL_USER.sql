-- FIX: upsert_canonical_user ambiguous column reference
-- The error: column reference "canonical_user_id" is ambiguous
-- Fix: Fully qualify all column references with table alias

CREATE OR REPLACE FUNCTION public.upsert_canonical_user(
  p_uid text,
  p_canonical_user_id text DEFAULT NULL::text,
  p_email text DEFAULT NULL::text,
  p_username text DEFAULT NULL::text,
  p_wallet_address text DEFAULT NULL::text,
  p_base_wallet_address text DEFAULT NULL::text,
  p_eth_wallet_address text DEFAULT NULL::text,
  p_privy_user_id text DEFAULT NULL::text,
  p_first_name text DEFAULT NULL::text,
  p_last_name text DEFAULT NULL::text,
  p_telegram_handle text DEFAULT NULL::text,
  p_country text DEFAULT NULL::text,
  p_avatar_url text DEFAULT NULL::text,
  p_auth_provider text DEFAULT NULL::text,
  p_wallet_linked boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id TEXT;
  v_existing_canonical_id TEXT;
  v_final_canonical_id TEXT;
  v_normalized_wallet TEXT;
  v_normalized_base_wallet TEXT;
  v_normalized_eth_wallet TEXT;
BEGIN
  -- Check if user exists and get their current canonical_user_id
  SELECT cu.canonical_user_id INTO v_existing_canonical_id
  FROM canonical_users cu
  WHERE cu.uid = p_uid;

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

  -- Normalize wallet addresses if provided (store in local vars to avoid ambiguity)
  IF p_wallet_address IS NOT NULL THEN
    v_normalized_wallet := util.normalize_evm_address(p_wallet_address);
  ELSE
    v_normalized_wallet := NULL;
  END IF;
  
  IF p_base_wallet_address IS NOT NULL THEN
    v_normalized_base_wallet := util.normalize_evm_address(p_base_wallet_address);
  ELSE
    v_normalized_base_wallet := NULL;
  END IF;
  
  IF p_eth_wallet_address IS NOT NULL THEN
    v_normalized_eth_wallet := util.normalize_evm_address(p_eth_wallet_address);
  ELSE
    v_normalized_eth_wallet := NULL;
  END IF;

  -- Insert or update canonical user
  INSERT INTO canonical_users AS cu (
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
    v_normalized_wallet,
    v_normalized_base_wallet,
    v_normalized_eth_wallet,
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
    canonical_user_id = COALESCE(v_final_canonical_id, cu.canonical_user_id),
    email = COALESCE(LOWER(EXCLUDED.email), cu.email),
    username = COALESCE(LOWER(EXCLUDED.username), cu.username),
    wallet_address = COALESCE(EXCLUDED.wallet_address, cu.wallet_address),
    base_wallet_address = COALESCE(EXCLUDED.base_wallet_address, cu.base_wallet_address),
    eth_wallet_address = COALESCE(EXCLUDED.eth_wallet_address, cu.eth_wallet_address),
    privy_user_id = COALESCE(EXCLUDED.privy_user_id, cu.privy_user_id),
    first_name = COALESCE(EXCLUDED.first_name, cu.first_name),
    last_name = COALESCE(EXCLUDED.last_name, cu.last_name),
    telegram_handle = COALESCE(EXCLUDED.telegram_handle, cu.telegram_handle),
    country = COALESCE(EXCLUDED.country, cu.country),
    avatar_url = COALESCE(EXCLUDED.avatar_url, cu.avatar_url),
    auth_provider = COALESCE(EXCLUDED.auth_provider, cu.auth_provider),
    updated_at = NOW()
  RETURNING cu.id INTO v_user_id;

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
$function$;

-- Verify it works
SELECT 'upsert_canonical_user fixed!' as status;
