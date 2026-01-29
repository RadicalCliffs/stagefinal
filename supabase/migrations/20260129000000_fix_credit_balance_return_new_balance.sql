-- Migration: Fix credit_balance_with_first_deposit_bonus to return new_balance
-- This ensures the frontend can display the updated balance after a top-up

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

  -- If first deposit, add bonus
  IF v_has_used_bonus = false OR v_has_used_bonus IS NULL THEN
    v_bonus_amount := p_amount * 0.20; -- 20% bonus
    v_total_credit := p_amount + v_bonus_amount;

    -- Mark bonus as used
    UPDATE canonical_users
    SET has_used_new_user_bonus = true,
        updated_at = NOW()
    WHERE canonical_user_id = p_canonical_user_id;

    -- Credit bonus to bonus_balance
    INSERT INTO sub_account_balances (canonical_user_id, currency, bonus_balance)
    VALUES (p_canonical_user_id, 'USD', v_bonus_amount)
    ON CONFLICT (canonical_user_id, currency)
    DO UPDATE SET
      bonus_balance = sub_account_balances.bonus_balance + v_bonus_amount,
      updated_at = NOW();

    -- Log bonus award
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

  -- Log in balance ledger
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
    'new_balance', COALESCE(v_new_balance, p_amount)
  );
END;
$$;
