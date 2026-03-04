-- ============================================================================
-- IMMEDIATE FIX: 50% FIRST TOP-UP BONUS
-- ============================================================================
-- Changes the first-time deposit bonus from 20% to 50%
-- User deposits $3, gets $4.50 available_balance immediately
-- NO LIMITS, NO BLOCKERS, ACTIVE IMMEDIATELY

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
  v_prev_balance NUMERIC := 0;
  v_is_first_deposit BOOLEAN := false;
BEGIN
  -- IDEMPOTENCY CHECK: Has this reference_id already been processed?
  IF EXISTS (
    SELECT 1 FROM balance_ledger 
    WHERE reference_id = p_reference_id
    AND canonical_user_id = p_canonical_user_id
  ) THEN
    -- Already credited, return current balance
    SELECT COALESCE(available_balance, 0) INTO v_new_balance
    FROM sub_account_balances
    WHERE canonical_user_id = p_canonical_user_id AND currency = 'USD';
    
    RETURN jsonb_build_object(
      'success', true,
      'already_credited', true,
      'credited_amount', 0,
      'bonus_amount', 0,
      'bonus_applied', false,
      'total_credited', 0,
      'new_balance', COALESCE(v_new_balance, 0),
      'idempotency_note', 'Transaction already credited with reference: ' || p_reference_id
    );
  END IF;

  -- Get current balance
  SELECT COALESCE(available_balance, 0) INTO v_prev_balance
  FROM sub_account_balances
  WHERE canonical_user_id = p_canonical_user_id AND currency = 'USD';

  -- Check if user has used first deposit bonus
  SELECT COALESCE(has_used_new_user_bonus, false) INTO v_has_used_bonus
  FROM canonical_users
  WHERE canonical_user_id = p_canonical_user_id;

  -- FIRST DEPOSIT BONUS CHECK: 50% bonus on first deposit
  IF v_has_used_bonus = false OR v_has_used_bonus IS NULL THEN
    -- Double-check no previous deposits in ledger
    IF NOT EXISTS (
      SELECT 1 FROM balance_ledger 
      WHERE canonical_user_id = p_canonical_user_id 
        AND transaction_type IN ('deposit', 'credit', 'topup')
        AND amount > 0
        AND reference_id != p_reference_id
    ) THEN
      v_is_first_deposit := true;
      v_bonus_amount := p_amount * 0.50;  -- 50% BONUS
      v_total_credit := p_amount + v_bonus_amount;
      
      -- Mark bonus as used
      UPDATE canonical_users
      SET has_used_new_user_bonus = true,
          updated_at = NOW()
      WHERE canonical_user_id = p_canonical_user_id;
      
      RAISE NOTICE 'First deposit bonus applied: $% deposit + $% bonus (50%%) = $% total', 
        p_amount, v_bonus_amount, v_total_credit;
    ELSE
      v_total_credit := p_amount;
    END IF;
  ELSE
    v_total_credit := p_amount;
  END IF;

  -- Credit FULL amount to available_balance (deposit + bonus if applicable)
  INSERT INTO sub_account_balances (canonical_user_id, canonical_user_id_norm, currency, available_balance)
  VALUES (p_canonical_user_id, LOWER(p_canonical_user_id), 'USD', v_total_credit)
  ON CONFLICT (canonical_user_id, currency)
  DO UPDATE SET
    available_balance = sub_account_balances.available_balance + v_total_credit,
    updated_at = NOW();

  -- Get the new balance after credit
  SELECT COALESCE(available_balance, 0) INTO v_new_balance
  FROM sub_account_balances
  WHERE canonical_user_id = p_canonical_user_id AND currency = 'USD';

  -- Log deposit in balance ledger
  INSERT INTO balance_ledger (
    canonical_user_id,
    transaction_type,
    amount,
    reference_id,
    description,
    balance_before,
    balance_after
  ) VALUES (
    p_canonical_user_id,
    'deposit',
    p_amount,
    p_reference_id,
    CASE 
      WHEN v_is_first_deposit THEN p_reason || ' (First deposit: +50% bonus)'
      ELSE p_reason
    END,
    v_prev_balance,
    v_prev_balance + v_total_credit
  );

  -- Log bonus separately if applied
  IF v_bonus_amount > 0 THEN
    INSERT INTO balance_ledger (
      canonical_user_id,
      transaction_type,
      amount,
      reference_id,
      description,
      balance_before,
      balance_after
    ) VALUES (
      p_canonical_user_id,
      'bonus',
      v_bonus_amount,
      p_reference_id || ':bonus',
      'First deposit 50% bonus',
      v_prev_balance + p_amount,
      v_prev_balance + v_total_credit
    );
  END IF;

  -- Mark the transaction as posted to balance if it exists
  UPDATE user_transactions
  SET posted_to_balance = true,
      wallet_credited = true,
      updated_at = NOW()
  WHERE tx_id = p_reference_id
    OR id::text = p_reference_id
    OR charge_id = p_reference_id;

  RETURN jsonb_build_object(
    'success', true,
    'already_credited', false,
    'deposited_amount', p_amount,
    'bonus_amount', v_bonus_amount,
    'bonus_applied', v_is_first_deposit,
    'total_credited', v_total_credit,
    'previous_balance', v_prev_balance,
    'new_balance', v_new_balance
  );
END;
$$;

-- Grant execute permissions
REVOKE ALL ON FUNCTION credit_balance_with_first_deposit_bonus(TEXT, NUMERIC, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION credit_balance_with_first_deposit_bonus(TEXT, NUMERIC, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION credit_balance_with_first_deposit_bonus(TEXT, NUMERIC, TEXT, TEXT) TO authenticated;

-- Success notification
DO $deployment_notice$
BEGIN
  RAISE NOTICE '========================================================';
  RAISE NOTICE 'SUCCESS: 50%% FIRST TOP-UP BONUS DEPLOYED TO PRODUCTION';
  RAISE NOTICE 'ANY user who tops up from now on will get:';
  RAISE NOTICE '  - Deposit $3 gets $4.50 available_balance';
  RAISE NOTICE '  - Deposit $10 gets $15 available_balance';
  RAISE NOTICE '  - Deposit $100 gets $150 available_balance';
  RAISE NOTICE 'NO LIMITS, ACTIVE IMMEDIATELY';
  RAISE NOTICE '========================================================';
END $deployment_notice$;
