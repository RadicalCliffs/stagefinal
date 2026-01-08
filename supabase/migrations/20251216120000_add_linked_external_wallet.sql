-- Add linked_external_wallet column to privy_user_connections table
--
-- This migration adds support for users to link one additional external wallet
-- to their account for display purposes. Top-ups and transactions still use the
-- primary ledger balance (usdc_balance), not external wallets.
--
-- 1. Changes
--    - Add linked_external_wallet column (nullable text)
--    - Add updated_at column if not exists
--
-- 2. Constraints
--    - Only one external wallet can be linked per user
--    - The linked wallet is for display/reference only, not for transactions

-- Add linked_external_wallet column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'privy_user_connections'
    AND column_name = 'linked_external_wallet'
  ) THEN
    ALTER TABLE privy_user_connections
    ADD COLUMN linked_external_wallet text;

    COMMENT ON COLUMN privy_user_connections.linked_external_wallet IS
      'Optional external wallet address linked by user for display purposes. Limited to one per account. Does not affect balance or transactions.';
  END IF;
END $$;

-- Add updated_at column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'privy_user_connections'
    AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE privy_user_connections
    ADD COLUMN updated_at timestamptz DEFAULT now();
  END IF;
END $$;

-- Create index for linked_external_wallet lookups (useful for checking duplicates)
CREATE INDEX IF NOT EXISTS idx_privy_user_connections_linked_external_wallet
  ON privy_user_connections(linked_external_wallet)
  WHERE linked_external_wallet IS NOT NULL;
