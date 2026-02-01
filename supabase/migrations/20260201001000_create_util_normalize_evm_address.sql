-- ============================================================================
-- CREATE UTILITY FUNCTION: util.normalize_evm_address
-- ============================================================================
-- Migration: 20260201001000_create_util_normalize_evm_address.sql
-- Description: Creates the util schema and normalize_evm_address function
--              that is referenced by canonical_users triggers but was never defined
-- 
-- Issue: Signup failing with HTTP 400 because triggers call util.normalize_evm_address()
--        but the function doesn't exist
-- 
-- Root Cause: Previous migrations assumed util.normalize_evm_address existed in production
--             but it was never created in migration files
-- 
-- Solution: Create util schema and function to normalize EVM addresses to lowercase
-- ============================================================================

BEGIN;

-- ============================================================================
-- Create util schema if it doesn't exist
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS util;

COMMENT ON SCHEMA util IS 'Utility functions for common operations';

-- ============================================================================
-- Create normalize_evm_address function
-- ============================================================================

-- Use CREATE OR REPLACE for idempotency in case function exists from initial_schema.sql
-- This migration serves as a standalone fix for databases that already ran initial schema
-- before util.normalize_evm_address was added
CREATE OR REPLACE FUNCTION util.normalize_evm_address(address TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  -- If address is NULL, return NULL
  IF address IS NULL THEN
    RETURN NULL;
  END IF;
  
  -- Normalize to lowercase for EVM addresses
  -- EVM addresses are case-insensitive (except for checksummed addresses)
  -- We store all addresses in lowercase for consistency
  RETURN LOWER(address);
END;
$$;

COMMENT ON FUNCTION util.normalize_evm_address IS 
'Normalizes EVM wallet addresses to lowercase for consistent storage and comparison';

-- Grant execute permission to authenticated users and service role
GRANT EXECUTE ON FUNCTION util.normalize_evm_address(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION util.normalize_evm_address(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION util.normalize_evm_address(TEXT) TO anon;

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'UTIL.NORMALIZE_EVM_ADDRESS CREATED';
  RAISE NOTICE '=====================================================';
  RAISE NOTICE '✓ Created util schema';
  RAISE NOTICE '✓ Created util.normalize_evm_address() function';
  RAISE NOTICE '✓ Granted execute permissions';
  RAISE NOTICE '';
  RAISE NOTICE 'Function normalizes EVM addresses to lowercase:';
  RAISE NOTICE '  Example: 0xABCDEF... → 0xabcdef...';
  RAISE NOTICE '';
  RAISE NOTICE 'This fixes signup flow errors where triggers failed';
  RAISE NOTICE 'because util.normalize_evm_address was undefined.';
  RAISE NOTICE '=====================================================';
END $$;

COMMIT;

-- ============================================================================
-- TESTING
-- ============================================================================
-- After applying this migration, test with:
--
-- 1. Test function works:
--    SELECT util.normalize_evm_address('0xABCDEF1234567890ABCDEF1234567890ABCDEF12');
--    -- Expected: '0xabcdef1234567890abcdef1234567890abcdef12'
--
-- 2. Test with NULL:
--    SELECT util.normalize_evm_address(NULL);
--    -- Expected: NULL
--
-- 3. Test signup flow:
--    INSERT INTO canonical_users (uid, canonical_user_id, email, username)
--    VALUES (
--      'test_email_abc123',
--      'prize:pid:test_email_abc123',
--      'test@example.com',
--      'testuser'
--    )
--    RETURNING id, canonical_user_id, wallet_address;
--    -- Expected: Success, wallet_address should be NULL
-- ============================================================================
