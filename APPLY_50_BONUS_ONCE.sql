-- ============================================================================
-- APPLY 50% BONUS TO FIRST TOPUP ONLY
-- ============================================================================
-- Find the user's FIRST completed topup and add 50% bonus
-- Mark has_used_new_user_bonus = true so it never happens again

DO $$
DECLARE
  v_first_topup RECORD;
  v_bonus_amount NUMERIC;
  v_current_balance NUMERIC;
  v_new_balance NUMERIC;
  v_canonical_user_id TEXT;
BEGIN
  RAISE NOTICE '=== APPLYING 50%% FIRST TOPUP BONUS ===';
  RAISE NOTICE '';
  
  -- Find the FIRST completed topup (earliest created_at)
  SELECT *
  INTO v_first_topup
  FROM user_transactions
  WHERE type = 'topup'
    AND (status IN ('completed', 'finished', 'confirmed') 
         OR payment_status IN ('completed', 'finished', 'confirmed'))
    AND posted_to_balance = true
  ORDER BY created_at ASC
  LIMIT 1;
  
  IF v_first_topup IS NULL THEN
    RAISE NOTICE '❌ No completed topups found';
    RETURN;
  END IF;
  
  -- Extract canonical_user_id
  v_canonical_user_id := v_first_topup.canonical_user_id;
  IF v_canonical_user_id IS NULL AND v_first_topup.webhook_ref IS NOT NULL THEN
    v_canonical_user_id := regexp_replace(v_first_topup.webhook_ref, '^TOPUP_(prize:pid:0x[a-fA-F0-9]+)_.*$', '\1');
  END IF;
  
  IF v_canonical_user_id IS NULL THEN
    RAISE NOTICE '❌ Cannot determine user ID';
    RETURN;
  END IF;
  
  RAISE NOTICE 'First topup: % - User: % - Amount: $%', 
    v_first_topup.id, v_canonical_user_id, v_first_topup.amount;
  RAISE NOTICE 'Created at: %', v_first_topup.created_at;
  RAISE NOTICE '';
  
  -- Calculate 50% bonus
  v_bonus_amount := v_first_topup.amount * 0.50;
  
  RAISE NOTICE '💰 Adding 50%% bonus: $%', v_bonus_amount;
  RAISE NOTICE '';
  
  -- Get current balance
  SELECT COALESCE(available_balance, 0) INTO v_current_balance
  FROM sub_account_balances
  WHERE canonical_user_id = v_canonical_user_id 
    AND currency = 'USD';
  
  -- Calculate new balance
  v_new_balance := v_current_balance + v_bonus_amount;
  
  -- ADD bonus to available_balance
  UPDATE sub_account_balances
  SET 
    available_balance = available_balance + v_bonus_amount,
    updated_at = NOW()
  WHERE canonical_user_id = v_canonical_user_id 
    AND currency = 'USD';
  
  -- CREATE balance_ledger entry for bonus
  INSERT INTO balance_ledger (
    canonical_user_id,
    transaction_type,
    amount,
    reference_id,
    description,
    balance_before,
    balance_after
  ) VALUES (
    v_canonical_user_id,
    'bonus',
    v_bonus_amount,
    v_first_topup.id::text || '_BONUS',
    '50% First Topup Bonus',
    v_current_balance,
    v_new_balance
  );
  
  -- MARK user as having used bonus (cast TEXT to UUID)
  UPDATE canonical_users
  SET 
    has_used_new_user_bonus = true,
    updated_at = NOW()
  WHERE id::text = v_canonical_user_id;
  
  RAISE NOTICE '✅ BONUS APPLIED!';
  RAISE NOTICE '   Bonus amount: $%', v_bonus_amount;
  RAISE NOTICE '   Balance: $% → $%', v_current_balance, v_new_balance;
  RAISE NOTICE '   User marked as bonus used - will never get it again';
  RAISE NOTICE '';
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE 'DONE! User got their one-time 50%% bonus!';
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
END $$;
