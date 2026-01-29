-- Migration: Add missing columns to user_transactions table
-- Required for instant-topup functionality and comprehensive dashboard queries
--
-- The instant-topup.mts function and dashboard RPCs expect these columns
-- to exist for proper transaction tracking, idempotency checks, and user lookups

BEGIN;

-- Add tx_id column for transaction hash / idempotency checking
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_transactions' AND column_name = 'tx_id'
  ) THEN
    ALTER TABLE user_transactions ADD COLUMN tx_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_user_transactions_tx_id ON user_transactions(tx_id);
    RAISE NOTICE 'Added tx_id column to user_transactions';
  END IF;
END $$;

-- Add wallet_address column for wallet-based lookups
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_transactions' AND column_name = 'wallet_address'
  ) THEN
    ALTER TABLE user_transactions ADD COLUMN wallet_address TEXT;
    CREATE INDEX IF NOT EXISTS idx_user_transactions_wallet_address ON user_transactions(LOWER(wallet_address));
    RAISE NOTICE 'Added wallet_address column to user_transactions';
  END IF;
END $$;

-- Add wallet_credited column to track if balance was credited (for idempotency)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_transactions' AND column_name = 'wallet_credited'
  ) THEN
    ALTER TABLE user_transactions ADD COLUMN wallet_credited BOOLEAN DEFAULT FALSE;
    CREATE INDEX IF NOT EXISTS idx_user_transactions_wallet_credited ON user_transactions(wallet_credited);
    RAISE NOTICE 'Added wallet_credited column to user_transactions';
  END IF;
END $$;

-- Add completed_at column for completion timestamp
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_transactions' AND column_name = 'completed_at'
  ) THEN
    ALTER TABLE user_transactions ADD COLUMN completed_at TIMESTAMPTZ;
    RAISE NOTICE 'Added completed_at column to user_transactions';
  END IF;
END $$;

-- Add notes column for additional notes/metadata
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_transactions' AND column_name = 'notes'
  ) THEN
    ALTER TABLE user_transactions ADD COLUMN notes TEXT;
    RAISE NOTICE 'Added notes column to user_transactions';
  END IF;
END $$;

-- Add network column for blockchain network identification
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_transactions' AND column_name = 'network'
  ) THEN
    ALTER TABLE user_transactions ADD COLUMN network TEXT DEFAULT 'base';
    RAISE NOTICE 'Added network column to user_transactions';
  END IF;
END $$;

-- Add charge_id column for Coinbase Commerce charges
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_transactions' AND column_name = 'charge_id'
  ) THEN
    ALTER TABLE user_transactions ADD COLUMN charge_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_user_transactions_charge_id ON user_transactions(charge_id);
    RAISE NOTICE 'Added charge_id column to user_transactions';
  END IF;
END $$;

-- Add charge_code column for Coinbase Commerce charge codes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_transactions' AND column_name = 'charge_code'
  ) THEN
    ALTER TABLE user_transactions ADD COLUMN charge_code TEXT;
    RAISE NOTICE 'Added charge_code column to user_transactions';
  END IF;
END $$;

-- Add tx_ref column for external transaction references
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_transactions' AND column_name = 'tx_ref'
  ) THEN
    ALTER TABLE user_transactions ADD COLUMN tx_ref TEXT;
    RAISE NOTICE 'Added tx_ref column to user_transactions';
  END IF;
END $$;

-- Add order_id column for order references
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_transactions' AND column_name = 'order_id'
  ) THEN
    ALTER TABLE user_transactions ADD COLUMN order_id TEXT;
    RAISE NOTICE 'Added order_id column to user_transactions';
  END IF;
END $$;

-- Add user_privy_id column for Privy user lookups
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_transactions' AND column_name = 'user_privy_id'
  ) THEN
    ALTER TABLE user_transactions ADD COLUMN user_privy_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_user_transactions_user_privy_id ON user_transactions(user_privy_id);
    RAISE NOTICE 'Added user_privy_id column to user_transactions';
  END IF;
END $$;

-- Add privy_user_id column (alternative name for compatibility)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_transactions' AND column_name = 'privy_user_id'
  ) THEN
    ALTER TABLE user_transactions ADD COLUMN privy_user_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_user_transactions_privy_user_id ON user_transactions(privy_user_id);
    RAISE NOTICE 'Added privy_user_id column to user_transactions';
  END IF;
END $$;

-- Verification
DO $$
DECLARE
  col_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO col_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'user_transactions'
    AND column_name IN ('tx_id', 'wallet_address', 'wallet_credited', 'completed_at',
                        'notes', 'network', 'charge_id', 'charge_code', 'tx_ref',
                        'order_id', 'user_privy_id', 'privy_user_id');

  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'USER_TRANSACTIONS COLUMN MIGRATION COMPLETE';
  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'Columns verified: % / 12', col_count;
  RAISE NOTICE '';
  RAISE NOTICE 'Added columns (if they did not exist):';
  RAISE NOTICE '  - tx_id (for transaction hash / idempotency)';
  RAISE NOTICE '  - wallet_address (for wallet-based lookups)';
  RAISE NOTICE '  - wallet_credited (for balance credit tracking)';
  RAISE NOTICE '  - completed_at (for completion timestamp)';
  RAISE NOTICE '  - notes (for additional notes)';
  RAISE NOTICE '  - network (for blockchain network)';
  RAISE NOTICE '  - charge_id (for Coinbase Commerce)';
  RAISE NOTICE '  - charge_code (for Coinbase Commerce)';
  RAISE NOTICE '  - tx_ref (for external references)';
  RAISE NOTICE '  - order_id (for order references)';
  RAISE NOTICE '  - user_privy_id (for Privy user lookups)';
  RAISE NOTICE '  - privy_user_id (for Privy user lookups)';
  RAISE NOTICE '=====================================================';
END $$;

COMMIT;
