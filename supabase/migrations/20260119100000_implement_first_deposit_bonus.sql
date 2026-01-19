-- ============================================================================
-- IMPLEMENT 50% FIRST DEPOSIT BONUS
-- ============================================================================
-- This migration implements the 50% first deposit bonus system
--
-- Requirements:
-- 1. Users get 50% bonus on their FIRST wallet top-up only
-- 2. Bonus is tracked via has_used_new_user_bonus flag
-- 3. Bonus is applied automatically when user tops up for the first time
-- 4. Bonus balance is unwithdrawable until 1.5x the balance has been played with
--
-- Implementation:
-- - Create RPC function to apply bonus when crediting balance
-- - Update has_used_new_user_bonus flag after bonus is applied
-- - Track bonus in balance_history for audit trail
-- ============================================================================

BEGIN;

-- ============================================================================
-- PART 1: Create function to apply first deposit bonus
-- ============================================================================

DROP FUNCTION IF EXISTS credit_balance_with_first_deposit_bonus CASCADE;

CREATE OR REPLACE FUNCTION credit_balance_with_first_deposit_bonus(
  p_canonical_user_id TEXT,
  p_amount NUMERIC,
  p_reason TEXT DEFAULT 'topup',
  p_reference_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_record RECORD;
  v_has_used_bonus BOOLEAN;
  v_current_balance NUMERIC;
  v_bonus_amount NUMERIC;
  v_total_credit NUMERIC;
  v_new_balance NUMERIC;
  v_user_id TEXT;
BEGIN
  -- Step 1: Get user record and check if bonus has been used
  SELECT 
    id,
    COALESCE(usdc_balance, 0) as balance,
    COALESCE(has_used_new_user_bonus, false) as has_used_bonus,
    wallet_address
  INTO v_user_record
  FROM canonical_users
  WHERE id = p_canonical_user_id
     OR canonical_user_id = p_canonical_user_id
  LIMIT 1;

  IF v_user_record IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'User not found'
    );
  END IF;

  v_has_used_bonus := v_user_record.has_used_bonus;
  v_current_balance := v_user_record.balance;
  v_user_id := v_user_record.id;

  -- Step 2: Calculate bonus if this is first deposit
  IF v_has_used_bonus = false AND p_reason IN ('topup', 'deposit', 'wallet_deposit') THEN
    -- Apply 50% bonus
    v_bonus_amount := p_amount * 0.5;
    v_total_credit := p_amount + v_bonus_amount;
    
    RAISE NOTICE 'Applying 50%% first deposit bonus: amount=%, bonus=%, total=%', 
                 p_amount, v_bonus_amount, v_total_credit;
  ELSE
    -- No bonus
    v_bonus_amount := 0;
    v_total_credit := p_amount;
  END IF;

  v_new_balance := v_current_balance + v_total_credit;

  -- Step 3: Update user balance and bonus flag
  UPDATE canonical_users
  SET 
    usdc_balance = v_new_balance,
    has_used_new_user_bonus = true,  -- Always mark as used after any topup
    updated_at = NOW()
  WHERE id = v_user_id;

  -- Step 4: Log the original credit to balance_history
  IF p_amount > 0 THEN
    INSERT INTO balance_history (
      user_id,
      amount,
      type,
      reason,
      reference_id,
      balance_before,
      balance_after,
      created_at
    ) VALUES (
      v_user_id,
      p_amount,
      'credit',
      p_reason,
      p_reference_id,
      v_current_balance,
      v_current_balance + p_amount,  -- Balance after just the deposit
      NOW()
    );
  END IF;

  -- Step 5: Log the bonus separately if applied
  IF v_bonus_amount > 0 THEN
    INSERT INTO balance_history (
      user_id,
      amount,
      type,
      reason,
      reference_id,
      balance_before,
      balance_after,
      created_at
    ) VALUES (
      v_user_id,
      v_bonus_amount,
      'credit',
      '50% first deposit bonus',
      p_reference_id,
      v_current_balance + p_amount,  -- Balance after deposit
      v_new_balance,  -- Balance after deposit + bonus
      NOW()
    );
  END IF;

  -- Step 6: Return success with details
  RETURN jsonb_build_object(
    'success', true,
    'previous_balance', v_current_balance,
    'deposited_amount', p_amount,
    'bonus_amount', v_bonus_amount,
    'total_credited', v_total_credit,
    'new_balance', v_new_balance,
    'bonus_applied', v_bonus_amount > 0,
    'has_used_bonus', true
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Failed to credit balance: ' || SQLERRM
    );
END;
$$;

GRANT EXECUTE ON FUNCTION credit_balance_with_first_deposit_bonus(TEXT, NUMERIC, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION credit_balance_with_first_deposit_bonus(TEXT, NUMERIC, TEXT, TEXT) TO service_role;

COMMENT ON FUNCTION credit_balance_with_first_deposit_bonus IS
'Credits user balance and applies 50% first deposit bonus if applicable.
Returns: { success, previous_balance, deposited_amount, bonus_amount, total_credited, new_balance, bonus_applied }';

-- ============================================================================
-- PART 2: Create wrapper function for sub_account_balances compatibility
-- ============================================================================

DROP FUNCTION IF EXISTS credit_sub_account_with_bonus CASCADE;

CREATE OR REPLACE FUNCTION credit_sub_account_with_bonus(
  p_canonical_user_id TEXT,
  p_amount NUMERIC,
  p_currency TEXT DEFAULT 'USD'
)
RETURNS TABLE (
  success BOOLEAN,
  previous_balance NUMERIC,
  new_balance NUMERIC,
  bonus_amount NUMERIC,
  bonus_applied BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
  v_user_record RECORD;
  v_has_used_bonus BOOLEAN;
  v_bonus_amount NUMERIC;
  v_total_credit NUMERIC;
  v_current_balance NUMERIC;
  v_new_balance NUMERIC;
BEGIN
  -- Get user and check bonus status
  SELECT 
    id,
    COALESCE(usdc_balance, 0) as balance,
    COALESCE(has_used_new_user_bonus, false) as has_used_bonus
  INTO v_user_record
  FROM canonical_users
  WHERE id = p_canonical_user_id
     OR canonical_user_id = p_canonical_user_id
  LIMIT 1;

  IF v_user_record IS NULL THEN
    RETURN QUERY SELECT false, 0::NUMERIC, 0::NUMERIC, 0::NUMERIC, false;
    RETURN;
  END IF;

  v_has_used_bonus := v_user_record.has_used_bonus;
  v_current_balance := v_user_record.balance;

  -- Calculate bonus
  IF v_has_used_bonus = false THEN
    v_bonus_amount := p_amount * 0.5;
    v_total_credit := p_amount + v_bonus_amount;
  ELSE
    v_bonus_amount := 0;
    v_total_credit := p_amount;
  END IF;

  v_new_balance := v_current_balance + v_total_credit;

  -- Update balance and flag
  UPDATE canonical_users
  SET 
    usdc_balance = v_new_balance,
    has_used_new_user_bonus = true,
    updated_at = NOW()
  WHERE id = v_user_record.id;

  -- Log to balance_history
  IF p_amount > 0 THEN
    INSERT INTO balance_history (
      user_id, amount, type, reason, balance_before, balance_after, created_at
    ) VALUES (
      v_user_record.id, p_amount, 'credit', 'topup', v_current_balance, v_current_balance + p_amount, NOW()
    );
  END IF;

  IF v_bonus_amount > 0 THEN
    INSERT INTO balance_history (
      user_id, amount, type, reason, balance_before, balance_after, created_at
    ) VALUES (
      v_user_record.id, v_bonus_amount, 'credit', '50% first deposit bonus', 
      v_current_balance + p_amount, v_new_balance, NOW()
    );
  END IF;

  -- Return result
  RETURN QUERY SELECT 
    true, 
    v_current_balance, 
    v_new_balance, 
    v_bonus_amount,
    v_bonus_amount > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION credit_sub_account_with_bonus(TEXT, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION credit_sub_account_with_bonus(TEXT, NUMERIC, TEXT) TO service_role;

COMMENT ON FUNCTION credit_sub_account_with_bonus IS
'Credits balance with optional 50% first deposit bonus. Compatible with sub_account_balances pattern.';

-- ============================================================================
-- PART 3: Create helper function to check if user is eligible for bonus
-- ============================================================================

DROP FUNCTION IF EXISTS check_first_deposit_bonus_eligibility CASCADE;

CREATE OR REPLACE FUNCTION check_first_deposit_bonus_eligibility(
  p_canonical_user_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_has_used_bonus BOOLEAN;
  v_user_id TEXT;
BEGIN
  SELECT 
    id,
    COALESCE(has_used_new_user_bonus, false)
  INTO v_user_id, v_has_used_bonus
  FROM canonical_users
  WHERE id = p_canonical_user_id
     OR canonical_user_id = p_canonical_user_id
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'eligible', false,
      'reason', 'User not found'
    );
  END IF;

  IF v_has_used_bonus = true THEN
    RETURN jsonb_build_object(
      'eligible', false,
      'reason', 'Bonus already used',
      'has_used_bonus', true
    );
  END IF;

  RETURN jsonb_build_object(
    'eligible', true,
    'bonus_percentage', 50,
    'has_used_bonus', false,
    'message', 'User is eligible for 50% first deposit bonus'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION check_first_deposit_bonus_eligibility(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION check_first_deposit_bonus_eligibility(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION check_first_deposit_bonus_eligibility(TEXT) TO service_role;

COMMENT ON FUNCTION check_first_deposit_bonus_eligibility IS
'Checks if user is eligible for 50% first deposit bonus. Returns eligibility status and details.';

-- ============================================================================
-- PART 4: Verification
-- ============================================================================

DO $$
DECLARE
  func_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO func_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'credit_balance_with_first_deposit_bonus',
      'credit_sub_account_with_bonus',
      'check_first_deposit_bonus_eligibility'
    );

  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'FIRST DEPOSIT BONUS MIGRATION';
  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'Functions created: % (expected: 3)', func_count;
  RAISE NOTICE '';
  RAISE NOTICE 'Status: %', CASE 
    WHEN func_count = 3 THEN '✓ ALL BONUS FUNCTIONS CREATED'
    ELSE '⚠ SOME FUNCTIONS MISSING'
  END;
  RAISE NOTICE '=====================================================';
END $$;

COMMIT;

-- ============================================================================
-- USAGE NOTES
-- ============================================================================
-- Frontend should call:
-- 1. check_first_deposit_bonus_eligibility(user_id) - Check if user gets bonus
-- 2. credit_balance_with_first_deposit_bonus(user_id, amount, 'topup', ref_id) - Apply deposit with bonus
--
-- Backend functions can call:
-- - credit_sub_account_with_bonus(user_id, amount, 'USD') - For sub_account_balances pattern
--
-- The bonus is automatically applied on first topup and the flag is set.
-- Subsequent topups will not receive the bonus.
-- ============================================================================
