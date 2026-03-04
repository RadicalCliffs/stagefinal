-- ============================================================================
-- SIMPLE FIX: Just add the fucking money to available_balance
-- ============================================================================
-- No fancy functions, just direct SQL that WORKS

DO $$
DECLARE
  v_topup RECORD;
  v_current_balance NUMERIC;
  v_new_balance NUMERIC;
  v_reference_id TEXT;
  v_canonical_user_id TEXT;
  v_success_count INTEGER := 0;
BEGIN
  RAISE NOTICE '=== CREDITING TOPUPS DIRECTLY TO available_balance ===';
  RAISE NOTICE '';
  
  -- Process each unpaid topup
  FOR v_topup IN
    SELECT *
    FROM user_transactions
    WHERE type = 'topup'
      AND (status IN ('completed', 'finished', 'confirmed') 
           OR payment_status IN ('completed', 'finished', 'confirmed'))
      AND (posted_to_balance IS NULL OR posted_to_balance = false)
    ORDER BY created_at ASC
  LOOP
    -- Extract canonical_user_id from webhook_ref if missing
    v_canonical_user_id := v_topup.canonical_user_id;
    IF v_canonical_user_id IS NULL AND v_topup.webhook_ref IS NOT NULL THEN
      v_canonical_user_id := regexp_replace(v_topup.webhook_ref, '^TOPUP_(prize:pid:0x[a-fA-F0-9]+)_.*$', '\1');
    END IF;
    
    IF v_canonical_user_id IS NULL THEN
      RAISE NOTICE 'SKIP: % - No canonical_user_id', v_topup.id;
      CONTINUE;
    END IF;
    
    RAISE NOTICE 'Processing: % - User: % - Amount: $%', 
      v_topup.id, v_canonical_user_id, v_topup.amount;
    
    -- Get reference ID
    v_reference_id := COALESCE(
      v_topup.webhook_ref,
      v_topup.tx_id,
      v_topup.charge_id,
      v_topup.id::text
    );
    
    -- Get current balance
    SELECT COALESCE(available_balance, 0) INTO v_current_balance
    FROM sub_account_balances
    WHERE canonical_user_id = v_canonical_user_id 
      AND currency = 'USD';
    
    -- Calculate new balance
    v_new_balance := v_current_balance + v_topup.amount;
    
    -- UPDATE available_balance
    INSERT INTO sub_account_balances (canonical_user_id, canonical_user_id_norm, currency, available_balance)
    VALUES (v_canonical_user_id, LOWER(v_canonical_user_id), 'USD', v_topup.amount)
    ON CONFLICT (canonical_user_id, currency)
    DO UPDATE SET
      available_balance = sub_account_balances.available_balance + v_topup.amount,
      updated_at = NOW();
    
    -- CREATE balance_ledger entry
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
      'deposit',
      v_topup.amount,
      v_reference_id,
      'Retroactive topup credit',
      v_current_balance,
      v_new_balance
    );
    
    -- MARK as posted and update canonical_user_id if it was missing
    UPDATE user_transactions
    SET 
      canonical_user_id = v_canonical_user_id,
      posted_to_balance = true,
      balance_before = v_current_balance,
      balance_after = v_new_balance,
      updated_at = NOW()
    WHERE id = v_topup.id;
    
    v_success_count := v_success_count + 1;
    RAISE NOTICE '  ✅ Credited $% (Balance: $% → $%)', v_topup.amount, v_current_balance, v_new_balance;
    RAISE NOTICE '';
  END LOOP;
  
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE 'DONE! Credited % topups', v_success_count;
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
END $$;
