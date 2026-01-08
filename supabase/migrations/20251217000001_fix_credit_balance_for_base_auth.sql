/*
  # Fix credit/debit balance functions for Base Auth

  ## Problem
  The credit_user_balance and debit_user_balance functions check wallet_address
  but not base_wallet_address. For users authenticated via Base (CDP), their
  primary wallet address might be stored in base_wallet_address.

  ## Solution
  Update both functions to also check base_wallet_address in the user lookup.

  ## Changes
  1. Drop and recreate credit_user_balance with base_wallet_address support
  2. Drop and recreate debit_user_balance with base_wallet_address support
*/

-- Drop existing functions
DROP FUNCTION IF EXISTS credit_user_balance(TEXT, NUMERIC);
DROP FUNCTION IF EXISTS debit_user_balance(TEXT, NUMERIC);

-- Recreate credit_user_balance with base_wallet_address support
CREATE OR REPLACE FUNCTION credit_user_balance(
  user_id TEXT,
  amount NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $credit_balance$
DECLARE
  new_balance NUMERIC;
  user_record RECORD;
BEGIN
  -- Validate amount
  IF amount <= 0 THEN
    RAISE EXCEPTION 'Credit amount must be positive. Received: %', amount;
  END IF;

  -- Validate user_id
  IF user_id IS NULL OR user_id = '' THEN
    RAISE EXCEPTION 'User ID cannot be null or empty';
  END IF;

  -- Find user by any of their identifiers (including base_wallet_address for Base auth)
  SELECT * INTO user_record
  FROM privy_user_connections
  WHERE privy_user_id = user_id
     OR privy_did = user_id
     OR wallet_address = user_id
     OR base_wallet_address = user_id
     OR uid = user_id
  LIMIT 1;

  -- Check if user was found
  IF user_record IS NULL THEN
    RAISE EXCEPTION 'User not found with identifier: %', user_id;
  END IF;

  -- Update balance
  UPDATE privy_user_connections
  SET
    usdc_balance = COALESCE(usdc_balance, 0) + amount,
    updated_at = now()
  WHERE uid = user_record.uid
  RETURNING usdc_balance INTO new_balance;

  -- Log successful credit for debugging
  RAISE NOTICE 'Successfully credited % to user % (uid: %). New balance: %',
    amount, user_id, user_record.uid, new_balance;

  RETURN new_balance;
END;
$credit_balance$;

-- Recreate debit_user_balance with base_wallet_address support
CREATE OR REPLACE FUNCTION debit_user_balance(
  user_id TEXT,
  amount NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $debit_balance$
DECLARE
  current_balance NUMERIC;
  new_balance NUMERIC;
  user_record RECORD;
BEGIN
  -- Validate amount
  IF amount <= 0 THEN
    RAISE EXCEPTION 'Debit amount must be positive. Received: %', amount;
  END IF;

  -- Validate user_id
  IF user_id IS NULL OR user_id = '' THEN
    RAISE EXCEPTION 'User ID cannot be null or empty';
  END IF;

  -- Find user by any of their identifiers (including base_wallet_address for Base auth)
  SELECT * INTO user_record
  FROM privy_user_connections
  WHERE privy_user_id = user_id
     OR privy_did = user_id
     OR wallet_address = user_id
     OR base_wallet_address = user_id
     OR uid = user_id
  LIMIT 1;

  -- Check if user was found
  IF user_record IS NULL THEN
    RAISE EXCEPTION 'User not found with identifier: %', user_id;
  END IF;

  -- Get current balance
  current_balance := COALESCE(user_record.usdc_balance, 0);

  -- Check sufficient balance
  IF current_balance < amount THEN
    RAISE EXCEPTION 'Insufficient balance. Current: %, Required: %', current_balance, amount;
  END IF;

  -- Update balance
  UPDATE privy_user_connections
  SET
    usdc_balance = current_balance - amount,
    updated_at = now()
  WHERE uid = user_record.uid
  RETURNING usdc_balance INTO new_balance;

  -- Log successful debit for debugging
  RAISE NOTICE 'Successfully debited % from user % (uid: %). New balance: %',
    amount, user_id, user_record.uid, new_balance;

  RETURN new_balance;
END;
$debit_balance$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION credit_user_balance(TEXT, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION credit_user_balance(TEXT, NUMERIC) TO anon;
GRANT EXECUTE ON FUNCTION credit_user_balance(TEXT, NUMERIC) TO service_role;

GRANT EXECUTE ON FUNCTION debit_user_balance(TEXT, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION debit_user_balance(TEXT, NUMERIC) TO service_role;

COMMENT ON FUNCTION credit_user_balance(TEXT, NUMERIC) IS 'Credits user wallet balance. Accepts privy_user_id, privy_did, wallet_address, base_wallet_address, or uid as identifier.';
COMMENT ON FUNCTION debit_user_balance(TEXT, NUMERIC) IS 'Debits user wallet balance with validation. Accepts privy_user_id, privy_did, wallet_address, base_wallet_address, or uid as identifier.';
