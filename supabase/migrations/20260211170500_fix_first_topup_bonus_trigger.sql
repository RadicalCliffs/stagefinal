-- Migration: Fix first top-up bonus to trigger on first positive balance
-- Date: 2026-02-11
-- Issue: Bonus should trigger when available_balance changes from 0 to positive for the first time
-- Simple logic: If previous balance was 0 or negative, and we're adding money, apply 50% bonus

BEGIN;

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
  v_bonus_amount NUMERIC := 0;
  v_total_credit NUMERIC;
  v_new_balance NUMERIC;
  v_previous_balance NUMERIC;
  v_transaction_id UUID;
  v_bonus_applied BOOLEAN := false;
BEGIN
  -- Get previous balance (this is the key check!)
  SELECT available_balance INTO v_previous_balance
  FROM sub_account_balances
  WHERE canonical_user_id = p_canonical_user_id AND currency = 'USD';
  
  v_previous_balance := COALESCE(v_previous_balance, 0);

  -- SIMPLE TRIGGER: If previous balance was 0 or less, apply 50% bonus
  -- This is the first time money goes into this account!
  IF v_previous_balance <= 0 THEN
    v_bonus_amount := p_amount * 0.50; -- 50% bonus - magic happens!
    v_total_credit := p_amount + v_bonus_amount;
    v_bonus_applied := true;

    -- Mark bonus as used in canonical_users for audit trail
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
      'First deposit bonus: 50% - triggered by first positive balance'
    );
  ELSE
    -- Not the first deposit, no bonus
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
    created_at
  ) VALUES (
    p_canonical_user_id,
    v_total_credit, -- Total including bonus
    'USDC',
    'topup',
    'completed',
    'confirmed',
    v_previous_balance,
    v_new_balance,
    p_reference_id,
    p_reference_id,
    CASE 
      WHEN p_reason = 'wallet_topup' THEN 'instant_wallet_topup'
      WHEN p_reason LIKE '%stripe%' OR p_reason LIKE '%card%' THEN 'stripe'
      ELSE 'balance_credit'
    END,
    p_reason,
    CASE 
      WHEN v_bonus_applied THEN 
        format('Balance credited: $%s (includes 50%% first-time bonus: $%s)', 
               v_total_credit::text, v_bonus_amount::text)
      ELSE 
        format('Balance credited: $%s', v_total_credit::text)
    END,
    NOW()
  ) RETURNING id INTO v_transaction_id;

  -- Log in balance ledger (with total amount including bonus)
  INSERT INTO balance_ledger (
    canonical_user_id,
    transaction_type,
    amount,
    reference_id,
    description
  ) VALUES (
    p_canonical_user_id,
    'deposit',
    v_total_credit,  -- Log the total including bonus
    p_reference_id,
    CASE 
      WHEN v_bonus_applied THEN 
        format('%s (with 50%% first-time bonus)', p_reason)
      ELSE 
        p_reason
    END
  );

  RETURN jsonb_build_object(
    'success', true,
    'credited_amount', p_amount,
    'bonus_amount', v_bonus_amount,
    'bonus_applied', v_bonus_applied,
    'total_credited', v_total_credit,
    'new_balance', COALESCE(v_new_balance, v_total_credit),
    'previous_balance', v_previous_balance,
    'transaction_id', v_transaction_id
  );
END;
$$;

-- Grant execute permission to service_role only (this is a sensitive operation)
REVOKE ALL ON FUNCTION credit_balance_with_first_deposit_bonus(TEXT, NUMERIC, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION credit_balance_with_first_deposit_bonus(TEXT, NUMERIC, TEXT, TEXT) TO service_role;

-- Add comment explaining the simple trigger logic
COMMENT ON FUNCTION credit_balance_with_first_deposit_bonus IS 
'Credits balance with 50% first-time bonus. SIMPLE TRIGGER: If previous balance <= 0, add 50% bonus. That''s it!';

COMMIT;
