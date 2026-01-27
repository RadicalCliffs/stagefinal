/*
  # Universal Wallet Address Normalization (Point 2)

  ## Problem
  Ethereum wallet addresses are case-insensitive functionally (0xABC == 0xabc),
  but they are stored with different casing from different sources:
  - MetaMask uses checksummed addresses (mixed case)
  - Some SDKs store lowercase
  - Some store uppercase

  This causes wallet matching failures when:
  - User connects with checksummed address but data is stored lowercase
  - Queries use exact matching instead of case-insensitive
  - LOWER() is called on every query (performance impact)

  ## Solution
  1. Create a trigger function to auto-lowercase wallet addresses on INSERT/UPDATE
  2. Apply the trigger to all tables with wallet address columns
  3. Backfill existing data to lowercase
  4. Create functional indexes for performance (if not exists)

  ## Tables Affected
  - joincompetition (walletaddress)
  - user_transactions (wallet_address)
  - privy_user_connections (wallet_address, base_wallet_address, linked_external_wallet)
  - pending_tickets (user_id when it's a wallet address)
  - competitions (winner_wallet_address)
  - tickets (privy_user_id when it's a wallet address)
*/

-- ============================================================================
-- STEP 1: Create reusable wallet normalization function
-- ============================================================================

CREATE OR REPLACE FUNCTION normalize_wallet_address_value(address TEXT)
RETURNS TEXT AS $$
BEGIN
  IF address IS NULL THEN
    RETURN NULL;
  END IF;

  -- Check if it's a wallet address pattern (0x followed by 40 hex chars)
  IF address ~ '^0x[a-fA-F0-9]{40}$' THEN
    RETURN LOWER(address);
  END IF;

  -- Not a wallet address, return as-is (preserve case for other identifiers)
  RETURN address;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION normalize_wallet_address_value(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION normalize_wallet_address_value(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION normalize_wallet_address_value(TEXT) TO service_role;

COMMENT ON FUNCTION normalize_wallet_address_value(TEXT) IS
'Normalizes a wallet address to lowercase if it matches the Ethereum address pattern (0x + 40 hex chars).
Non-wallet values are returned as-is to preserve case for UUIDs, emails, etc.';

-- ============================================================================
-- STEP 2: Create trigger function for joincompetition table
-- ============================================================================

CREATE OR REPLACE FUNCTION normalize_joincompetition_wallet_trigger()
RETURNS TRIGGER AS $$
BEGIN
  -- Normalize walletaddress column
  IF NEW.walletaddress IS NOT NULL AND NEW.walletaddress ~ '^0x[a-fA-F0-9]{40}$' THEN
    NEW.walletaddress := LOWER(NEW.walletaddress);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if present
DROP TRIGGER IF EXISTS normalize_wallet_on_insert_update ON joincompetition;

-- Create trigger
CREATE TRIGGER normalize_wallet_on_insert_update
  BEFORE INSERT OR UPDATE ON joincompetition
  FOR EACH ROW
  EXECUTE FUNCTION normalize_joincompetition_wallet_trigger();

-- ============================================================================
-- STEP 3: Create trigger function for user_transactions table
-- ============================================================================

CREATE OR REPLACE FUNCTION normalize_user_transactions_wallet_trigger()
RETURNS TRIGGER AS $$
BEGIN
  -- Normalize wallet_address column
  IF NEW.wallet_address IS NOT NULL AND NEW.wallet_address ~ '^0x[a-fA-F0-9]{40}$' THEN
    NEW.wallet_address := LOWER(NEW.wallet_address);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if present
DROP TRIGGER IF EXISTS normalize_wallet_on_insert_update ON user_transactions;

-- Create trigger
CREATE TRIGGER normalize_wallet_on_insert_update
  BEFORE INSERT OR UPDATE ON user_transactions
  FOR EACH ROW
  EXECUTE FUNCTION normalize_user_transactions_wallet_trigger();

-- ============================================================================
-- STEP 4: Create trigger function for privy_user_connections table
-- ============================================================================

CREATE OR REPLACE FUNCTION normalize_privy_user_connections_wallet_trigger()
RETURNS TRIGGER AS $$
BEGIN
  -- Normalize wallet_address column
  IF NEW.wallet_address IS NOT NULL AND NEW.wallet_address ~ '^0x[a-fA-F0-9]{40}$' THEN
    NEW.wallet_address := LOWER(NEW.wallet_address);
  END IF;

  -- Normalize base_wallet_address column
  IF NEW.base_wallet_address IS NOT NULL AND NEW.base_wallet_address ~ '^0x[a-fA-F0-9]{40}$' THEN
    NEW.base_wallet_address := LOWER(NEW.base_wallet_address);
  END IF;

  -- Normalize linked_external_wallet column (if it exists)
  IF TG_TABLE_NAME = 'privy_user_connections' THEN
    BEGIN
      IF NEW.linked_external_wallet IS NOT NULL AND NEW.linked_external_wallet ~ '^0x[a-fA-F0-9]{40}$' THEN
        NEW.linked_external_wallet := LOWER(NEW.linked_external_wallet);
      END IF;
    EXCEPTION WHEN undefined_column THEN
      -- Column doesn't exist, skip
      NULL;
    END;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if present
DROP TRIGGER IF EXISTS normalize_wallet_on_insert_update ON privy_user_connections;

-- Create trigger
CREATE TRIGGER normalize_wallet_on_insert_update
  BEFORE INSERT OR UPDATE ON privy_user_connections
  FOR EACH ROW
  EXECUTE FUNCTION normalize_privy_user_connections_wallet_trigger();

-- ============================================================================
-- STEP 5: Create trigger function for competitions table (winner_wallet_address)
-- ============================================================================

CREATE OR REPLACE FUNCTION normalize_competitions_wallet_trigger()
RETURNS TRIGGER AS $$
BEGIN
  -- Normalize winner_wallet_address column
  IF NEW.winner_wallet_address IS NOT NULL AND NEW.winner_wallet_address ~ '^0x[a-fA-F0-9]{40}$' THEN
    NEW.winner_wallet_address := LOWER(NEW.winner_wallet_address);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if present
DROP TRIGGER IF EXISTS normalize_wallet_on_insert_update ON competitions;

-- Create trigger
CREATE TRIGGER normalize_wallet_on_insert_update
  BEFORE INSERT OR UPDATE ON competitions
  FOR EACH ROW
  EXECUTE FUNCTION normalize_competitions_wallet_trigger();

-- ============================================================================
-- STEP 6: Backfill existing data to lowercase
-- ============================================================================

-- Normalize joincompetition.walletaddress
UPDATE joincompetition
SET wallet_address = LOWER(wallet_address)
WHERE wallet_address ~ '^0x[a-fA-F0-9]{40}$'
  AND wallet_address != LOWER(wallet_address);

-- Normalize user_transactions.wallet_address
UPDATE user_transactions
SET wallet_address = LOWER(wallet_address)
WHERE wallet_address ~ '^0x[a-fA-F0-9]{40}$'
  AND wallet_address != LOWER(wallet_address);

-- Normalize privy_user_connections wallet columns
UPDATE privy_user_connections
SET
  wallet_address = CASE
    WHEN wallet_address ~ '^0x[a-fA-F0-9]{40}$' THEN LOWER(wallet_address)
    ELSE wallet_address
  END,
  base_wallet_address = CASE
    WHEN base_wallet_address ~ '^0x[a-fA-F0-9]{40}$' THEN LOWER(base_wallet_address)
    ELSE base_wallet_address
  END
WHERE (wallet_address ~ '^0x[a-fA-F0-9]{40}$' AND wallet_address != LOWER(wallet_address))
   OR (base_wallet_address ~ '^0x[a-fA-F0-9]{40}$' AND base_wallet_address != LOWER(base_wallet_address));

-- Normalize linked_external_wallet if column exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'privy_user_connections' AND column_name = 'linked_external_wallet'
  ) THEN
    EXECUTE 'UPDATE privy_user_connections
             SET linked_external_wallet = LOWER(linked_external_wallet)
             WHERE linked_external_wallet ~ ''^0x[a-fA-F0-9]{40}$''
               AND linked_external_wallet != LOWER(linked_external_wallet)';
  END IF;
END $$;

-- Normalize competitions.winner_wallet_address
UPDATE competitions
SET winner_wallet_address = LOWER(winner_wallet_address)
WHERE winner_wallet_address ~ '^0x[a-fA-F0-9]{40}$'
  AND winner_wallet_address != LOWER(winner_wallet_address);

-- ============================================================================
-- STEP 7: Create functional indexes for case-insensitive queries
-- (Only if they don't exist already to avoid duplicate index errors)
-- ============================================================================

DO $$
BEGIN
  -- Index on joincompetition.walletaddress (lower)
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_joincompetition_wallet_lower') THEN
    CREATE INDEX idx_joincompetition_wallet_lower ON joincompetition (LOWER(wallet_address));
  END IF;

  -- Index on user_transactions.wallet_address (lower)
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_user_transactions_wallet_lower') THEN
    CREATE INDEX idx_user_transactions_wallet_lower ON user_transactions (LOWER(wallet_address));
  END IF;

  -- Index on privy_user_connections.wallet_address (lower)
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_privy_user_connections_wallet_lower') THEN
    CREATE INDEX idx_privy_user_connections_wallet_lower ON privy_user_connections (LOWER(wallet_address));
  END IF;

  -- Index on privy_user_connections.base_wallet_address (lower)
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_privy_user_connections_base_wallet_lower') THEN
    CREATE INDEX idx_privy_user_connections_base_wallet_lower ON privy_user_connections (LOWER(base_wallet_address));
  END IF;
END $$;

-- ============================================================================
-- Summary
-- ============================================================================

COMMENT ON FUNCTION normalize_joincompetition_wallet_trigger() IS
'Trigger function to auto-lowercase wallet addresses in joincompetition table on INSERT/UPDATE.';

COMMENT ON FUNCTION normalize_user_transactions_wallet_trigger() IS
'Trigger function to auto-lowercase wallet addresses in user_transactions table on INSERT/UPDATE.';

COMMENT ON FUNCTION normalize_privy_user_connections_wallet_trigger() IS
'Trigger function to auto-lowercase wallet addresses in privy_user_connections table on INSERT/UPDATE.';

COMMENT ON FUNCTION normalize_competitions_wallet_trigger() IS
'Trigger function to auto-lowercase winner wallet addresses in competitions table on INSERT/UPDATE.';
