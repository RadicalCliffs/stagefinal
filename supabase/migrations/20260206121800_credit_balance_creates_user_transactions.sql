-- Migration: Ensure ALL balance-crediting functions create user_transactions with type='topup'
-- Date: 2026-02-06
-- Issue: Multiple functions credit balance but don't create user_transactions records
-- This causes top-ups to not show in dashboard even though balance is added
-- Fix: ALL balance-crediting functions must create user_transactions with type='topup'

BEGIN;

-- =====================================================
-- FIX 1: credit_balance_with_first_deposit_bonus
-- =====================================================

DROP FUNCTION IF EXISTS credit_balance_with_first_deposit_bonus(TEXT, NUMERIC, TEXT, TEXT) CASCADE;

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
  v_previous_balance NUMERIC;
  v_transaction_id UUID;
BEGIN
  -- Get previous balance
  SELECT available_balance INTO v_previous_balance
  FROM sub_account_balances
  WHERE canonical_user_id = p_canonical_user_id AND currency = 'USD';
  
  v_previous_balance := COALESCE(v_previous_balance, 0);

  -- Check if user has used first deposit bonus
  SELECT has_used_new_user_bonus INTO v_has_used_bonus
  FROM canonical_users
  WHERE canonical_user_id = p_canonical_user_id;

  -- If first deposit, add 50% bonus
  IF v_has_used_bonus = false OR v_has_used_bonus IS NULL THEN
    v_bonus_amount := p_amount * 0.50; -- 50% bonus
    v_total_credit := p_amount + v_bonus_amount;

    -- Mark bonus as used
    UPDATE canonical_users
    SET has_used_new_user_bonus = true,
        updated_at = NOW()
    WHERE canonical_user_id = p_canonical_user_id;

    -- Log bonus award to audit table
    INSERT INTO bonus_award_audit (
      canonical_user_id,
      amount,
      reason,
      note
    ) VALUES (
      p_canonical_user_id,
      v_bonus_amount,
      p_reason,
      'First deposit bonus: 50%'
    );
  ELSE
    v_total_credit := p_amount;
  END IF;

  -- Credit total amount including any applicable bonus to available_balance
  INSERT INTO sub_account_balances (canonical_user_id, currency, available_balance)
  VALUES (p_canonical_user_id, 'USD', v_total_credit)
  ON CONFLICT (canonical_user_id, currency)
  DO UPDATE SET
    available_balance = sub_account_balances.available_balance + v_total_credit,
    updated_at = NOW();

  -- Get the new balance after credit
  SELECT available_balance INTO v_new_balance
  FROM sub_account_balances
  WHERE canonical_user_id = p_canonical_user_id AND currency = 'USD';

  -- CRITICAL FIX: Create user_transactions record with type='topup'
  -- This ensures the top-up shows in the dashboard
  INSERT INTO user_transactions (
    canonical_user_id,
    amount,
    currency,
    type,
    status,
    payment_status,
    balance_before,
    balance_after,
    tx_id,
    webhook_ref,
    payment_provider,
    method,
    notes,
    created_at,
    completed_at
  ) VALUES (
    p_canonical_user_id,
    p_amount,
    'USD',
    'topup',  -- CRITICAL: type='topup' so it shows in dashboard
    'completed',
    'confirmed',
    v_previous_balance,
    v_new_balance,
    p_reference_id,
    p_reference_id,
    CASE 
      WHEN p_reason LIKE '%wallet%' THEN 'instant_wallet_topup'
      WHEN p_reason LIKE '%coinbase%' THEN 'coinbase'
      WHEN p_reason LIKE '%nowpayments%' THEN 'nowpayments'
      ELSE 'system'
    END,
    'credit_balance',
    CASE 
      WHEN v_bonus_amount > 0 THEN format('Balance credit: $%s + $%s bonus (50%%)', p_amount, v_bonus_amount)
      ELSE format('Balance credit: $%s', p_amount)
    END,
    NOW(),
    NOW()
  )
  RETURNING id INTO v_transaction_id;

  -- Log transaction in balance ledger
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

  RETURN jsonb_build_object(
    'success', true,
    'credited_amount', p_amount,
    'bonus_amount', v_bonus_amount,
    'bonus_applied', v_bonus_amount > 0,
    'total_credited', v_total_credit,
    'previous_balance', v_previous_balance,
    'new_balance', v_new_balance,
    'transaction_id', v_transaction_id
  );
END;
$$;

-- =====================================================
-- FIX 2: credit_sub_account_balance (5-parameter version)
-- =====================================================

DROP FUNCTION IF EXISTS credit_sub_account_balance(TEXT, NUMERIC, TEXT, TEXT, TEXT) CASCADE;

CREATE OR REPLACE FUNCTION public.credit_sub_account_balance(
  p_canonical_user_id text, 
  p_amount numeric, 
  p_currency text DEFAULT 'USD'::text, 
  p_reference_id text DEFAULT NULL::text, 
  p_description text DEFAULT NULL::text
)
RETURNS TABLE(success boolean, previous_balance numeric, new_balance numeric, error_message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_record_id UUID;
  v_previous_balance NUMERIC;
  v_new_balance NUMERIC;
  search_wallet TEXT;
  v_transaction_id UUID;
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
      p_canonical_user_id,
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

  -- Update canonical_users.usdc_balance when currency is USD
  IF p_currency = 'USD' THEN
    UPDATE public.canonical_users
    SET usdc_balance = COALESCE(usdc_balance, 0) + p_amount,
        updated_at = NOW()
    WHERE canonical_user_id = p_canonical_user_id;
  END IF;

  -- CRITICAL FIX: Create user_transactions record with type='topup'
  -- This ensures ALL balance credits show in the dashboard
  INSERT INTO user_transactions (
    canonical_user_id,
    amount,
    currency,
    type,
    status,
    payment_status,
    balance_before,
    balance_after,
    tx_id,
    webhook_ref,
    payment_provider,
    method,
    notes,
    created_at,
    completed_at
  ) VALUES (
    p_canonical_user_id,
    p_amount,
    p_currency,
    'topup',  -- CRITICAL: type='topup' so it shows in dashboard
    'completed',
    'confirmed',
    v_previous_balance,
    v_new_balance,
    p_reference_id,
    p_reference_id,
    'system',
    'credit_sub_account_balance',
    COALESCE(p_description, 'Account balance credited'),
    NOW(),
    NOW()
  )
  RETURNING id INTO v_transaction_id;

  -- Create balance_ledger audit entry
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

COMMIT;

-- Log completion
DO $$
BEGIN
  RAISE NOTICE 'Migration complete: ALL balance-crediting functions now create user_transactions';
  RAISE NOTICE '- credit_balance_with_first_deposit_bonus creates user_transactions with type=''topup''';
  RAISE NOTICE '- credit_sub_account_balance creates user_transactions with type=''topup''';
  RAISE NOTICE '- All balance credits will now appear in dashboard correctly';
  RAISE NOTICE '- ONLY user_transactions.type=''topup'' will show as top-ups';
END $$;
