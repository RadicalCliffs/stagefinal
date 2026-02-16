-- Migration: Fix commerce top-up payment provider classification
-- Date: 2026-02-16
-- Issue: Commerce top-ups need proper payment_provider set to 'coinbase_commerce' or 'cdp_commerce'
-- This ensures proper filtering and tracking in user_transactions and balance_ledger

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
  v_payment_provider TEXT;
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

  -- Determine payment provider based on reason
  -- CRITICAL: Properly classify commerce payments as 'coinbase_commerce'
  v_payment_provider := CASE 
    WHEN p_reason = 'wallet_topup' THEN 'instant_wallet_topup'
    WHEN p_reason = 'commerce_topup' THEN 'coinbase_commerce'  -- Commerce webhook top-ups
    WHEN p_reason = 'cdp_topup' THEN 'cdp_commerce'  -- CDP Commerce alternate name
    WHEN p_reason LIKE '%stripe%' OR p_reason LIKE '%card%' THEN 'stripe'
    WHEN p_reason LIKE '%commerce%' THEN 'coinbase_commerce'  -- Catch-all for commerce
    ELSE 'balance_credit'
  END;

  -- CRITICAL FIX: Create user_transactions record with type='topup' and proper payment_provider
  -- This ensures the top-up shows in the dashboard with correct classification
  -- NOTE: Using 'USD' to match sub_account_balances currency (balance operations use USD)
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
    'USD',  -- FIXED: Use 'USD' to match sub_account_balances currency
    'topup',  -- CRITICAL: Always set type='topup' for top-up transactions
    'completed',
    'confirmed',
    v_previous_balance,
    v_new_balance,
    p_reference_id,
    p_reference_id,
    v_payment_provider,  -- Use determined payment provider
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
  -- CRITICAL: Include type and payment_provider for proper audit trail
  INSERT INTO balance_ledger (
    canonical_user_id,
    transaction_type,
    amount,
    reference_id,
    description,
    type,
    payment_provider
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
    END,
    'topup',  -- CRITICAL: Mark as topup for filtering
    v_payment_provider  -- CRITICAL: Include payment provider for tracking
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

-- Add comment explaining the payment provider logic
COMMENT ON FUNCTION credit_balance_with_first_deposit_bonus IS 
'Credits balance with 50% first-time bonus. Sets proper payment_provider for commerce top-ups (coinbase_commerce or cdp_commerce). Ensures type=topup in user_transactions and balance_ledger for proper classification.';

COMMIT;
