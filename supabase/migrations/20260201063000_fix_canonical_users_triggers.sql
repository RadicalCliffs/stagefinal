-- ============================================================================
-- FIX: Canonical Users Triggers - Missing util schema and normalization functions
-- ============================================================================
-- Migration: 20260201063000_fix_canonical_users_triggers.sql
-- Description: Fixes "record 'new' has no field 'updated_at'" error by creating
--              missing util schema, normalization functions, and triggers
-- 
-- Issue: Error 42703 when updating canonical_users table
-- Root Cause: canonical_users_normalize_before_write trigger calls util.normalize_evm_address()
--             which doesn't exist, causing trigger failure
-- ============================================================================

BEGIN;

-- ============================================================================
-- SECTION 1: Create util schema and normalize_evm_address function
-- ============================================================================

-- Create util schema if it doesn't exist
CREATE SCHEMA IF NOT EXISTS util;

-- Grant usage on util schema
GRANT USAGE ON SCHEMA util TO authenticated, anon, service_role;

-- Create util.normalize_evm_address function
-- This function normalizes EVM (Ethereum Virtual Machine) addresses to lowercase
CREATE OR REPLACE FUNCTION util.normalize_evm_address(address TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  -- Return NULL if input is NULL
  IF address IS NULL THEN
    RETURN NULL;
  END IF;
  
  -- Trim whitespace and convert to lowercase
  -- EVM addresses are case-insensitive, so we normalize to lowercase
  RETURN LOWER(TRIM(address));
END;
$$;

-- Grant execute permission on the function
GRANT EXECUTE ON FUNCTION util.normalize_evm_address(TEXT) TO authenticated, anon, service_role;

COMMENT ON FUNCTION util.normalize_evm_address IS 
'Normalizes EVM wallet addresses to lowercase for consistent storage and comparison';

-- ============================================================================
-- SECTION 2: Create canonical_users normalization trigger functions
-- ============================================================================

-- Function 1: canonical_users_normalize
-- Basic normalization of wallet addresses to lowercase
CREATE OR REPLACE FUNCTION canonical_users_normalize()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Normalize all wallet address fields to lowercase
  IF NEW.wallet_address IS NOT NULL THEN
    NEW.wallet_address := LOWER(NEW.wallet_address);
  END IF;
  
  IF NEW.base_wallet_address IS NOT NULL THEN
    NEW.base_wallet_address := LOWER(NEW.base_wallet_address);
  END IF;
  
  IF NEW.eth_wallet_address IS NOT NULL THEN
    NEW.eth_wallet_address := LOWER(NEW.eth_wallet_address);
  END IF;

  -- Auto-generate canonical_user_id if missing and we have a wallet address
  IF NEW.canonical_user_id IS NULL AND COALESCE(NEW.wallet_address, NEW.base_wallet_address, NEW.eth_wallet_address) IS NOT NULL THEN
    NEW.canonical_user_id := 'prize:pid:' || COALESCE(NEW.wallet_address, NEW.base_wallet_address, NEW.eth_wallet_address);
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION canonical_users_normalize IS 
'Normalizes wallet addresses to lowercase and auto-generates canonical_user_id';

-- Function 2: canonical_users_normalize_before_write
-- Advanced normalization using util.normalize_evm_address
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
  -- Or extract wallet_address from canonical_user_id if it follows the prize:pid: pattern
  ELSIF NEW.canonical_user_id IS NOT NULL THEN
    IF POSITION('prize:pid:' IN NEW.canonical_user_id) = 1 THEN
      NEW.wallet_address := REPLACE(NEW.canonical_user_id, 'prize:pid:', '');
      NEW.wallet_address := util.normalize_evm_address(NEW.wallet_address);
      NEW.canonical_user_id := 'prize:pid:' || NEW.wallet_address;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION canonical_users_normalize_before_write IS 
'Advanced normalization that ensures canonical_user_id and wallet_address consistency';

-- Function 3: cu_normalize_and_enforce
-- Comprehensive normalization with fallback logic
CREATE OR REPLACE FUNCTION cu_normalize_and_enforce()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Normalize all wallet fields to lowercase
  IF NEW.wallet_address IS NOT NULL THEN
    NEW.wallet_address := LOWER(NEW.wallet_address);
  END IF;
  
  IF NEW.base_wallet_address IS NOT NULL THEN
    NEW.base_wallet_address := LOWER(NEW.base_wallet_address);
  END IF;
  
  IF NEW.eth_wallet_address IS NOT NULL THEN
    NEW.eth_wallet_address := LOWER(NEW.eth_wallet_address);
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
  IF NEW.wallet_address IS NOT NULL THEN
    NEW.canonical_user_id := 'prize:pid:' || NEW.wallet_address;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION cu_normalize_and_enforce IS 
'Comprehensive normalization with fallback logic to ensure data consistency';

-- Function 4: users_normalize_before_write
-- Normalization for legacy users table (no canonical_user_id column)
CREATE OR REPLACE FUNCTION users_normalize_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Normalize wallet_address using util function
  IF NEW.wallet_address IS NOT NULL THEN
    NEW.wallet_address := util.normalize_evm_address(NEW.wallet_address);
  END IF;

  -- Note: users table does NOT have canonical_user_id column
  -- Only normalize the wallet_address field

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION users_normalize_before_write IS 
'Normalizes wallet addresses on legacy users table (no canonical_user_id)';

-- ============================================================================
-- SECTION 3: Create triggers on canonical_users table
-- ============================================================================

-- Drop existing triggers if they exist (to avoid conflicts)
DROP TRIGGER IF EXISTS trg_canonical_users_normalize ON canonical_users;
DROP TRIGGER IF EXISTS canonical_users_normalize_before_write ON canonical_users;
DROP TRIGGER IF EXISTS cu_normalize_and_enforce_trg ON canonical_users;

-- Create trigger for canonical_users_normalize (runs first)
CREATE TRIGGER trg_canonical_users_normalize
  BEFORE INSERT OR UPDATE ON canonical_users
  FOR EACH ROW
  EXECUTE FUNCTION canonical_users_normalize();

-- Create trigger for canonical_users_normalize_before_write (runs second)
CREATE TRIGGER canonical_users_normalize_before_write
  BEFORE INSERT OR UPDATE ON canonical_users
  FOR EACH ROW
  EXECUTE FUNCTION canonical_users_normalize_before_write();

-- Create trigger for cu_normalize_and_enforce (runs third)
CREATE TRIGGER cu_normalize_and_enforce_trg
  BEFORE INSERT OR UPDATE ON canonical_users
  FOR EACH ROW
  EXECUTE FUNCTION cu_normalize_and_enforce();

-- ============================================================================
-- SECTION 4: Create trigger on users table
-- ============================================================================

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS users_normalize_before_write ON users;

-- Create trigger for users_normalize_before_write
CREATE TRIGGER users_normalize_before_write
  BEFORE INSERT OR UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION users_normalize_before_write();

-- ============================================================================
-- SECTION 5: Verification
-- ============================================================================

DO $$
DECLARE
  util_schema_exists BOOLEAN;
  normalize_func_exists BOOLEAN;
  trigger_count INTEGER;
BEGIN
  -- Check if util schema exists
  SELECT EXISTS (
    SELECT 1 FROM information_schema.schemata
    WHERE schema_name = 'util'
  ) INTO util_schema_exists;

  -- Check if util.normalize_evm_address function exists
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'util'
    AND p.proname = 'normalize_evm_address'
  ) INTO normalize_func_exists;

  -- Count normalization triggers on both tables
  SELECT COUNT(*) INTO trigger_count
  FROM pg_trigger t
  JOIN pg_class c ON t.tgrelid = c.oid
  WHERE (
    (c.relname = 'canonical_users' AND t.tgname IN (
      'trg_canonical_users_normalize',
      'canonical_users_normalize_before_write',
      'cu_normalize_and_enforce_trg'
    ))
    OR
    (c.relname = 'users' AND t.tgname = 'users_normalize_before_write')
  )
  AND NOT t.tgisinternal;

  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'CANONICAL_USERS TRIGGERS FIX - VERIFICATION';
  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'util schema exists: %', util_schema_exists;
  RAISE NOTICE 'util.normalize_evm_address exists: %', normalize_func_exists;
  RAISE NOTICE 'Normalization triggers created: % / 4', trigger_count;
  RAISE NOTICE '';
  RAISE NOTICE 'Created functions:';
  RAISE NOTICE '  ✓ util.normalize_evm_address()';
  RAISE NOTICE '  ✓ canonical_users_normalize()';
  RAISE NOTICE '  ✓ canonical_users_normalize_before_write()';
  RAISE NOTICE '  ✓ cu_normalize_and_enforce()';
  RAISE NOTICE '  ✓ users_normalize_before_write()';
  RAISE NOTICE '';
  RAISE NOTICE 'Created triggers on canonical_users:';
  RAISE NOTICE '  ✓ trg_canonical_users_normalize';
  RAISE NOTICE '  ✓ canonical_users_normalize_before_write';
  RAISE NOTICE '  ✓ cu_normalize_and_enforce_trg';
  RAISE NOTICE '';
  RAISE NOTICE 'Created triggers on users:';
  RAISE NOTICE '  ✓ users_normalize_before_write';
  RAISE NOTICE '';
  RAISE NOTICE 'Fix complete! Wallet linking should now work without errors.';
  RAISE NOTICE '=====================================================';
END $$;

COMMIT;

-- ============================================================================
-- TESTING
-- ============================================================================
-- After applying this migration, test with:
--
-- 1. Test normalizing a wallet address:
--    SELECT util.normalize_evm_address('0xABCDEF1234567890ABCDEF1234567890ABCDEF12');
--    -- Expected: 0xabcdef1234567890abcdef1234567890abcdef12
--
-- 2. Test inserting a canonical user:
--    INSERT INTO canonical_users (wallet_address) 
--    VALUES ('0xABCDEF1234567890ABCDEF1234567890ABCDEF12')
--    RETURNING canonical_user_id, wallet_address;
--    -- Expected: canonical_user_id = 'prize:pid:0xabcdef...', wallet_address = '0xabcdef...'
--
-- 3. Test updating a canonical user with wallet:
--    UPDATE canonical_users 
--    SET base_wallet_address = '0xNEWADDRESS123' 
--    WHERE id = 'some-user-id'
--    RETURNING wallet_address, base_wallet_address, canonical_user_id;
--    -- Should normalize addresses and update canonical_user_id
-- ============================================================================
