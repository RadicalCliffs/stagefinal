-- Migration: Fix first deposit bonus to 50% and add to available_balance only
-- This fixes the bonus percentage from 20% to 50% and removes the separate bonus_balance column logic
-- The bonus is now added directly to available_balance

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

  -- If first deposit, add 50% bonus
  IF v_has_used_bonus = false OR v_has_used_bonus IS NULL THEN
    v_bonus_amount := p_amount * 0.50; -- 50% bonus (was 20%)
    v_total_credit := p_amount + v_bonus_amount;

    -- Mark bonus as used
    UPDATE canonical_users
    SET has_used_new_user_bonus = true,
        updated_at = NOW()
    WHERE canonical_user_id = p_canonical_user_id;

    -- Log bonus award (no longer updating bonus_balance column)
    INSERT INTO bonus_award_audit (
      canonical_user_id,
      amount,
      reason,
      note
    ) VALUES (
      p_canonical_user_id,
      v_bonus_amount,
      p_reason,
      'First deposit bonus: 50%'  -- Updated from 20% to 50%
    );
  ELSE
    v_total_credit := p_amount;
  END IF;

  -- Credit TOTAL to available_balance (base amount + bonus if applicable)
  -- This is the FIX: Add v_total_credit instead of just p_amount
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
    p_reason
  );

  RETURN jsonb_build_object(
    'success', true,
    'credited_amount', p_amount,
    'bonus_amount', v_bonus_amount,
    'bonus_applied', v_bonus_amount > 0,
    'total_credited', v_total_credit,
    'new_balance', COALESCE(v_new_balance, v_total_credit)
  );
END;
$$;

-- Grant execute permission to service_role only (this is a sensitive operation)
REVOKE ALL ON FUNCTION credit_balance_with_first_deposit_bonus(TEXT, NUMERIC, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION credit_balance_with_first_deposit_bonus(TEXT, NUMERIC, TEXT, TEXT) TO service_role;
