-- Migration: Restore Production Balance Functions
-- This restores the credit_sub_account_balance and debit_sub_account_balance functions
-- from the production database to fix the balance payment functionality

-- Drop existing functions to avoid conflicts
DROP FUNCTION IF EXISTS public.credit_sub_account_balance(TEXT, NUMERIC, TEXT);
DROP FUNCTION IF EXISTS public.debit_sub_account_balance(TEXT, NUMERIC, TEXT);

-- Restore production version of credit_sub_account_balance
CREATE OR REPLACE FUNCTION public.credit_sub_account_balance(
  p_canonical_user_id TEXT, 
  p_amount NUMERIC, 
  p_currency TEXT DEFAULT 'USD', 
  p_reference_id TEXT DEFAULT NULL, 
  p_description TEXT DEFAULT NULL
)
RETURNS TABLE(
  success BOOLEAN, 
  previous_balance NUMERIC, 
  new_balance NUMERIC, 
  error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_record_id UUID;
  v_previous_balance NUMERIC;
  v_new_balance NUMERIC;
  search_wallet TEXT;
BEGIN
  -- Validate amount
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, 0::NUMERIC, 0::NUMERIC, 'Amount must be positive'::TEXT;
    RETURN;
  END IF;

  -- Extract wallet address from prize:pid: format if present
  IF p_canonical_user_id LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(p_canonical_user_id FROM 11));
  ELSIF p_canonical_user_id LIKE '0x%' AND LENGTH(p_canonical_user_id) = 42 THEN
    search_wallet := LOWER(p_canonical_user_id);
  ELSE
    search_wallet := NULL;
  END IF;

  -- Find the record to update
  SELECT id, COALESCE(available_balance, 0)
  INTO v_record_id, v_previous_balance
  FROM public.sub_account_balances
  WHERE currency = p_currency
    AND (
      canonical_user_id = p_canonical_user_id
      OR canonical_user_id = LOWER(p_canonical_user_id)
      OR (search_wallet IS NOT NULL AND canonical_user_id = 'prize:pid:' || search_wallet)
      OR user_id = p_canonical_user_id
      OR privy_user_id = p_canonical_user_id
    )
  ORDER BY
    CASE
      WHEN canonical_user_id = p_canonical_user_id THEN 0
      WHEN canonical_user_id = LOWER(p_canonical_user_id) THEN 1
      ELSE 2
    END
  LIMIT 1
  FOR UPDATE;

  IF v_record_id IS NULL THEN
    -- No record found - create one
    v_previous_balance := 0;
    v_new_balance := p_amount;

    INSERT INTO public.sub_account_balances (
      canonical_user_id,
      user_id,
      currency,
      available_balance,
      pending_balance,
      last_updated
    ) VALUES (
      p_canonical_user_id,
      p_canonical_user_id,  -- Use same value for user_id initially
      p_currency,
      v_new_balance,
      0,
      NOW()
    )
    RETURNING id INTO v_record_id;
  ELSE
    -- Calculate new balance
    v_new_balance := ROUND(v_previous_balance + p_amount, 2);

    -- Update the record
    UPDATE public.sub_account_balances
    SET
      available_balance = v_new_balance,
      last_updated = NOW()
    WHERE id = v_record_id;
  END IF;

  -- CRITICAL: Create balance_ledger audit entry
  INSERT INTO public.balance_ledger (
    canonical_user_id,
    transaction_type,
    amount,
    currency,
    balance_before,
    balance_after,
    reference_id,
    description,
    created_at
  ) VALUES (
    p_canonical_user_id,
    'credit',
    p_amount,
    p_currency,
    v_previous_balance,
    v_new_balance,
    p_reference_id,
    COALESCE(p_description, 'Account balance credited'),
    NOW()
  );

  RETURN QUERY SELECT TRUE, v_previous_balance, v_new_balance, NULL::TEXT;
END;
$$;

-- Restore production version of debit_sub_account_balance
CREATE OR REPLACE FUNCTION public.debit_sub_account_balance(
  p_canonical_user_id TEXT, 
  p_amount NUMERIC, 
  p_currency TEXT DEFAULT 'USD', 
  p_reference_id TEXT DEFAULT NULL, 
  p_description TEXT DEFAULT NULL
)
RETURNS TABLE(
  success BOOLEAN, 
  previous_balance NUMERIC, 
  new_balance NUMERIC, 
  error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_record_id UUID;
  v_previous_balance NUMERIC;
  v_new_balance NUMERIC;
  search_wallet TEXT;
BEGIN
  -- Validate amount
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, 0::NUMERIC, 0::NUMERIC, 'Amount must be positive'::TEXT;
    RETURN;
  END IF;

  -- Extract wallet address from prize:pid: format if present
  IF p_canonical_user_id LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(p_canonical_user_id FROM 11));
  ELSIF p_canonical_user_id LIKE '0x%' AND LENGTH(p_canonical_user_id) = 42 THEN
    search_wallet := LOWER(p_canonical_user_id);
  ELSE
    search_wallet := NULL;
  END IF;

  -- Find the record to update (with row lock)
  SELECT id, COALESCE(available_balance, 0)
  INTO v_record_id, v_previous_balance
  FROM public.sub_account_balances
  WHERE currency = p_currency
    AND (
      canonical_user_id = p_canonical_user_id
      OR canonical_user_id = LOWER(p_canonical_user_id)
      OR (search_wallet IS NOT NULL AND canonical_user_id = 'prize:pid:' || search_wallet)
      OR user_id = p_canonical_user_id
      OR privy_user_id = p_canonical_user_id
    )
  ORDER BY
    CASE
      WHEN canonical_user_id = p_canonical_user_id THEN 0
      WHEN canonical_user_id = LOWER(p_canonical_user_id) THEN 1
      ELSE 2
    END
  LIMIT 1
  FOR UPDATE;

  IF v_record_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0::NUMERIC, 0::NUMERIC, 'User balance record not found'::TEXT;
    RETURN;
  END IF;

  -- Check sufficient balance
  IF v_previous_balance < p_amount THEN
    RETURN QUERY SELECT FALSE, v_previous_balance, v_previous_balance,
      format('Insufficient balance. Have: %s, Need: %s', v_previous_balance, p_amount)::TEXT;
    RETURN;
  END IF;

  -- Calculate new balance
  v_new_balance := ROUND(v_previous_balance - p_amount, 2);

  -- Update the record
  UPDATE public.sub_account_balances
  SET
    available_balance = v_new_balance,
    last_updated = NOW()
  WHERE id = v_record_id;

  -- CRITICAL: Create balance_ledger audit entry (negative amount for debit)
  INSERT INTO public.balance_ledger (
    canonical_user_id,
    transaction_type,
    amount,
    currency,
    balance_before,
    balance_after,
    reference_id,
    description,
    created_at
  ) VALUES (
    p_canonical_user_id,
    'debit',
    -p_amount,  -- Negative for debit
    p_currency,
    v_previous_balance,
    v_new_balance,
    p_reference_id,
    COALESCE(p_description, 'Account balance debited'),
    NOW()
  );

  RETURN QUERY SELECT TRUE, v_previous_balance, v_new_balance, NULL::TEXT;
END;
$$;

-- Grant execute permissions to service_role
GRANT EXECUTE ON FUNCTION public.credit_sub_account_balance(TEXT, NUMERIC, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.debit_sub_account_balance(TEXT, NUMERIC, TEXT, TEXT, TEXT) TO service_role;

-- Revoke from public for security
REVOKE ALL ON FUNCTION public.credit_sub_account_balance(TEXT, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.debit_sub_account_balance(TEXT, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC;
