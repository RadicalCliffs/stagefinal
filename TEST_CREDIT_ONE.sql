-- ============================================================================
-- TEST CREDIT ONE STUCK TOPUP
-- ============================================================================
-- Try to credit just ONE transaction to see the exact error

DO $$
DECLARE
  v_result JSONB;
  v_user_id TEXT := 'prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363';
  v_amount NUMERIC := 3;
  v_reference_id TEXT := 'TOPUP_prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363_36d6366e-da18-44bf-b150-c89340b66ad3';
BEGIN
  RAISE NOTICE 'Testing credit for user: %', v_user_id;
  RAISE NOTICE 'Amount: $%', v_amount;
  RAISE NOTICE 'Reference: %', v_reference_id;
  RAISE NOTICE '';
  
  -- Check if user exists in canonical_users
  IF EXISTS (SELECT 1 FROM canonical_users WHERE canonical_user_id = v_user_id) THEN
    RAISE NOTICE '✅ User exists in canonical_users';
  ELSE
    RAISE NOTICE '❌ User DOES NOT exist in canonical_users!';
  END IF;
  
  -- Check if user has sub_account_balances
  IF EXISTS (SELECT 1 FROM sub_account_balances WHERE canonical_user_id = v_user_id AND currency = 'USD') THEN
    RAISE NOTICE '✅ User has sub_account_balances record';
  ELSE
    RAISE NOTICE '❌ User DOES NOT have sub_account_balances record!';
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE 'Attempting to credit...';
  RAISE NOTICE '';
  
  BEGIN
    SELECT credit_balance_with_first_deposit_bonus(
      v_user_id,
      v_amount,
      'Test credit',
      v_reference_id
    ) INTO v_result;
    
    RAISE NOTICE '✅ SUCCESS!';
    RAISE NOTICE 'Result: %', v_result;
    
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '❌ ERROR: %', SQLERRM;
    RAISE NOTICE 'SQLSTATE: %', SQLSTATE;
    RAISE NOTICE 'Detail: %', SQLSTATE;
  END;
  
END $$;
