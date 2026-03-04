-- Test the credit function with detailed error output
DO $test$
DECLARE
  v_result JSONB;
BEGIN
  -- Try to credit ONE transaction
  SELECT credit_balance_with_first_deposit_bonus(
    'prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363',
    3,
    'Test credit with full error output',
    'test_ref_' || extract(epoch from now())::text
  ) INTO v_result;
  
  RAISE NOTICE 'Function returned: %', v_result::text;
  
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED WITH ERROR:';
  RAISE NOTICE 'Message: %', SQLERRM;
  RAISE NOTICE 'Detail: %', SQLSTATE;
  RAISE EXCEPTION '%', SQLERRM;  -- Re-raise to see full error
END $test$;
