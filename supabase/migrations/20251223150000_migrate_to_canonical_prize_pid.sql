-- =====================================================
-- CANONICAL PRIZE:PID: USER ID MIGRATION
-- =====================================================
-- This migration converts ALL user identifiers across the database
-- to the canonical prize:pid:<id> format with case-insensitive
-- wallet addresses.
--
-- CRITICAL: This is a ONE-TIME migration that will:
-- 1. Normalize all wallet addresses to lowercase
-- 2. Convert all user IDs to prize:pid: format
-- 3. Remove Privy DID dependencies
-- 4. Ensure data consistency across all tables
--
-- TABLES AFFECTED:
-- - privy_user_connections (primary user table)
-- - joincompetition (competition entries)
-- - pending_tickets (ticket reservations)
-- - user_transactions (payment transactions)
-- - balance_ledger (balance operations)
--
-- RUN THIS SCRIPT IN A TRANSACTION TO ENSURE ATOMICITY
-- =====================================================

BEGIN;

-- =====================================================
-- STEP 1: Add canonical_user_id column to key tables
-- =====================================================

-- Add canonical_user_id to privy_user_connections if not exists
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'privy_user_connections' 
    AND column_name = 'canonical_user_id'
  ) THEN
    ALTER TABLE privy_user_connections ADD COLUMN canonical_user_id TEXT;
  END IF;
END $$;

-- =====================================================
-- STEP 2: Normalize wallet addresses to lowercase
-- =====================================================

-- Normalize wallet addresses in privy_user_connections
UPDATE privy_user_connections
SET 
  wallet_address = LOWER(wallet_address)
WHERE wallet_address IS NOT NULL 
  AND wallet_address ~ '^0x[0-9a-fA-F]{40}$';

UPDATE privy_user_connections
SET 
  base_wallet_address = LOWER(base_wallet_address)
WHERE base_wallet_address IS NOT NULL 
  AND base_wallet_address ~ '^0x[0-9a-fA-F]{40}$';

UPDATE privy_user_connections
SET 
  eth_wallet_address = LOWER(eth_wallet_address)
WHERE eth_wallet_address IS NOT NULL 
  AND eth_wallet_address ~ '^0x[0-9a-fA-F]{40}$';

-- Normalize wallet addresses in joincompetition
UPDATE joincompetition
SET 
  walletaddress = LOWER(walletaddress)
WHERE walletaddress IS NOT NULL 
  AND walletaddress ~ '^0x[0-9a-fA-F]{40}$';

-- Normalize wallet addresses in pending_tickets
UPDATE pending_tickets
SET 
  wallet_address = LOWER(wallet_address)
WHERE wallet_address IS NOT NULL 
  AND wallet_address ~ '^0x[0-9a-fA-F]{40}$';

-- Normalize wallet addresses in user_transactions (if exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_name = 'user_transactions'
  ) THEN
    UPDATE user_transactions
    SET 
      wallet_address = LOWER(wallet_address)
    WHERE wallet_address IS NOT NULL 
      AND wallet_address ~ '^0x[0-9a-fA-F]{40}$';
  END IF;
END $$;

-- =====================================================
-- STEP 3: Convert to canonical prize:pid: format
-- =====================================================

-- Function to convert any identifier to prize:pid: format
CREATE OR REPLACE FUNCTION to_prize_pid(input_id TEXT)
RETURNS TEXT AS $$
BEGIN
  -- Return NULL for NULL input
  IF input_id IS NULL OR TRIM(input_id) = '' THEN
    RETURN 'prize:pid:' || gen_random_uuid()::TEXT;
  END IF;
  
  -- Already in prize:pid: format - normalize
  IF input_id LIKE 'prize:pid:%' THEN
    -- Extract the ID part
    DECLARE
      extracted TEXT := SUBSTRING(input_id FROM 11);
    BEGIN
      -- If it's a wallet, ensure lowercase
      IF extracted ~ '^0x[0-9a-fA-F]{40}$' THEN
        RETURN 'prize:pid:' || LOWER(extracted);
      END IF;
      RETURN LOWER(input_id);
    END;
  END IF;
  
  -- Wallet address - normalize to lowercase
  IF input_id ~ '^0x[0-9a-fA-F]{40}$' THEN
    RETURN 'prize:pid:' || LOWER(input_id);
  END IF;
  
  -- UUID pattern
  IF input_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN 'prize:pid:' || LOWER(input_id);
  END IF;
  
  -- Privy DID (legacy) - extract the part after "did:privy:"
  IF input_id LIKE 'did:privy:%' THEN
    DECLARE
      privy_part TEXT := SUBSTRING(input_id FROM 11);
    BEGIN
      -- If the privy part looks like a UUID, use it
      IF privy_part ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN 'prize:pid:' || LOWER(privy_part);
      END IF;
      -- Otherwise generate a new UUID
      RETURN 'prize:pid:' || gen_random_uuid()::TEXT;
    END;
  END IF;
  
  -- For any other identifier, generate a new UUID
  RETURN 'prize:pid:' || gen_random_uuid()::TEXT;
END;
$$ LANGUAGE plpgsql VOLATILE;

-- =====================================================
-- STEP 4: Populate canonical_user_id in privy_user_connections
-- =====================================================

-- Update canonical_user_id based on priority:
-- 1. wallet_address (primary for Base auth)
-- 2. base_wallet_address
-- 3. privy_user_id (for legacy Privy users)
-- 4. uid (fallback)
UPDATE privy_user_connections
SET canonical_user_id = CASE
  WHEN wallet_address IS NOT NULL AND wallet_address ~ '^0x[0-9a-fA-F]{40}$' 
    THEN to_prize_pid(LOWER(wallet_address))
  WHEN base_wallet_address IS NOT NULL AND base_wallet_address ~ '^0x[0-9a-fA-F]{40}$'
    THEN to_prize_pid(LOWER(base_wallet_address))
  WHEN privy_user_id IS NOT NULL
    THEN to_prize_pid(privy_user_id)
  WHEN uid IS NOT NULL
    THEN to_prize_pid(uid)
  ELSE to_prize_pid(NULL)
END
WHERE canonical_user_id IS NULL;

-- =====================================================
-- STEP 5: Convert joincompetition table
-- =====================================================

-- Update userid to canonical format
UPDATE joincompetition
SET userid = CASE
  WHEN walletaddress IS NOT NULL AND walletaddress ~ '^0x[0-9a-fA-F]{40}$'
    THEN to_prize_pid(LOWER(walletaddress))
  WHEN userid ~ '^0x[0-9a-fA-F]{40}$'
    THEN to_prize_pid(LOWER(userid))
  WHEN userid LIKE 'prize:pid:%'
    THEN to_prize_pid(userid)
  WHEN userid LIKE 'did:privy:%'
    THEN to_prize_pid(userid)
  ELSE to_prize_pid(userid)
END
WHERE userid NOT LIKE 'prize:pid:%';

-- =====================================================
-- STEP 6: Convert pending_tickets table
-- =====================================================

UPDATE pending_tickets
SET user_id = CASE
  WHEN wallet_address IS NOT NULL AND wallet_address ~ '^0x[0-9a-fA-F]{40}$'
    THEN to_prize_pid(LOWER(wallet_address))
  WHEN user_id ~ '^0x[0-9a-fA-F]{40}$'
    THEN to_prize_pid(LOWER(user_id))
  WHEN user_id LIKE 'prize:pid:%'
    THEN to_prize_pid(user_id)
  WHEN user_id LIKE 'did:privy:%'
    THEN to_prize_pid(user_id)
  ELSE to_prize_pid(user_id)
END
WHERE user_id NOT LIKE 'prize:pid:%';

-- =====================================================
-- STEP 7: Convert user_transactions table (if exists)
-- =====================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_name = 'user_transactions'
  ) THEN
    UPDATE user_transactions
    SET user_id = CASE
      WHEN wallet_address IS NOT NULL AND wallet_address ~ '^0x[0-9a-fA-F]{40}$'
        THEN to_prize_pid(LOWER(wallet_address))
      WHEN user_id ~ '^0x[0-9a-fA-F]{40}$'
        THEN to_prize_pid(LOWER(user_id))
      WHEN user_id LIKE 'prize:pid:%'
        THEN to_prize_pid(user_id)
      WHEN user_id LIKE 'did:privy:%'
        THEN to_prize_pid(user_id)
      ELSE to_prize_pid(user_id)
    END
    WHERE user_id NOT LIKE 'prize:pid:%';
  END IF;
END $$;

-- =====================================================
-- STEP 8: Convert balance_ledger table (if exists)
-- =====================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_name = 'balance_ledger'
  ) THEN
    UPDATE balance_ledger
    SET user_id = CASE
      WHEN user_id ~ '^0x[0-9a-fA-F]{40}$'
        THEN to_prize_pid(LOWER(user_id))
      WHEN user_id LIKE 'prize:pid:%'
        THEN to_prize_pid(user_id)
      WHEN user_id LIKE 'did:privy:%'
        THEN to_prize_pid(user_id)
      ELSE to_prize_pid(user_id)
    END
    WHERE user_id NOT LIKE 'prize:pid:%';
  END IF;
END $$;

-- =====================================================
-- STEP 9: Create indexes for canonical_user_id
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_privy_user_connections_canonical_user_id 
  ON privy_user_connections(canonical_user_id);

CREATE INDEX IF NOT EXISTS idx_joincompetition_userid_canonical 
  ON joincompetition(userid) WHERE userid LIKE 'prize:pid:%';

CREATE INDEX IF NOT EXISTS idx_pending_tickets_user_id_canonical 
  ON pending_tickets(user_id) WHERE user_id LIKE 'prize:pid:%';

-- =====================================================
-- STEP 10: Add constraints to enforce canonical format
-- =====================================================

-- Add check constraint to ensure new records use canonical format
-- (Note: This is commented out to avoid breaking existing code during transition)
-- Uncomment after all code is updated to use prize:pid: format

-- ALTER TABLE privy_user_connections
--   ADD CONSTRAINT chk_canonical_user_id_format
--   CHECK (canonical_user_id LIKE 'prize:pid:%');

-- ALTER TABLE joincompetition
--   ADD CONSTRAINT chk_userid_canonical_format
--   CHECK (userid LIKE 'prize:pid:%');

-- ALTER TABLE pending_tickets
--   ADD CONSTRAINT chk_user_id_canonical_format
--   CHECK (user_id LIKE 'prize:pid:%');

-- =====================================================
-- STEP 11: Create audit function to find non-canonical IDs
-- =====================================================

CREATE OR REPLACE FUNCTION audit_non_canonical_user_ids()
RETURNS TABLE(
  table_name TEXT,
  column_name TEXT,
  non_canonical_count BIGINT,
  example_values TEXT[]
) AS $$
BEGIN
  -- Check privy_user_connections
  RETURN QUERY
  SELECT 
    'privy_user_connections'::TEXT,
    'canonical_user_id'::TEXT,
    COUNT(*)::BIGINT,
    ARRAY_AGG(DISTINCT canonical_user_id)::TEXT[]
  FROM privy_user_connections
  WHERE canonical_user_id NOT LIKE 'prize:pid:%'
    OR canonical_user_id IS NULL
  HAVING COUNT(*) > 0;
  
  -- Check joincompetition
  RETURN QUERY
  SELECT 
    'joincompetition'::TEXT,
    'userid'::TEXT,
    COUNT(*)::BIGINT,
    ARRAY_AGG(DISTINCT userid LIMIT 5)::TEXT[]
  FROM joincompetition
  WHERE userid NOT LIKE 'prize:pid:%'
    OR userid IS NULL
  HAVING COUNT(*) > 0;
  
  -- Check pending_tickets
  RETURN QUERY
  SELECT 
    'pending_tickets'::TEXT,
    'user_id'::TEXT,
    COUNT(*)::BIGINT,
    ARRAY_AGG(DISTINCT user_id LIMIT 5)::TEXT[]
  FROM pending_tickets
  WHERE user_id NOT LIKE 'prize:pid:%'
    OR user_id IS NULL
  HAVING COUNT(*) > 0;
  
  RETURN;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- STEP 12: Log migration results
-- =====================================================

DO $$
DECLARE
  rec RECORD;
BEGIN
  RAISE NOTICE '==============================================';
  RAISE NOTICE 'CANONICAL USER ID MIGRATION COMPLETE';
  RAISE NOTICE '==============================================';
  
  -- Count canonical IDs in each table
  FOR rec IN 
    SELECT 'privy_user_connections' as tbl, COUNT(*) as total,
           COUNT(CASE WHEN canonical_user_id LIKE 'prize:pid:%' THEN 1 END) as canonical
    FROM privy_user_connections
    UNION ALL
    SELECT 'joincompetition', COUNT(*),
           COUNT(CASE WHEN userid LIKE 'prize:pid:%' THEN 1 END)
    FROM joincompetition
    UNION ALL
    SELECT 'pending_tickets', COUNT(*),
           COUNT(CASE WHEN user_id LIKE 'prize:pid:%' THEN 1 END)
    FROM pending_tickets
  LOOP
    RAISE NOTICE 'Table: % - Total: %, Canonical: %', rec.tbl, rec.total, rec.canonical;
  END LOOP;
  
  RAISE NOTICE '==============================================';
  RAISE NOTICE 'Run SELECT * FROM audit_non_canonical_user_ids() to check for issues';
  RAISE NOTICE '==============================================';
END $$;

COMMIT;

-- =====================================================
-- POST-MIGRATION VERIFICATION
-- =====================================================
-- Run this query to verify the migration:
-- SELECT * FROM audit_non_canonical_user_ids();
--
-- Expected result: No rows (all IDs are canonical)
-- =====================================================
