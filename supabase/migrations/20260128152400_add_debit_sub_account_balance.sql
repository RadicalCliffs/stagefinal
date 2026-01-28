-- Migration: Add debit_sub_account_balance RPC function
-- This function is called by purchase-tickets-with-bonus to atomically debit user balance
-- It was missing from the initial schema, causing purchase failures
-- SECURITY: Only callable by service_role (edge functions) to prevent unauthorized debits

CREATE OR REPLACE FUNCTION debit_sub_account_balance(
  p_canonical_user_id TEXT,
  p_amount NUMERIC,
  p_currency TEXT DEFAULT 'USD'
)
RETURNS TABLE(
  success BOOLEAN,
  previous_balance NUMERIC,
  new_balance NUMERIC,
  error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_balance NUMERIC;
  v_new_balance NUMERIC;
  v_record_exists BOOLEAN;
BEGIN
  -- Validate amount is positive
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN QUERY SELECT 
      FALSE,
      0::NUMERIC,
      0::NUMERIC,
      'Amount must be greater than zero'::TEXT;
    RETURN;
  END IF;

  -- Check if record exists and get current balance with row lock
  SELECT 
    COALESCE(available_balance, 0),
    TRUE
  INTO 
    v_current_balance,
    v_record_exists
  FROM sub_account_balances
  WHERE canonical_user_id = p_canonical_user_id 
    AND currency = p_currency
  FOR UPDATE; -- Lock the row to prevent concurrent modifications

  -- If no record found, return error
  IF NOT FOUND THEN
    RETURN QUERY SELECT 
      FALSE,
      0::NUMERIC,
      0::NUMERIC,
      'User balance record not found'::TEXT;
    RETURN;
  END IF;

  -- Check sufficient balance
  IF v_current_balance < p_amount THEN
    RETURN QUERY SELECT 
      FALSE,
      v_current_balance,
      v_current_balance,
      ('Insufficient balance. Available: ' || v_current_balance::TEXT || ', Required: ' || p_amount::TEXT)::TEXT;
    RETURN;
  END IF;

  -- Calculate new balance
  v_new_balance := v_current_balance - p_amount;

  -- Update balance atomically
  UPDATE sub_account_balances
  SET 
    available_balance = v_new_balance,
    updated_at = NOW()
  WHERE canonical_user_id = p_canonical_user_id 
    AND currency = p_currency;

  -- Log transaction in balance_ledger
  -- NOTE: Debits are stored as negative amounts in balance_ledger for audit consistency
  -- Credits are positive, debits are negative
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
    'debit',
    -p_amount, -- Negative for debit (convention: credits positive, debits negative)
    p_currency,
    v_current_balance,
    v_new_balance,
    'Sub-account debit'
  );

  -- Return success
  RETURN QUERY SELECT 
    TRUE,
    v_current_balance,
    v_new_balance,
    NULL::TEXT;
END;
$$;

-- Grant execute permission ONLY to service_role (edge functions)
-- This prevents authenticated users from debiting arbitrary accounts
REVOKE ALL ON FUNCTION debit_sub_account_balance(TEXT, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION debit_sub_account_balance(TEXT, NUMERIC, TEXT) TO service_role;
