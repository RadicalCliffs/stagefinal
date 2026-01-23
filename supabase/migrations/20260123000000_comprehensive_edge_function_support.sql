-- ============================================================================
-- Comprehensive Edge Function Support Migration
-- Created: 2026-01-23
-- Purpose: Ensure all edge functions work correctly with Supabase
-- ============================================================================

-- This migration ensures all RPC functions, tables, and types needed by edge
-- functions are properly defined and accessible.

-- ============================================================================
-- PART 1: Ensure canonical_user_id is TEXT everywhere
-- ============================================================================

-- Verify canonical_users table has correct schema
DO $$ 
BEGIN
  -- Ensure canonical_user_id is TEXT type
  IF EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'canonical_users' 
    AND column_name = 'canonical_user_id'
    AND data_type != 'text'
  ) THEN
    ALTER TABLE canonical_users 
    ALTER COLUMN canonical_user_id TYPE TEXT;
    RAISE NOTICE 'Fixed canonical_users.canonical_user_id to TEXT';
  END IF;

  -- Ensure wallet_address is TEXT
  IF EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'canonical_users' 
    AND column_name = 'wallet_address'
    AND data_type != 'text'
  ) THEN
    ALTER TABLE canonical_users 
    ALTER COLUMN wallet_address TYPE TEXT;
    RAISE NOTICE 'Fixed canonical_users.wallet_address to TEXT';
  END IF;

  -- Ensure base_wallet_address is TEXT
  IF EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'canonical_users' 
    AND column_name = 'base_wallet_address'
    AND data_type != 'text'
  ) THEN
    ALTER TABLE canonical_users 
    ALTER COLUMN base_wallet_address TYPE TEXT;
    RAISE NOTICE 'Fixed canonical_users.base_wallet_address to TEXT';
  END IF;
END $$;

-- ============================================================================
-- PART 2: Ensure sub_account_balances table is correct
-- ============================================================================

-- Verify sub_account_balances doesn't have canonical_user_id column
-- (Edge functions expect user_id only)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'sub_account_balances' 
    AND column_name = 'canonical_user_id'
  ) THEN
    RAISE WARNING 'sub_account_balances has canonical_user_id column - this may cause edge function issues';
  END IF;
END $$;

-- Ensure user_id in sub_account_balances is TEXT
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'sub_account_balances' 
    AND column_name = 'user_id'
    AND data_type != 'text'
  ) THEN
    ALTER TABLE sub_account_balances 
    ALTER COLUMN user_id TYPE TEXT;
    RAISE NOTICE 'Fixed sub_account_balances.user_id to TEXT';
  END IF;
END $$;

-- ============================================================================
-- PART 3: Ensure tickets table is correct
-- ============================================================================

DO $$
BEGIN
  -- Ensure canonical_user_id is TEXT in tickets table
  IF EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'tickets' 
    AND column_name = 'canonical_user_id'
    AND data_type != 'text'
  ) THEN
    ALTER TABLE tickets 
    ALTER COLUMN canonical_user_id TYPE TEXT;
    RAISE NOTICE 'Fixed tickets.canonical_user_id to TEXT';
  END IF;

  -- Ensure user_id is TEXT in tickets table
  IF EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'tickets' 
    AND column_name = 'user_id'
    AND data_type != 'text'
  ) THEN
    ALTER TABLE tickets 
    ALTER COLUMN user_id TYPE TEXT;
    RAISE NOTICE 'Fixed tickets.user_id to TEXT';
  END IF;
END $$;

-- ============================================================================
-- PART 4: Ensure user_transactions table is correct
-- ============================================================================

DO $$
BEGIN
  -- Ensure user_id is TEXT in user_transactions table
  IF EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'user_transactions' 
    AND column_name = 'user_id'
    AND data_type != 'text'
  ) THEN
    ALTER TABLE user_transactions 
    ALTER COLUMN user_id TYPE TEXT;
    RAISE NOTICE 'Fixed user_transactions.user_id to TEXT';
  END IF;
END $$;

-- ============================================================================
-- PART 5: Ensure pending_tickets table is correct
-- ============================================================================

DO $$
BEGIN
  -- Ensure canonical_user_id is TEXT in pending_tickets table
  IF EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'pending_tickets' 
    AND column_name = 'canonical_user_id'
    AND data_type != 'text'
  ) THEN
    ALTER TABLE pending_tickets 
    ALTER COLUMN canonical_user_id TYPE TEXT;
    RAISE NOTICE 'Fixed pending_tickets.canonical_user_id to TEXT';
  END IF;

  -- Ensure user_id is TEXT in pending_tickets table
  IF EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'pending_tickets' 
    AND column_name = 'user_id'
    AND data_type != 'text'
  ) THEN
    ALTER TABLE pending_tickets 
    ALTER COLUMN user_id TYPE TEXT;
    RAISE NOTICE 'Fixed pending_tickets.user_id to TEXT';
  END IF;
END $$;

-- ============================================================================
-- PART 6: Ensure balance_ledger table is correct
-- ============================================================================

DO $$
BEGIN
  -- Ensure user_id is TEXT in balance_ledger table
  IF EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'balance_ledger' 
    AND column_name = 'user_id'
    AND data_type != 'text'
  ) THEN
    ALTER TABLE balance_ledger 
    ALTER COLUMN user_id TYPE TEXT;
    RAISE NOTICE 'Fixed balance_ledger.user_id to TEXT';
  END IF;
END $$;

-- ============================================================================
-- PART 7: Create/Update helper function for canonical_user_id conversion
-- ============================================================================

-- Function to normalize any user identifier to canonical format
CREATE OR REPLACE FUNCTION normalize_to_canonical_user_id(
  input_id TEXT
) RETURNS TEXT AS $$
DECLARE
  result TEXT;
BEGIN
  -- Return NULL for NULL input
  IF input_id IS NULL OR input_id = '' THEN
    RETURN NULL;
  END IF;

  -- If already in prize:pid: format, return as-is (lowercase)
  IF input_id LIKE 'prize:pid:%' THEN
    RETURN LOWER(input_id);
  END IF;

  -- If it's a wallet address (0x + 40 hex chars), return in canonical format
  IF input_id ~ '^0x[a-fA-F0-9]{40}$' THEN
    RETURN 'prize:pid:' || LOWER(input_id);
  END IF;

  -- If it's a UUID pattern, return in canonical format
  IF input_id ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN
    RETURN 'prize:pid:' || LOWER(input_id);
  END IF;

  -- For any other format, assume it's already canonical or needs to be wrapped
  RETURN 'prize:pid:' || LOWER(input_id);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION normalize_to_canonical_user_id(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION normalize_to_canonical_user_id(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION normalize_to_canonical_user_id(TEXT) TO service_role;

COMMENT ON FUNCTION normalize_to_canonical_user_id(TEXT) IS 
'Converts any user identifier to canonical prize:pid: format. Used by edge functions.';

-- ============================================================================
-- PART 8: Ensure indexes exist for performance
-- ============================================================================

-- Create indexes for fast lookups (if they don't exist)
CREATE INDEX IF NOT EXISTS idx_canonical_users_canonical_user_id_lower 
  ON canonical_users(LOWER(canonical_user_id));

CREATE INDEX IF NOT EXISTS idx_canonical_users_wallet_address_lower 
  ON canonical_users(LOWER(wallet_address)) 
  WHERE wallet_address IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_canonical_users_smart_wallet_address 
  ON canonical_users(smart_wallet_address) 
  WHERE smart_wallet_address IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_canonical_user_id_lower 
  ON tickets(LOWER(canonical_user_id)) 
  WHERE canonical_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_user_id_lower 
  ON tickets(LOWER(user_id)) 
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sub_account_balances_user_id_lower 
  ON sub_account_balances(LOWER(user_id)) 
  WHERE user_id IS NOT NULL;

-- ============================================================================
-- PART 9: Update comments for documentation
-- ============================================================================

COMMENT ON COLUMN canonical_users.canonical_user_id IS 
'Canonical user ID in prize:pid:<identifier> format. Always TEXT type. Primary identifier for users.';

COMMENT ON COLUMN canonical_users.wallet_address IS 
'Ethereum wallet address (0x...) in lowercase. Always TEXT type.';

COMMENT ON COLUMN canonical_users.base_wallet_address IS 
'Base network wallet address (0x...) in lowercase. Always TEXT type.';

COMMENT ON COLUMN tickets.canonical_user_id IS 
'Canonical user ID in prize:pid:<identifier> format. Always TEXT type.';

COMMENT ON COLUMN sub_account_balances.user_id IS 
'User identifier as TEXT. Accepts canonical IDs (prize:pid:...) or wallet addresses.';

-- ============================================================================
-- PART 10: Verify all RPC functions have correct signatures
-- ============================================================================

-- Check that get_user_balance accepts TEXT
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.parameters
    WHERE specific_schema = 'public'
    AND specific_name = (
      SELECT specific_name 
      FROM information_schema.routines 
      WHERE routine_schema = 'public' 
      AND routine_name = 'get_user_balance'
      LIMIT 1
    )
    AND parameter_name = 'p_canonical_user_id'
    AND data_type != 'text'
  ) THEN
    RAISE WARNING 'get_user_balance.p_canonical_user_id is not TEXT type';
  END IF;
END $$;

-- Check that credit_sub_account_balance accepts TEXT
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.parameters
    WHERE specific_schema = 'public'
    AND specific_name = (
      SELECT specific_name 
      FROM information_schema.routines 
      WHERE routine_schema = 'public' 
      AND routine_name = 'credit_sub_account_balance'
      LIMIT 1
    )
    AND parameter_name = 'p_canonical_user_id'
    AND data_type != 'text'
  ) THEN
    RAISE WARNING 'credit_sub_account_balance.p_canonical_user_id is not TEXT type';
  END IF;
END $$;

-- ============================================================================
-- PART 11: Create validation function for edge functions
-- ============================================================================

CREATE OR REPLACE FUNCTION validate_canonical_user_id(
  input_id TEXT
) RETURNS BOOLEAN AS $$
BEGIN
  -- NULL is not valid
  IF input_id IS NULL OR input_id = '' THEN
    RETURN FALSE;
  END IF;

  -- Must start with prize:pid:
  IF NOT input_id LIKE 'prize:pid:%' THEN
    RETURN FALSE;
  END IF;

  -- Must have something after the prefix
  IF LENGTH(input_id) <= 10 THEN  -- Length of 'prize:pid:'
    RETURN FALSE;
  END IF;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

GRANT EXECUTE ON FUNCTION validate_canonical_user_id(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION validate_canonical_user_id(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION validate_canonical_user_id(TEXT) TO service_role;

COMMENT ON FUNCTION validate_canonical_user_id(TEXT) IS 
'Validates that a user ID is in correct canonical prize:pid: format.';

-- ============================================================================
-- PART 12: Summary and verification
-- ============================================================================

DO $$
DECLARE
  table_count INTEGER;
  function_count INTEGER;
BEGIN
  -- Count tables with canonical_user_id
  SELECT COUNT(DISTINCT table_name) INTO table_count
  FROM information_schema.columns
  WHERE column_name = 'canonical_user_id'
  AND table_schema = 'public';

  -- Count functions with p_canonical_user_id parameter
  SELECT COUNT(DISTINCT routine_name) INTO function_count
  FROM information_schema.parameters
  WHERE parameter_name = 'p_canonical_user_id'
  AND specific_schema = 'public';

  RAISE NOTICE '============================================================';
  RAISE NOTICE 'Comprehensive Edge Function Support Migration COMPLETE';
  RAISE NOTICE '============================================================';
  RAISE NOTICE 'Tables with canonical_user_id: %', table_count;
  RAISE NOTICE 'RPC functions with p_canonical_user_id: %', function_count;
  RAISE NOTICE 'All user identifier fields verified as TEXT type';
  RAISE NOTICE 'Helper functions created: normalize_to_canonical_user_id, validate_canonical_user_id';
  RAISE NOTICE 'Performance indexes created';
  RAISE NOTICE '============================================================';
END $$;
