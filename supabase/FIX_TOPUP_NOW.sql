-- ============================================================================
-- CRITICAL FIX: Top-Up Wallet Functionality
-- ============================================================================
-- This script fixes the instant wallet top-up feature by:
-- 1. Adding missing columns to user_transactions table
-- 2. Ensuring credit_balance_with_first_deposit_bonus function exists and returns new_balance
-- 3. Ensuring credit_sub_account_balance function exists
--
-- HOW TO APPLY:
-- 1. Go to Supabase Dashboard -> SQL Editor
-- 2. Paste this entire script
-- 3. Click "Run"
-- ============================================================================

BEGIN;

-- ============================================================================
-- PART 1: Add missing columns to user_transactions table
-- Required for instant-topup functionality and comprehensive dashboard queries
-- ============================================================================

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

-- ============================================================================
-- PART 2: Create/Update credit_balance_with_first_deposit_bonus function
-- This function credits user balance and applies 20% first deposit bonus
-- ============================================================================

CREATE OR REPLACE FUNCTION credit_balance_with_first_deposit_bonus(
  p_canonical_user_id TEXT,
  p_amount NUMERIC,
  p_reason TEXT,
  p_reference_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_used_bonus BOOLEAN;
  v_bonus_amount NUMERIC := 0;
  v_total_credit NUMERIC;
  v_new_balance NUMERIC;
BEGIN
  -- Check if user has used first deposit bonus
  SELECT has_used_new_user_bonus INTO v_has_used_bonus
  FROM canonical_users
  WHERE canonical_user_id = p_canonical_user_id;

  -- If first deposit, add bonus (20%)
  IF v_has_used_bonus = false OR v_has_used_bonus IS NULL THEN
    v_bonus_amount := p_amount * 0.20;
    v_total_credit := p_amount + v_bonus_amount;

    -- Mark bonus as used
    UPDATE canonical_users
    SET has_used_new_user_bonus = true,
        updated_at = NOW()
    WHERE canonical_user_id = p_canonical_user_id;

    -- If no canonical_users record exists, that's OK - it will be created when needed
    -- The bonus just won't be applied

    -- Credit bonus to bonus_balance
    INSERT INTO sub_account_balances (canonical_user_id, currency, bonus_balance)
    VALUES (p_canonical_user_id, 'USD', v_bonus_amount)
    ON CONFLICT (canonical_user_id, currency)
    DO UPDATE SET
      bonus_balance = sub_account_balances.bonus_balance + v_bonus_amount,
      updated_at = NOW();

    -- Log bonus award (if table exists)
    BEGIN
      INSERT INTO bonus_award_audit (
        canonical_user_id,
        amount,
        reason,
        note
      ) VALUES (
        p_canonical_user_id,
        v_bonus_amount,
        p_reason,
        'First deposit bonus: 20%'
      );
    EXCEPTION WHEN undefined_table THEN
      -- Table doesn't exist, skip bonus logging
      NULL;
    END;
  ELSE
    v_total_credit := p_amount;
  END IF;

  -- Credit main balance
  INSERT INTO sub_account_balances (canonical_user_id, currency, available_balance)
  VALUES (p_canonical_user_id, 'USD', p_amount)
  ON CONFLICT (canonical_user_id, currency)
  DO UPDATE SET
    available_balance = sub_account_balances.available_balance + p_amount,
    updated_at = NOW();

  -- Get the new balance after credit
  SELECT available_balance INTO v_new_balance
  FROM sub_account_balances
  WHERE canonical_user_id = p_canonical_user_id AND currency = 'USD';

  -- Log in balance ledger (if table exists)
  BEGIN
    INSERT INTO balance_ledger (
      canonical_user_id,
      transaction_type,
      amount,
      reference_id,
      description
    ) VALUES (
      p_canonical_user_id,
      'deposit',
      v_total_credit,
      p_reference_id,
      p_reason
    );
  EXCEPTION WHEN undefined_table THEN
    -- Table doesn't exist, skip ledger logging
    NULL;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'credited_amount', p_amount,
    'bonus_amount', v_bonus_amount,
    'bonus_applied', v_bonus_amount > 0,
    'total_credited', v_total_credit,
    'new_balance', COALESCE(v_new_balance, p_amount)
  );
END;
$$;

-- Grant execute permission to service_role only
REVOKE ALL ON FUNCTION credit_balance_with_first_deposit_bonus(TEXT, NUMERIC, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION credit_balance_with_first_deposit_bonus(TEXT, NUMERIC, TEXT, TEXT) TO service_role;

-- ============================================================================
-- PART 3: Create/Update credit_sub_account_balance function (fallback)
-- ============================================================================

CREATE OR REPLACE FUNCTION credit_sub_account_balance(
  p_canonical_user_id TEXT,
  p_amount NUMERIC,
  p_currency TEXT DEFAULT 'USD'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_balance NUMERIC;
  v_new_balance NUMERIC;
BEGIN
  -- Validate amount is positive
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Amount must be greater than zero'
    );
  END IF;

  -- Get current balance
  SELECT COALESCE(available_balance, 0) INTO v_current_balance
  FROM sub_account_balances
  WHERE canonical_user_id = p_canonical_user_id AND currency = p_currency;

  v_new_balance := COALESCE(v_current_balance, 0) + p_amount;

  -- Update or insert
  INSERT INTO sub_account_balances (canonical_user_id, currency, available_balance)
  VALUES (p_canonical_user_id, p_currency, p_amount)
  ON CONFLICT (canonical_user_id, currency)
  DO UPDATE SET
    available_balance = sub_account_balances.available_balance + p_amount,
    updated_at = NOW();

  -- Log transaction (if table exists)
  BEGIN
    INSERT INTO balance_ledger (
      canonical_user_id,
      transaction_type,
      amount,
      currency,
      balance_before,
      balance_after,
      description
    ) VALUES (
      p_canonical_user_id,
      'credit',
      p_amount,
      p_currency,
      v_current_balance,
      v_new_balance,
      'Sub-account credit'
    );
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'balance', v_new_balance,
    'new_balance', v_new_balance
  );
END;
$$;

-- Restrict to service_role only
REVOKE ALL ON FUNCTION credit_sub_account_balance(TEXT, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION credit_sub_account_balance(TEXT, NUMERIC, TEXT) TO service_role;

-- ============================================================================
-- PART 4: Ensure sub_account_balances table exists with correct structure
-- ============================================================================

-- Create table if it doesn't exist
CREATE TABLE IF NOT EXISTS sub_account_balances (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  canonical_user_id TEXT NOT NULL,
  user_id TEXT,
  privy_user_id TEXT,
  currency TEXT DEFAULT 'USD' NOT NULL,
  available_balance NUMERIC(20, 6) DEFAULT 0 NOT NULL,
  pending_balance NUMERIC(20, 6) DEFAULT 0 NOT NULL,
  bonus_balance NUMERIC(20, 6) DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(canonical_user_id, currency)
);

-- Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_sub_account_balances_canonical_user_id ON sub_account_balances(canonical_user_id);
CREATE INDEX IF NOT EXISTS idx_sub_account_balances_user_id ON sub_account_balances(user_id);
CREATE INDEX IF NOT EXISTS idx_sub_account_balances_currency ON sub_account_balances(currency);

-- Enable RLS and grant access
ALTER TABLE sub_account_balances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on sub_account_balances" ON sub_account_balances;
CREATE POLICY "Service role full access on sub_account_balances" ON sub_account_balances
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- PART 5: Ensure balance_ledger table exists
-- ============================================================================

CREATE TABLE IF NOT EXISTS balance_ledger (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  canonical_user_id TEXT,
  transaction_type TEXT,
  amount NUMERIC(20, 6) NOT NULL,
  currency TEXT DEFAULT 'USD',
  balance_before NUMERIC(20, 6),
  balance_after NUMERIC(20, 6),
  reference_id TEXT,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  source TEXT,
  metadata JSONB,
  transaction_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_balance_ledger_canonical_user_id ON balance_ledger(canonical_user_id);
CREATE INDEX IF NOT EXISTS idx_balance_ledger_reference_id ON balance_ledger(reference_id);

ALTER TABLE balance_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on balance_ledger" ON balance_ledger;
CREATE POLICY "Service role full access on balance_ledger" ON balance_ledger
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- PART 6: Ensure bonus_award_audit table exists
-- ============================================================================

CREATE TABLE IF NOT EXISTS bonus_award_audit (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  wallet_address TEXT,
  canonical_user_id TEXT,
  amount NUMERIC(20, 6) NOT NULL,
  currency TEXT DEFAULT 'USD' NOT NULL,
  awarded_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  reason TEXT NOT NULL,
  sub_account_balance_before NUMERIC(20, 6),
  sub_account_balance_after NUMERIC(20, 6),
  note TEXT
);

CREATE INDEX IF NOT EXISTS idx_bonus_award_audit_canonical_user_id ON bonus_award_audit(canonical_user_id);

ALTER TABLE bonus_award_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on bonus_award_audit" ON bonus_award_audit;
CREATE POLICY "Service role full access on bonus_award_audit" ON bonus_award_audit
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- VERIFICATION
-- ============================================================================
DO $$
DECLARE
  ut_col_count INTEGER;
  func_count INTEGER;
  table_count INTEGER;
BEGIN
  -- Count user_transactions columns
  SELECT COUNT(*) INTO ut_col_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'user_transactions'
    AND column_name IN ('tx_id', 'wallet_address', 'wallet_credited', 'completed_at',
                        'notes', 'network', 'charge_id', 'charge_code', 'tx_ref',
                        'order_id', 'user_privy_id', 'privy_user_id');

  -- Count functions
  SELECT COUNT(*) INTO func_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.proname IN ('credit_balance_with_first_deposit_bonus', 'credit_sub_account_balance');

  -- Count tables
  SELECT COUNT(*) INTO table_count
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN ('sub_account_balances', 'balance_ledger', 'bonus_award_audit');

  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'TOP-UP FIX APPLIED - VERIFICATION RESULTS';
  RAISE NOTICE '=====================================================';
  RAISE NOTICE '';
  RAISE NOTICE 'user_transactions columns: % / 12', ut_col_count;
  RAISE NOTICE 'Required functions: % / 2', func_count;
  RAISE NOTICE 'Required tables: % / 3', table_count;
  RAISE NOTICE '';
  RAISE NOTICE 'Functions created/updated:';
  RAISE NOTICE '  - credit_balance_with_first_deposit_bonus (with 20% bonus + new_balance return)';
  RAISE NOTICE '  - credit_sub_account_balance (fallback credit function)';
  RAISE NOTICE '';
  RAISE NOTICE 'Tables ensured:';
  RAISE NOTICE '  - sub_account_balances (main balance storage)';
  RAISE NOTICE '  - balance_ledger (audit trail)';
  RAISE NOTICE '  - bonus_award_audit (bonus tracking)';
  RAISE NOTICE '';
  RAISE NOTICE 'user_transactions columns added:';
  RAISE NOTICE '  - tx_id, wallet_address, wallet_credited, completed_at';
  RAISE NOTICE '  - notes, network, charge_id, charge_code, tx_ref';
  RAISE NOTICE '  - order_id, user_privy_id, privy_user_id';
  RAISE NOTICE '';
  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'TOP-UP SHOULD NOW WORK! Refresh your app and try again.';
  RAISE NOTICE '=====================================================';
END $$;

COMMIT;
