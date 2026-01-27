-- Backfill privy_user_id from existing identifiers (safe version)
--
-- This migration populates the privy_user_id column in all user-based tables.
-- Tables that don't exist are safely skipped.

-- Helper function to find privy_user_id from various identifiers
CREATE OR REPLACE FUNCTION get_privy_user_id_from_identifiers(
  p_wallet_address TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_uid TEXT DEFAULT NULL,
  p_user_id TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  found_privy_id TEXT;
BEGIN
  -- Try wallet_address match in privy_user_connections
  IF p_wallet_address IS NOT NULL AND p_wallet_address != '' THEN
    SELECT privy_user_id INTO found_privy_id
    FROM privy_user_connections
    WHERE wallet_address = p_wallet_address
      AND privy_user_id IS NOT NULL
    LIMIT 1;
    IF found_privy_id IS NOT NULL THEN RETURN found_privy_id; END IF;
  END IF;

  -- Try email match
  IF p_email IS NOT NULL AND p_email != '' THEN
    SELECT privy_user_id INTO found_privy_id
    FROM privy_user_connections
    WHERE email = p_email AND privy_user_id IS NOT NULL
    LIMIT 1;
    IF found_privy_id IS NOT NULL THEN RETURN found_privy_id; END IF;
  END IF;

  -- Try uid match
  IF p_uid IS NOT NULL AND p_uid != '' THEN
    SELECT privy_user_id INTO found_privy_id
    FROM privy_user_connections
    WHERE uid = p_uid AND privy_user_id IS NOT NULL
    LIMIT 1;
    IF found_privy_id IS NOT NULL THEN RETURN found_privy_id; END IF;
  END IF;

  -- Try user_id match
  IF p_user_id IS NOT NULL AND p_user_id != '' THEN
    SELECT privy_user_id INTO found_privy_id
    FROM privy_user_connections
    WHERE id::text = p_user_id AND privy_user_id IS NOT NULL
    LIMIT 1;
    IF found_privy_id IS NOT NULL THEN RETURN found_privy_id; END IF;
  END IF;

  RETURN NULL;
END;
$$;

-- Safe backfill function
CREATE OR REPLACE FUNCTION safe_backfill_privy_user_id() RETURNS VOID AS $$
BEGIN
  -- orders
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='orders') THEN
    UPDATE orders SET privy_user_id = get_privy_user_id_from_identifiers(NULL, NULL, NULL, user_id::text) WHERE privy_user_id IS NULL AND user_id IS NOT NULL;
  END IF;

  -- tickets
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='tickets') THEN
    UPDATE tickets SET privy_user_id = get_privy_user_id_from_identifiers(NULL, NULL, NULL, user_id::text) WHERE privy_user_id IS NULL AND user_id IS NOT NULL;
  END IF;

  -- participants
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='participants') AND
     EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='participants' AND column_name='wallet_address') THEN
    UPDATE participants SET privy_user_id = get_privy_user_id_from_identifiers(wallet_address, NULL, NULL, user_id::text) WHERE privy_user_id IS NULL;
  END IF;

  -- winners
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='winners') THEN
    UPDATE winners SET privy_user_id = get_privy_user_id_from_identifiers(wallet_address, NULL, uid, user_id::text) WHERE privy_user_id IS NULL;
  END IF;

  -- user_transactions
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='user_transactions') THEN
    -- First copy from user_privy_id if exists
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='user_transactions' AND column_name='user_privy_id') THEN
      UPDATE user_transactions SET privy_user_id = user_privy_id WHERE privy_user_id IS NULL AND user_privy_id IS NOT NULL;
    END IF;
    UPDATE user_transactions SET privy_user_id = get_privy_user_id_from_identifiers(wallet_address, NULL, NULL, user_id) WHERE privy_user_id IS NULL;
  END IF;

  -- user_notifications
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='user_notifications') THEN
    UPDATE user_notifications SET privy_user_id = get_privy_user_id_from_identifiers(NULL, NULL, NULL, user_id::text) WHERE privy_user_id IS NULL AND user_id IS NOT NULL;
  END IF;

  -- user_payouts
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='user_payouts') THEN
    UPDATE user_payouts SET privy_user_id = get_privy_user_id_from_identifiers(address, NULL, NULL, user_id::text) WHERE privy_user_id IS NULL;
  END IF;

  -- custody_transactions
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='custody_transactions') THEN
    UPDATE custody_transactions SET privy_user_id = get_privy_user_id_from_identifiers(NULL, NULL, NULL, user_id::text) WHERE privy_user_id IS NULL AND user_id IS NOT NULL;
  END IF;

  -- custody_wallet_balances
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='custody_wallet_balances') THEN
    UPDATE custody_wallet_balances SET privy_user_id = get_privy_user_id_from_identifiers(NULL, NULL, NULL, user_id::text) WHERE privy_user_id IS NULL AND user_id IS NOT NULL;
  END IF;

  -- transactions
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='transactions') THEN
    UPDATE transactions SET privy_user_id = get_privy_user_id_from_identifiers(NULL, NULL, NULL, user_id::text) WHERE privy_user_id IS NULL AND user_id IS NOT NULL;
  END IF;

  -- joincompetition
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='joincompetition') THEN
    UPDATE joincompetition SET privy_user_id = get_privy_user_id_from_identifiers(wallet_address, NULL, uid, userid) WHERE privy_user_id IS NULL;
  END IF;

  -- joined_competitions
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='joined_competitions') THEN
    UPDATE joined_competitions SET privy_user_id = get_privy_user_id_from_identifiers(wallet_address, NULL, user_uid, NULL) WHERE privy_user_id IS NULL;
  END IF;

  -- internal_transfers
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='internal_transfers') THEN
    UPDATE internal_transfers SET from_privy_user_id = get_privy_user_id_from_identifiers(NULL, NULL, NULL, from_user_id::text) WHERE from_privy_user_id IS NULL AND from_user_id IS NOT NULL;
    UPDATE internal_transfers SET to_privy_user_id = get_privy_user_id_from_identifiers(NULL, NULL, NULL, to_user_id::text) WHERE to_privy_user_id IS NULL AND to_user_id IS NOT NULL;
  END IF;

  -- sub_account_balances
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='sub_account_balances') THEN
    UPDATE sub_account_balances SET privy_user_id = get_privy_user_id_from_identifiers(NULL, NULL, NULL, user_id::text) WHERE privy_user_id IS NULL AND user_id IS NOT NULL;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Run the backfill
SELECT safe_backfill_privy_user_id();

-- Handle Prize_Instantprizes separately due to quoted name
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='Prize_Instantprizes') THEN
    UPDATE "Prize_Instantprizes" SET privy_user_id = get_privy_user_id_from_identifiers("winningWalletAddress", NULL, "UID", NULL) WHERE privy_user_id IS NULL;
  END IF;
END $$;

-- Clean up
DROP FUNCTION IF EXISTS safe_backfill_privy_user_id();

-- Grant execute permission on the helper function
GRANT EXECUTE ON FUNCTION get_privy_user_id_from_identifiers(TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_privy_user_id_from_identifiers(TEXT, TEXT, TEXT, TEXT) TO service_role;
