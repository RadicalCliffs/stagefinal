-- ============================================================================
-- FIX TABLE SCHEMAS: Change user_id columns from UUID to TEXT
-- ============================================================================
-- This migration fixes the core issue causing "invalid input syntax for type uuid"
-- errors when querying tables with wallet addresses or canonical_user_id values.
--
-- Problem:
-- - tickets.user_id is UUID but frontend passes TEXT wallet addresses
-- - user_transactions.user_id is UUID but should accept TEXT identifiers
-- - pending_tickets.user_id is UUID but should accept TEXT identifiers
--
-- These tables need user_id as TEXT to accept:
-- - Wallet addresses: "0x2137af5047526a1180580ab02985a818b1d9c789"
-- - Canonical IDs: "prize:pid:0x..."
-- - Legacy Privy DIDs: "did:privy:..."
--
-- Date: 2026-01-20
-- ============================================================================

BEGIN;

-- ============================================================================
-- PART 1: Fix tickets.user_id from UUID to TEXT
-- ============================================================================

DO $$
BEGIN
  -- Check if tickets.user_id is currently UUID type
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tickets'
      AND column_name = 'user_id'
      AND data_type = 'uuid'
  ) THEN
    RAISE NOTICE 'Converting tickets.user_id from UUID to TEXT';
    
    -- Convert the column from UUID to TEXT
    -- This will preserve existing data by casting UUID values to TEXT
    ALTER TABLE public.tickets
      ALTER COLUMN user_id TYPE TEXT USING user_id::TEXT;
    
    RAISE NOTICE '✓ tickets.user_id converted to TEXT';
  ELSE
    RAISE NOTICE 'tickets.user_id is already TEXT or does not exist';
  END IF;
END $$;

-- ============================================================================
-- PART 2: Fix user_transactions.user_id from UUID to TEXT (if exists)
-- ============================================================================

DO $$
BEGIN
  -- Check if user_transactions.user_id exists and is UUID type
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_transactions'
      AND column_name = 'user_id'
      AND data_type = 'uuid'
  ) THEN
    RAISE NOTICE 'Converting user_transactions.user_id from UUID to TEXT';
    
    ALTER TABLE public.user_transactions
      ALTER COLUMN user_id TYPE TEXT USING user_id::TEXT;
    
    RAISE NOTICE '✓ user_transactions.user_id converted to TEXT';
  ELSE
    RAISE NOTICE 'user_transactions.user_id is already TEXT or does not exist';
  END IF;
END $$;

-- ============================================================================
-- PART 3: Fix pending_tickets.user_id from UUID to TEXT (if exists)
-- ============================================================================

DO $$
BEGIN
  -- Check if pending_tickets.user_id exists and is UUID type
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'pending_tickets'
      AND column_name = 'user_id'
      AND data_type = 'uuid'
  ) THEN
    RAISE NOTICE 'Converting pending_tickets.user_id from UUID to TEXT';
    
    ALTER TABLE public.pending_tickets
      ALTER COLUMN user_id TYPE TEXT USING user_id::TEXT;
    
    RAISE NOTICE '✓ pending_tickets.user_id converted to TEXT';
  ELSE
    RAISE NOTICE 'pending_tickets.user_id is already TEXT or does not exist';
  END IF;
END $$;

-- ============================================================================
-- PART 4: Fix balance_ledger.user_id from UUID to TEXT (if exists)
-- ============================================================================
-- The balance_ledger table may have user_id as UUID from older migrations

DO $$
BEGIN
  -- Check if balance_ledger.user_id exists and is UUID type
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'balance_ledger'
      AND column_name = 'user_id'
      AND data_type = 'uuid'
  ) THEN
    RAISE NOTICE 'Converting balance_ledger.user_id from UUID to TEXT';
    
    -- Drop any foreign key constraints first (if they exist)
    ALTER TABLE public.balance_ledger
      DROP CONSTRAINT IF EXISTS balance_ledger_user_id_fkey;
    
    -- Convert the column
    ALTER TABLE public.balance_ledger
      ALTER COLUMN user_id TYPE TEXT USING user_id::TEXT;
    
    RAISE NOTICE '✓ balance_ledger.user_id converted to TEXT';
  ELSE
    RAISE NOTICE 'balance_ledger.user_id is already TEXT, does not exist, or table uses canonical_user_id';
  END IF;
END $$;

-- ============================================================================
-- PART 5: Fix wallet_balances.user_id from UUID to TEXT (if exists)
-- ============================================================================

DO $$
BEGIN
  -- Check if wallet_balances.user_id exists and is UUID type
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'wallet_balances'
      AND column_name = 'user_id'
      AND data_type = 'uuid'
  ) THEN
    RAISE NOTICE 'Converting wallet_balances.user_id from UUID to TEXT';
    
    -- Drop any foreign key constraints first (if they exist)
    ALTER TABLE public.wallet_balances
      DROP CONSTRAINT IF EXISTS wallet_balances_user_id_fkey;
    
    -- Drop unique constraint if exists (we'll recreate based on canonical_user_id)
    ALTER TABLE public.wallet_balances
      DROP CONSTRAINT IF EXISTS wallet_balances_user_id_key;
    
    -- Convert the column
    ALTER TABLE public.wallet_balances
      ALTER COLUMN user_id TYPE TEXT USING user_id::TEXT;
    
    RAISE NOTICE '✓ wallet_balances.user_id converted to TEXT';
  ELSE
    RAISE NOTICE 'wallet_balances.user_id is already TEXT or does not exist';
  END IF;
END $$;

-- ============================================================================
-- PART 6: Recreate indexes for better query performance
-- ============================================================================

-- Drop old UUID-based indexes if they exist
DROP INDEX IF EXISTS idx_tickets_user_id;
DROP INDEX IF EXISTS idx_user_transactions_user_id;
DROP INDEX IF EXISTS idx_pending_tickets_user_id;
DROP INDEX IF EXISTS idx_balance_ledger_user_id;
DROP INDEX IF EXISTS idx_wallet_balances_user_id;

-- Create new TEXT-optimized indexes with case-insensitive support
CREATE INDEX IF NOT EXISTS idx_tickets_user_id_lower 
  ON public.tickets(LOWER(user_id))
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_canonical_user_id_lower 
  ON public.tickets(LOWER(canonical_user_id))
  WHERE canonical_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_transactions_user_id_lower 
  ON public.user_transactions(LOWER(user_id))
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pending_tickets_user_id_lower 
  ON public.pending_tickets(LOWER(user_id))
  WHERE user_id IS NOT NULL;

-- ============================================================================
-- PART 7: Update comments for documentation
-- ============================================================================

COMMENT ON COLUMN public.tickets.user_id IS 
  'User identifier as TEXT - accepts wallet addresses (0x...), canonical IDs (prize:pid:0x...), or Privy DIDs. NEVER UUID.';

COMMENT ON COLUMN public.tickets.canonical_user_id IS 
  'Canonical user ID in prize:pid:0x... format. Primary identifier for user lookups.';

-- ============================================================================
-- Verification and Summary
-- ============================================================================

DO $$
DECLARE
  tickets_type TEXT;
  user_trans_type TEXT;
  pending_type TEXT;
  balance_ledger_type TEXT;
  wallet_bal_type TEXT;
BEGIN
  -- Get current data types
  SELECT data_type INTO tickets_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'tickets'
    AND column_name = 'user_id';
  
  SELECT data_type INTO user_trans_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'user_transactions'
    AND column_name = 'user_id';
  
  SELECT data_type INTO pending_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'pending_tickets'
    AND column_name = 'user_id';
  
  SELECT data_type INTO balance_ledger_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'balance_ledger'
    AND column_name = 'user_id';
  
  SELECT data_type INTO wallet_bal_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'wallet_balances'
    AND column_name = 'user_id';
  
  -- Print summary
  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'FIX: user_id Columns UUID → TEXT Conversion';
  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'tickets.user_id type: %', COALESCE(tickets_type, 'COLUMN DOES NOT EXIST');
  RAISE NOTICE 'user_transactions.user_id type: %', COALESCE(user_trans_type, 'COLUMN DOES NOT EXIST');
  RAISE NOTICE 'pending_tickets.user_id type: %', COALESCE(pending_type, 'COLUMN DOES NOT EXIST');
  RAISE NOTICE 'balance_ledger.user_id type: %', COALESCE(balance_ledger_type, 'COLUMN DOES NOT EXIST');
  RAISE NOTICE 'wallet_balances.user_id type: %', COALESCE(wallet_bal_type, 'COLUMN DOES NOT EXIST');
  
  -- Verify all are TEXT or don't exist
  IF (tickets_type IS NULL OR tickets_type IN ('text', 'character varying'))
     AND (user_trans_type IS NULL OR user_trans_type IN ('text', 'character varying'))
     AND (pending_type IS NULL OR pending_type IN ('text', 'character varying'))
     AND (balance_ledger_type IS NULL OR balance_ledger_type IN ('text', 'character varying'))
     AND (wallet_bal_type IS NULL OR wallet_bal_type IN ('text', 'character varying')) THEN
    RAISE NOTICE '✓ SUCCESS: All user_id columns are TEXT (or do not exist)';
  ELSE
    RAISE WARNING '✗ WARNING: Some user_id columns are still UUID';
  END IF;
  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'Frontend can now query with wallet addresses without UUID casting errors';
  RAISE NOTICE '=====================================================';
END $$;

COMMIT;
