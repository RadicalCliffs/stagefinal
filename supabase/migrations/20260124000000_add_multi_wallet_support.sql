-- Migration: Add multi-wallet support
-- This migration adds the ability for users to have multiple wallets attached to their account
-- with one designated as the primary wallet for identity purposes

-- Add linked_wallets JSONB column to store all wallets
-- Format: [{"address": "0x...", "type": "base" | "external", "nickname": "My MetaMask", "is_primary": true, "linked_at": "2024-01-01T00:00:00Z"}, ...]
ALTER TABLE canonical_users
ADD COLUMN IF NOT EXISTS linked_wallets JSONB DEFAULT '[]'::JSONB;

-- Add primary_wallet_address column for quick lookups
-- This stores the address of the wallet designated as primary
ALTER TABLE canonical_users
ADD COLUMN IF NOT EXISTS primary_wallet_address TEXT;

-- Create index for faster JSONB queries on linked_wallets
CREATE INDEX IF NOT EXISTS idx_canonical_users_linked_wallets
ON canonical_users USING GIN (linked_wallets);

-- Create index on primary_wallet_address for faster lookups
CREATE INDEX IF NOT EXISTS idx_canonical_users_primary_wallet
ON canonical_users(primary_wallet_address);

-- Create RPC function to get all wallets for a user
CREATE OR REPLACE FUNCTION get_user_wallets(user_identifier TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user RECORD;
  v_result JSON;
BEGIN
  -- Find user by various identifiers (case-insensitive for wallet addresses)
  SELECT * INTO v_user
  FROM canonical_users cu
  WHERE cu.canonical_user_id = user_identifier
     OR LOWER(cu.wallet_address) = LOWER(user_identifier)
     OR LOWER(cu.base_wallet_address) = LOWER(user_identifier)
     OR LOWER(cu.eth_wallet_address) = LOWER(user_identifier)
     OR cu.privy_user_id = user_identifier
     OR cu.email ILIKE user_identifier
     OR cu.uid::TEXT = user_identifier
  LIMIT 1;

  IF v_user IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'User not found');
  END IF;

  -- Build the response with all wallet information
  SELECT json_build_object(
    'success', true,
    'wallets', COALESCE(v_user.linked_wallets, '[]'::JSONB),
    'primary_wallet', v_user.primary_wallet_address,
    'base_wallet', v_user.base_wallet_address,
    'linked_external_wallet', v_user.linked_external_wallet
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- Create RPC function to link an additional wallet to user account
CREATE OR REPLACE FUNCTION link_additional_wallet(
  user_identifier TEXT,
  p_wallet_address TEXT,
  p_wallet_type TEXT DEFAULT 'external',
  p_nickname TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user RECORD;
  v_normalized_address TEXT;
  v_new_wallet JSONB;
  v_existing_wallets JSONB;
  v_wallet_exists BOOLEAN;
BEGIN
  -- Normalize wallet address
  v_normalized_address := LOWER(p_wallet_address);

  -- Find user by various identifiers
  SELECT * INTO v_user
  FROM canonical_users cu
  WHERE cu.canonical_user_id = user_identifier
     OR LOWER(cu.wallet_address) = LOWER(user_identifier)
     OR LOWER(cu.base_wallet_address) = LOWER(user_identifier)
     OR cu.privy_user_id = user_identifier
     OR cu.email ILIKE user_identifier
     OR cu.uid::TEXT = user_identifier
  LIMIT 1;

  IF v_user IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'User not found');
  END IF;

  -- Check if wallet already exists in linked_wallets
  v_existing_wallets := COALESCE(v_user.linked_wallets, '[]'::JSONB);

  SELECT EXISTS(
    SELECT 1 FROM jsonb_array_elements(v_existing_wallets) AS w
    WHERE LOWER(w->>'address') = v_normalized_address
  ) INTO v_wallet_exists;

  IF v_wallet_exists THEN
    RETURN json_build_object('success', false, 'error', 'Wallet already linked to this account');
  END IF;

  -- Check if wallet is already linked to another user
  IF EXISTS(
    SELECT 1 FROM canonical_users cu
    WHERE cu.uid != v_user.uid
    AND (
      LOWER(cu.wallet_address) = v_normalized_address
      OR LOWER(cu.base_wallet_address) = v_normalized_address
      OR LOWER(cu.linked_external_wallet) = v_normalized_address
      OR LOWER(cu.primary_wallet_address) = v_normalized_address
      OR EXISTS(
        SELECT 1 FROM jsonb_array_elements(COALESCE(cu.linked_wallets, '[]'::JSONB)) AS w
        WHERE LOWER(w->>'address') = v_normalized_address
      )
    )
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Wallet is already linked to another account');
  END IF;

  -- Build new wallet object
  v_new_wallet := jsonb_build_object(
    'address', v_normalized_address,
    'type', p_wallet_type,
    'nickname', COALESCE(p_nickname,
      CASE p_wallet_type
        WHEN 'base' THEN 'Base Wallet'
        WHEN 'external' THEN 'External Wallet'
        ELSE 'Wallet'
      END
    ),
    'is_primary', (jsonb_array_length(v_existing_wallets) = 0), -- First wallet is primary
    'linked_at', NOW()
  );

  -- Add to linked_wallets array
  UPDATE canonical_users
  SET
    linked_wallets = v_existing_wallets || jsonb_build_array(v_new_wallet),
    primary_wallet_address = CASE
      WHEN primary_wallet_address IS NULL THEN v_normalized_address
      ELSE primary_wallet_address
    END,
    updated_at = NOW()
  WHERE uid = v_user.uid;

  RETURN json_build_object(
    'success', true,
    'message', 'Wallet linked successfully',
    'wallet', v_new_wallet
  );
END;
$$;

-- Create RPC function to set a wallet as primary
CREATE OR REPLACE FUNCTION set_primary_wallet(
  user_identifier TEXT,
  p_wallet_address TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user RECORD;
  v_normalized_address TEXT;
  v_existing_wallets JSONB;
  v_updated_wallets JSONB;
  v_wallet_found BOOLEAN := false;
  v_old_canonical_id TEXT;
  v_new_canonical_id TEXT;
BEGIN
  -- Normalize wallet address
  v_normalized_address := LOWER(p_wallet_address);

  -- Find user by various identifiers
  SELECT * INTO v_user
  FROM canonical_users cu
  WHERE cu.canonical_user_id = user_identifier
     OR LOWER(cu.wallet_address) = LOWER(user_identifier)
     OR LOWER(cu.base_wallet_address) = LOWER(user_identifier)
     OR cu.privy_user_id = user_identifier
     OR cu.email ILIKE user_identifier
     OR cu.uid::TEXT = user_identifier
  LIMIT 1;

  IF v_user IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'User not found');
  END IF;

  -- Get existing wallets
  v_existing_wallets := COALESCE(v_user.linked_wallets, '[]'::JSONB);

  -- Check if wallet exists in linked_wallets or is the current base/external wallet
  SELECT EXISTS(
    SELECT 1 FROM jsonb_array_elements(v_existing_wallets) AS w
    WHERE LOWER(w->>'address') = v_normalized_address
  ) OR LOWER(v_user.base_wallet_address) = v_normalized_address
    OR LOWER(v_user.linked_external_wallet) = v_normalized_address
    OR LOWER(v_user.wallet_address) = v_normalized_address
  INTO v_wallet_found;

  IF NOT v_wallet_found THEN
    RETURN json_build_object('success', false, 'error', 'Wallet not found in account');
  END IF;

  -- Store old canonical ID for reference
  v_old_canonical_id := v_user.canonical_user_id;

  -- Generate new canonical ID based on new primary wallet
  v_new_canonical_id := 'prize:pid:' || v_normalized_address;

  -- Update is_primary flag in linked_wallets array
  SELECT jsonb_agg(
    CASE
      WHEN LOWER(w->>'address') = v_normalized_address
      THEN w || '{"is_primary": true}'::JSONB
      ELSE w || '{"is_primary": false}'::JSONB
    END
  )
  INTO v_updated_wallets
  FROM jsonb_array_elements(v_existing_wallets) AS w;

  -- Update the user record
  UPDATE canonical_users
  SET
    primary_wallet_address = v_normalized_address,
    wallet_address = v_normalized_address,
    canonical_user_id = v_new_canonical_id,
    linked_wallets = COALESCE(v_updated_wallets, v_existing_wallets),
    updated_at = NOW()
  WHERE uid = v_user.uid;

  RETURN json_build_object(
    'success', true,
    'message', 'Primary wallet updated successfully',
    'old_canonical_id', v_old_canonical_id,
    'new_canonical_id', v_new_canonical_id,
    'primary_wallet', v_normalized_address
  );
END;
$$;

-- Create RPC function to remove a wallet from account
CREATE OR REPLACE FUNCTION unlink_wallet(
  user_identifier TEXT,
  p_wallet_address TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user RECORD;
  v_normalized_address TEXT;
  v_existing_wallets JSONB;
  v_updated_wallets JSONB;
  v_is_primary BOOLEAN;
  v_wallet_count INT;
BEGIN
  -- Normalize wallet address
  v_normalized_address := LOWER(p_wallet_address);

  -- Find user
  SELECT * INTO v_user
  FROM canonical_users cu
  WHERE cu.canonical_user_id = user_identifier
     OR LOWER(cu.wallet_address) = LOWER(user_identifier)
     OR LOWER(cu.base_wallet_address) = LOWER(user_identifier)
     OR cu.privy_user_id = user_identifier
     OR cu.email ILIKE user_identifier
     OR cu.uid::TEXT = user_identifier
  LIMIT 1;

  IF v_user IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'User not found');
  END IF;

  v_existing_wallets := COALESCE(v_user.linked_wallets, '[]'::JSONB);
  v_wallet_count := jsonb_array_length(v_existing_wallets);

  -- Check if this is the primary wallet
  SELECT (w->>'is_primary')::BOOLEAN INTO v_is_primary
  FROM jsonb_array_elements(v_existing_wallets) AS w
  WHERE LOWER(w->>'address') = v_normalized_address;

  -- Don't allow unlinking the primary wallet if it's the only one
  IF v_is_primary AND v_wallet_count <= 1 THEN
    RETURN json_build_object('success', false, 'error', 'Cannot unlink the only primary wallet. Link another wallet first.');
  END IF;

  -- Remove the wallet from the array
  SELECT jsonb_agg(w)
  INTO v_updated_wallets
  FROM jsonb_array_elements(v_existing_wallets) AS w
  WHERE LOWER(w->>'address') != v_normalized_address;

  -- If we removed the primary wallet, set a new one
  IF v_is_primary AND v_updated_wallets IS NOT NULL AND jsonb_array_length(v_updated_wallets) > 0 THEN
    -- Set the first remaining wallet as primary
    SELECT jsonb_agg(
      CASE
        WHEN rn = 1 THEN w || '{"is_primary": true}'::JSONB
        ELSE w
      END
    )
    INTO v_updated_wallets
    FROM (
      SELECT w, ROW_NUMBER() OVER () AS rn
      FROM jsonb_array_elements(v_updated_wallets) AS w
    ) sub;

    -- Update primary_wallet_address to the new primary
    UPDATE canonical_users
    SET
      linked_wallets = COALESCE(v_updated_wallets, '[]'::JSONB),
      primary_wallet_address = (v_updated_wallets->0->>'address'),
      wallet_address = (v_updated_wallets->0->>'address'),
      canonical_user_id = 'prize:pid:' || (v_updated_wallets->0->>'address'),
      -- Clear linked_external_wallet if that's what we're unlinking
      linked_external_wallet = CASE
        WHEN LOWER(v_user.linked_external_wallet) = v_normalized_address THEN NULL
        ELSE v_user.linked_external_wallet
      END,
      updated_at = NOW()
    WHERE uid = v_user.uid;
  ELSE
    -- Just remove the wallet without changing primary
    UPDATE canonical_users
    SET
      linked_wallets = COALESCE(v_updated_wallets, '[]'::JSONB),
      -- Clear linked_external_wallet if that's what we're unlinking
      linked_external_wallet = CASE
        WHEN LOWER(v_user.linked_external_wallet) = v_normalized_address THEN NULL
        ELSE v_user.linked_external_wallet
      END,
      updated_at = NOW()
    WHERE uid = v_user.uid;
  END IF;

  RETURN json_build_object(
    'success', true,
    'message', 'Wallet unlinked successfully'
  );
END;
$$;

-- Create RPC function to update wallet nickname
CREATE OR REPLACE FUNCTION update_wallet_nickname(
  user_identifier TEXT,
  p_wallet_address TEXT,
  p_nickname TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user RECORD;
  v_normalized_address TEXT;
  v_existing_wallets JSONB;
  v_updated_wallets JSONB;
BEGIN
  v_normalized_address := LOWER(p_wallet_address);

  -- Find user
  SELECT * INTO v_user
  FROM canonical_users cu
  WHERE cu.canonical_user_id = user_identifier
     OR LOWER(cu.wallet_address) = LOWER(user_identifier)
     OR cu.privy_user_id = user_identifier
     OR cu.email ILIKE user_identifier
     OR cu.uid::TEXT = user_identifier
  LIMIT 1;

  IF v_user IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'User not found');
  END IF;

  v_existing_wallets := COALESCE(v_user.linked_wallets, '[]'::JSONB);

  -- Update the nickname for the specified wallet
  SELECT jsonb_agg(
    CASE
      WHEN LOWER(w->>'address') = v_normalized_address
      THEN jsonb_set(w, '{nickname}', to_jsonb(p_nickname))
      ELSE w
    END
  )
  INTO v_updated_wallets
  FROM jsonb_array_elements(v_existing_wallets) AS w;

  UPDATE canonical_users
  SET
    linked_wallets = COALESCE(v_updated_wallets, v_existing_wallets),
    updated_at = NOW()
  WHERE uid = v_user.uid;

  RETURN json_build_object('success', true, 'message', 'Nickname updated successfully');
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_user_wallets(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION link_additional_wallet(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION set_primary_wallet(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION unlink_wallet(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION update_wallet_nickname(TEXT, TEXT, TEXT) TO anon, authenticated;

-- Add comment for documentation
COMMENT ON COLUMN canonical_users.linked_wallets IS 'JSONB array of all wallets linked to this user account. Format: [{"address": "0x...", "type": "base"|"external", "nickname": "...", "is_primary": bool, "linked_at": timestamp}]';
COMMENT ON COLUMN canonical_users.primary_wallet_address IS 'The wallet address designated as primary for this user. This is used for canonical_user_id generation and identity.';
