-- ============================================================================
-- TEST: Call credit function directly for ONE transaction
-- ============================================================================

DO $test$
DECLARE
  v_result JSONB;
  v_user_id TEXT := 'prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363';
  v_amount NUMERIC := 3;
  v_ref TEXT := 'TOPUP_prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363_36d6366e-da18-44bf-b150-c89340b66ad3';
BEGIN
  RAISE NOTICE 'Testing credit function...';
  RAISE NOTICE 'User: %', v_user_id;
  RAISE NOTICE 'Amount: $%', v_amount;
  RAISE NOTICE 'Reference: %', SUBSTRING(v_ref, 1, 50) || '...';
  RAISE NOTICE '';
  
  -- Test the function
  SELECT credit_balance_with_first_deposit_bonus(
    v_user_id,
    v_amount,
    'Manual test credit',
    v_ref
  ) INTO v_result;
  
  RAISE NOTICE 'SUCCESS!';
  RAISE NOTICE 'Result: %', v_result;
  RAISE NOTICE '';
  RAISE NOTICE 'Now check:';
  RAISE NOTICE '  - user_transactions.posted_to_balance should be TRUE';
  RAISE NOTICE '  - balance_ledger should have entries';
  RAISE NOTICE '  - sub_account_balances should show increased balance';
  
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED!';
  RAISE NOTICE 'Error: %', SQLERRM;
  RAISE NOTICE 'SQL State: %', SQLSTATE;
END $test$;
