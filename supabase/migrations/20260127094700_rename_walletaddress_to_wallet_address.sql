/*
  # Rename walletaddress to wallet_address in joincompetition table
  
  This migration fixes the inconsistency where joincompetition table uses 
  `walletaddress` (no underscore) while other tables use `wallet_address` 
  (with underscore). This inconsistency causes reservation and user-data 
  logic to silently fail when looking up users by wallet address.
  
  Changes:
  1. Rename joincompetition.walletaddress to wallet_address
  2. Update index name for consistency
*/

-- Rename the column
ALTER TABLE joincompetition 
  RENAME COLUMN walletaddress TO wallet_address;

-- Drop old index and create new one with updated column name
DROP INDEX IF EXISTS idx_joincompetition_wallet_address;
CREATE INDEX IF NOT EXISTS idx_joincompetition_wallet_address
  ON joincompetition(wallet_address);

-- Add a comment for clarity
COMMENT ON COLUMN joincompetition.wallet_address IS 'User wallet address - now consistent with other tables using wallet_address naming convention';
