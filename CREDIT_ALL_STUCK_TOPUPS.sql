-- ============================================================================
-- CREDIT ALL UNCREDITED TOPUPS WITH 50% BONUS
-- ============================================================================
-- This finds all completed topups that were never credited and credits them now
-- Applying 50% first deposit bonus where applicable
--
-- IMPORTANT: The 50% bonus ONLY applies to the user's FIRST EVER topup
-- If the user has already received the bonus (has_used_new_user_bonus = true),
-- subsequent topups will only credit the deposit amount without bonus.
--
-- BEFORE RUNNING THIS: Make sure you deployed DEPLOY_50_PERCENT_BONUS_NOW.sql first!
-- That file contains the fixed credit_balance_with_first_deposit_bonus function.

DO $$
DECLARE
  v_topup RECORD;
  v_result JSONB;
  v_reference_id TEXT;
  v_success_count INTEGER := 0;
  v_already_credited_count INTEGER := 0;
  v_error_count INTEGER := 0;
BEGIN
  RAISE NOTICE '=== CREDITING ALL UNCREDITED TOPUPS WITH 50%% BONUS ===';
  RAISE NOTICE '';
  
  -- Find all completed topups that haven't been credited
  FOR v_topup IN
    SELECT *
    FROM user_transactions
    WHERE type = 'topup'
      AND (status IN ('completed', 'finished', 'confirmed') 
           OR payment_status IN ('completed', 'finished', 'confirmed'))
      AND (posted_to_balance IS NULL OR posted_to_balance = false)
    ORDER BY created_at DESC
  LOOP
    RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
    RAISE NOTICE '📦 Transaction: %', v_topup.id;
    RAISE NOTICE '   User: %', v_topup.canonical_user_id;
    RAISE NOTICE '   Amount: $%', v_topup.amount;
    RAISE NOTICE '   Provider: %', v_topup.payment_provider;
    RAISE NOTICE '   Status: % / %', v_topup.status, v_topup.payment_status;
    RAISE NOTICE '   Created: %', v_topup.created_at;
    
    -- Use webhook_ref, tx_id, charge_id, or transaction ID as reference
    v_reference_id := COALESCE(
      v_topup.webhook_ref,
      v_topup.tx_id,
      v_topup.charge_id,
      v_topup.id::text
    );
    
    RAISE NOTICE '   Reference ID: %', v_reference_id;
    RAISE NOTICE '';
    RAISE NOTICE '   🔧 Crediting balance...';
    
    BEGIN
      -- Call credit_balance_with_first_deposit_bonus (50% bonus applied if first topup)
      SELECT credit_balance_with_first_deposit_bonus(
        v_topup.canonical_user_id,
        v_topup.amount,
        'Retroactive credit for ' || COALESCE(v_topup.payment_provider, 'unknown') || ' topup',
        v_reference_id
      ) INTO v_result;
      
      IF v_result->>'already_credited' = 'true' THEN
        RAISE NOTICE '   ℹ️  Already credited: %', v_result->>'idempotency_note';
        v_already_credited_count := v_already_credited_count + 1;
      ELSE
        RAISE NOTICE '   ✅ CREDITED SUCCESSFULLY!';
        RAISE NOTICE '      Deposited: $%', v_result->>'deposited_amount';
        RAISE NOTICE '      Bonus: $% %', 
          v_result->>'bonus_amount', 
          CASE WHEN (v_result->>'bonus_applied')::boolean THEN '🎁 FIRST DEPOSIT BONUS!' ELSE '' END;
        RAISE NOTICE '      Total credited: $%', v_result->>'total_credited';
        RAISE NOTICE '      Previous balance: $%', v_result->>'previous_balance';
        RAISE NOTICE '      New balance: $%', v_result->>'new_balance';
        v_success_count := v_success_count + 1;
      END IF;
      
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '   ❌ Error: % %', SQLERRM, SQLSTATE;
      v_error_count := v_error_count + 1;
    END;
    
    RAISE NOTICE '';
  END LOOP;
  
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE '';
  RAISE NOTICE '📊 FINAL RESULTS:';
  RAISE NOTICE '   ✅ Successfully credited: %', v_success_count;
  RAISE NOTICE '   ℹ️  Already credited: %', v_already_credited_count;
  RAISE NOTICE '   ❌ Errors: %', v_error_count;
  RAISE NOTICE '';
  RAISE NOTICE '🎉 All done! Users should now see their balance updates and 50%% bonuses!';
  RAISE NOTICE '   Dashboard will now show balance_before/balance_after from balance_ledger';
END $$;
