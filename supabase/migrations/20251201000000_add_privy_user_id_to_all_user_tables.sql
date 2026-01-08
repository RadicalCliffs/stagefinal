/*
  # Add privy_user_id column to all user-based tables (safe version)

  This migration adds the privy_user_id column to tables that exist.
  Tables that don't exist will be skipped gracefully.
*/

-- Helper function to safely add column and index
CREATE OR REPLACE FUNCTION safe_add_privy_user_id(p_table_name TEXT)
RETURNS VOID AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND information_schema.tables.table_name = p_table_name) THEN
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS privy_user_id TEXT', p_table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_privy_user_id ON %I(privy_user_id)', p_table_name, p_table_name);
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Apply to all tables that might exist
SELECT safe_add_privy_user_id('orders');
SELECT safe_add_privy_user_id('tickets');
SELECT safe_add_privy_user_id('participants');
SELECT safe_add_privy_user_id('winners');
SELECT safe_add_privy_user_id('user_transactions');
SELECT safe_add_privy_user_id('user_entries');
SELECT safe_add_privy_user_id('user_notifications');
SELECT safe_add_privy_user_id('user_payouts');
SELECT safe_add_privy_user_id('custody_transactions');
SELECT safe_add_privy_user_id('custody_wallet_balances');
SELECT safe_add_privy_user_id('nowpayments_sub_accounts');
SELECT safe_add_privy_user_id('sub_account_balances');
SELECT safe_add_privy_user_id('transactions');
SELECT safe_add_privy_user_id('joincompetition');
SELECT safe_add_privy_user_id('joined_competitions');

-- Handle special cases
DO $$
BEGIN
  -- Prize_Instantprizes with quotes
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'Prize_Instantprizes') THEN
    ALTER TABLE "Prize_Instantprizes" ADD COLUMN IF NOT EXISTS privy_user_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_prize_instantprizes_privy_user_id ON "Prize_Instantprizes"(privy_user_id);
  END IF;

  -- internal_transfers with two columns
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'internal_transfers') THEN
    ALTER TABLE internal_transfers ADD COLUMN IF NOT EXISTS from_privy_user_id TEXT;
    ALTER TABLE internal_transfers ADD COLUMN IF NOT EXISTS to_privy_user_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_internal_transfers_from_privy_user_id ON internal_transfers(from_privy_user_id);
    CREATE INDEX IF NOT EXISTS idx_internal_transfers_to_privy_user_id ON internal_transfers(to_privy_user_id);
  END IF;
END $$;

-- Clean up helper function
DROP FUNCTION IF EXISTS safe_add_privy_user_id(TEXT);
