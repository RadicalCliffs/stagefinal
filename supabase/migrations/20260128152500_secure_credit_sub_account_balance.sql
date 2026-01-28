-- Migration: Add security and validation to credit_sub_account_balance
-- This function needs the same security restrictions as debit_sub_account_balance
-- to prevent unauthorized balance manipulations

-- First, add amount validation to credit_sub_account_balance
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

  -- Log transaction
  -- NOTE: Credits are stored as positive amounts in balance_ledger
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
    p_amount, -- Positive for credit (convention: credits positive, debits negative)
    p_currency,
    v_current_balance,
    v_new_balance,
    'Sub-account credit'
  );

  RETURN jsonb_build_object(
    'success', true,
    'balance', v_new_balance
  );
END;
$$;

-- Restrict credit_sub_account_balance to service_role only
-- This prevents authenticated users from crediting arbitrary accounts
REVOKE ALL ON FUNCTION credit_sub_account_balance(TEXT, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION credit_sub_account_balance(TEXT, NUMERIC, TEXT) TO service_role;
