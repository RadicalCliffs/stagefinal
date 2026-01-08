/*
  # Fix Database Function Column References

  This migration fixes database functions that reference the wrong column name.
  The table uses `privy_user_id` but some functions incorrectly reference `privy_did`.

  Changes:
  1. Update get_user_wallet_balance to use correct column name
  2. Update credit_user_balance to use correct column name
  3. Update debit_user_balance to use correct column name
  4. Ensure all functions query by privy_user_id, id, uid, wallet_address, or email
*/

-- Fix get_user_wallet_balance function
DROP FUNCTION IF EXISTS get_user_wallet_balance(TEXT);

CREATE OR REPLACE FUNCTION get_user_wallet_balance(user_identifier TEXT)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  balance NUMERIC;
BEGIN
  -- Handle null or empty identifier
  IF user_identifier IS NULL OR user_identifier = '' THEN
    RETURN 0;
  END IF;

  -- Get balance from privy_user_connections
  -- Check all possible identifier columns
  SELECT COALESCE(usdc_balance, 0) INTO balance
  FROM privy_user_connections
  WHERE privy_user_id = user_identifier
     OR id::text = user_identifier
     OR uid = user_identifier
     OR wallet_address = user_identifier
     OR email = user_identifier
  LIMIT 1;

  -- Return 0 if user not found
  RETURN COALESCE(balance, 0);
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_user_wallet_balance(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_wallet_balance(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_user_wallet_balance(TEXT) TO service_role;

-- Fix credit_user_balance function
DROP FUNCTION IF EXISTS credit_user_balance(TEXT, NUMERIC);

CREATE OR REPLACE FUNCTION credit_user_balance(
  user_identifier TEXT,
  amount NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_balance NUMERIC;
  rows_updated INTEGER;
BEGIN
  IF amount <= 0 THEN
    RAISE EXCEPTION 'Credit amount must be positive';
  END IF;

  -- Update balance using correct column names
  UPDATE privy_user_connections
  SET usdc_balance = usdc_balance + amount,
      updated_at = NOW()
  WHERE privy_user_id = user_identifier
     OR id::text = user_identifier
     OR uid = user_identifier
     OR wallet_address = user_identifier
     OR email = user_identifier
  RETURNING usdc_balance INTO new_balance;

  GET DIAGNOSTICS rows_updated = ROW_COUNT;

  IF rows_updated = 0 THEN
    RAISE EXCEPTION 'User not found: %', user_identifier;
  END IF;

  RETURN new_balance;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION credit_user_balance(TEXT, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION credit_user_balance(TEXT, NUMERIC) TO service_role;

-- Fix debit_user_balance function
DROP FUNCTION IF EXISTS debit_user_balance(TEXT, NUMERIC);

CREATE OR REPLACE FUNCTION debit_user_balance(
  user_identifier TEXT,
  amount NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_balance NUMERIC;
  new_balance NUMERIC;
  rows_updated INTEGER;
BEGIN
  IF amount <= 0 THEN
    RAISE EXCEPTION 'Debit amount must be positive';
  END IF;

  -- Get current balance
  SELECT usdc_balance INTO current_balance
  FROM privy_user_connections
  WHERE privy_user_id = user_identifier
     OR id::text = user_identifier
     OR uid = user_identifier
     OR wallet_address = user_identifier
     OR email = user_identifier
  LIMIT 1;

  IF current_balance IS NULL THEN
    RAISE EXCEPTION 'User not found: %', user_identifier;
  END IF;

  IF current_balance < amount THEN
    RAISE EXCEPTION 'Insufficient balance. Current: %, Required: %', current_balance, amount;
  END IF;

  -- Update balance
  UPDATE privy_user_connections
  SET usdc_balance = usdc_balance - amount,
      updated_at = NOW()
  WHERE privy_user_id = user_identifier
     OR id::text = user_identifier
     OR uid = user_identifier
     OR wallet_address = user_identifier
     OR email = user_identifier
  RETURNING usdc_balance INTO new_balance;

  GET DIAGNOSTICS rows_updated = ROW_COUNT;

  IF rows_updated = 0 THEN
    RAISE EXCEPTION 'Failed to update user balance';
  END IF;

  RETURN new_balance;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION debit_user_balance(TEXT, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION debit_user_balance(TEXT, NUMERIC) TO service_role;

-- Add updated_at column if it doesn't exist
ALTER TABLE privy_user_connections
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Create trigger function for auto-update
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger if not exists
DROP TRIGGER IF EXISTS update_privy_user_connections_updated_at ON privy_user_connections;
CREATE TRIGGER update_privy_user_connections_updated_at
BEFORE UPDATE ON privy_user_connections
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
