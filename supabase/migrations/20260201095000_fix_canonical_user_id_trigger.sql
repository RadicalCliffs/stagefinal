-- ============================================================================
-- FIX: Canonical Users Trigger - Prevent extracting non-wallet IDs
-- ============================================================================
-- Migration: 20260201095000_fix_canonical_user_id_trigger.sql
-- Description: Fixes check constraint violation when creating users with
--              temporary canonical_user_id values before wallet connection
-- 
-- Issue: When NewAuthModal creates a user with temporary ID like:
--        canonical_user_id = 'prize:pid:maxmatthews1_gmail_c_6346d13da6bf4311'
--        wallet_address = NULL
--        The trigger extracts 'maxmatthews1_gmail_c_6346d13da6bf4311' and 
--        tries to normalize it as an EVM address, which fails validation
-- 
-- Root Cause: canonical_users_normalize_before_write() extracts ANY value
--             after 'prize:pid:' as a wallet address, even non-wallet IDs
-- 
-- Solution: Only extract wallet_address if it looks like a valid EVM address
--           (starts with '0x' and is 42 characters long)
-- ============================================================================

BEGIN;

-- ============================================================================
-- Update canonical_users_normalize_before_write function
-- ============================================================================

CREATE OR REPLACE FUNCTION canonical_users_normalize_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  extracted_value TEXT;
BEGIN
  -- Normalize wallet_address using util function if already set
  IF NEW.wallet_address IS NOT NULL THEN
    NEW.wallet_address := util.normalize_evm_address(NEW.wallet_address);
  END IF;

  -- Set canonical_user_id based on wallet_address if wallet is set
  IF NEW.wallet_address IS NOT NULL THEN
    NEW.canonical_user_id := 'prize:pid:' || NEW.wallet_address;
  -- Or extract wallet_address from canonical_user_id ONLY if it's a valid wallet
  ELSIF NEW.canonical_user_id IS NOT NULL THEN
    IF POSITION('prize:pid:' IN NEW.canonical_user_id) = 1 THEN
      -- Extract the value after 'prize:pid:'
      extracted_value := SUBSTRING(NEW.canonical_user_id FROM 11);
      
      -- CRITICAL FIX: Only set wallet_address if extracted value looks like EVM address
      -- Valid EVM addresses: start with '0x' and are 42 characters long (0x + 40 hex chars)
      -- Also validate it contains only valid hex characters (0-9, a-f, A-F)
      IF extracted_value LIKE '0x%' 
         AND LENGTH(extracted_value) = 42 
         AND extracted_value ~ '^0x[0-9a-fA-F]{40}$' THEN
        NEW.wallet_address := util.normalize_evm_address(extracted_value);
        NEW.canonical_user_id := 'prize:pid:' || NEW.wallet_address;
      END IF;
      -- Otherwise, leave wallet_address as NULL (it's a temporary ID)
      -- The canonical_user_id will be updated when wallet is actually connected
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION canonical_users_normalize_before_write IS 
'Advanced normalization that ensures canonical_user_id and wallet_address consistency. Only extracts wallet_address if value is a valid EVM address (0x + 40 hex chars).';

-- ============================================================================
-- Update cu_normalize_and_enforce function
-- ============================================================================

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

  -- CRITICAL FIX: Only enforce canonical_user_id when we have a REAL wallet
  -- Don't set it for temporary IDs (email-based identifiers before wallet connection)
  -- Validate it's a proper EVM address (0x + 40 hex chars)
  IF NEW.wallet_address IS NOT NULL 
     AND NEW.wallet_address LIKE '0x%' 
     AND LENGTH(NEW.wallet_address) = 42
     AND NEW.wallet_address ~ '^0x[0-9a-fA-F]{40}$' THEN
    NEW.canonical_user_id := 'prize:pid:' || NEW.wallet_address;
  END IF;
  -- Otherwise, leave canonical_user_id as-is (could be temporary ID)

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION cu_normalize_and_enforce IS 
'Comprehensive normalization with fallback logic. Only sets canonical_user_id for valid EVM wallet addresses.';

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'CANONICAL_USERS TRIGGER FIX - VERIFICATION';
  RAISE NOTICE '=====================================================';
  RAISE NOTICE '✓ Updated canonical_users_normalize_before_write()';
  RAISE NOTICE '  - Now validates extracted value is valid EVM address';
  RAISE NOTICE '  - Only sets wallet_address for 0x... 42-char addresses';
  RAISE NOTICE '';
  RAISE NOTICE '✓ Updated cu_normalize_and_enforce()';
  RAISE NOTICE '  - Only sets canonical_user_id for valid wallet addresses';
  RAISE NOTICE '  - Allows temporary IDs before wallet connection';
  RAISE NOTICE '';
  RAISE NOTICE 'Fix complete! User creation should now work with temporary IDs.';
  RAISE NOTICE '=====================================================';
END $$;

COMMIT;

-- ============================================================================
-- TESTING
-- ============================================================================
-- After applying this migration, test with:
--
-- 1. Test inserting user with temporary ID (should succeed):
--    INSERT INTO canonical_users (uid, canonical_user_id, email, username, country)
--    VALUES (
--      'test_email_abc123',
--      'prize:pid:test_email_abc123',
--      'test@example.com',
--      'testuser',
--      'US'
--    )
--    RETURNING id, canonical_user_id, wallet_address;
--    -- Expected: wallet_address should be NULL (not extracted from temp ID)
--
-- 2. Test inserting user with real wallet (should succeed):
--    INSERT INTO canonical_users (uid, canonical_user_id, wallet_address, email)
--    VALUES (
--      'test_wallet_123',
--      'prize:pid:0xabcdef1234567890abcdef1234567890abcdef12',
--      NULL,
--      'wallet@example.com'
--    )
--    RETURNING id, canonical_user_id, wallet_address;
--    -- Expected: wallet_address should be extracted and normalized
--
-- 3. Test updating temporary ID user with real wallet (should succeed):
--    UPDATE canonical_users
--    SET wallet_address = '0xABCDEF1234567890ABCDEF1234567890ABCDEF12'
--    WHERE uid = 'test_email_abc123'
--    RETURNING canonical_user_id, wallet_address;
--    -- Expected: canonical_user_id updated to 'prize:pid:0xabcdef...'
-- ============================================================================
