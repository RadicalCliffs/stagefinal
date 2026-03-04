-- ============================================================================
-- FIX STUCK TOPUPS: Credit Missing Topups for Highblock & Luxe
-- ============================================================================
-- Root Cause: Commerce webhook idempotency bug checks transaction.status instead
-- of only checking posted_to_balance/wallet_credited flags
-- 
-- Analysis:
--   Luxe: Has $7.5 balance ($5 + $2.5 bonus) - suggests ONE topup was credited
--         Transaction ca16d095: $5, finished, NO ledger entries - STUCK
--         Transaction 82c01416: $5, pending, NO ledger entries - might be credited already
--   
--   Highblock: Has $48,766.90 balance, multiple successful topups
--              Transaction b1b7a840: $3, finished, NO ledger entries - STUCK
--
-- Strategy: Check balance_ledger first, only credit if truly missing
-- 
-- IMPORTANT: Uses credit_balance_with_first_deposit_bonus() function because:
--   - Properly sets canonical_user_id_norm field (required NOT NULL)
--   - Has idempotency built in via reference_id
--   - Won't apply bonus since users already have has_used_new_user_bonus=true
--   - More robust than credit_sub_account_balance()
--
-- NOTE: wallet_credited column doesn't exist in production yet, so we skip
--       updating it in manual UPDATE statements (function tries but fails gracefully)
-- ============================================================================

DO $$
DECLARE
  v_highblock_user TEXT := 'prize:pid:0x543e8fb59312a2578f70152c79eae169e4f8fe9e';
  v_highblock_tx UUID := 'b1b7a840-142e-40e0-aef1-aab2c157697a';
  v_highblock_amount NUMERIC := 3.00;
  v_highblock_tx_id TEXT := '05d3bb0e-4aaf-43a5-8096-c2271813203b';
  v_highblock_ref TEXT := 'TOPUP_prize:pid:0x543e8fb59312a2578f70152c79eae169e4f8fe9e_b1b7a840-142e-40e0-aef1-aab2c157697a';
  
  v_luxe_user TEXT := 'prize:pid:0xc469777462c1769b918a299a89c1d5eeaa4d5ee3';
  v_luxe_tx UUID := 'ca16d095-d855-4cc1-a866-557741347a65';
  v_luxe_amount NUMERIC := 5.00;
  v_luxe_tx_id TEXT := 'ac56002b-8db3-43b6-b46c-d191c5e67933';
  v_luxe_ref TEXT := 'TOPUP_prize:pid:0xc469777462c1769b918a299a89c1d5eeaa4d5ee3_ca16d095-d855-4cc1-a866-557741347a65';
  
  v_ledger_count INTEGER;
  v_result JSONB;
BEGIN
  RAISE NOTICE '════════════════════════════════════════════════════════════════';
  RAISE NOTICE 'FIXING STUCK TOPUPS - Intelligent Credit with Deduplication';
  RAISE NOTICE '════════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  
  -- ============================================================================
  -- HIGHBLOCK: Check and Credit $3 Topup
  -- ============================================================================
  RAISE NOTICE '1. Checking Highblock $3 topup...';
  RAISE NOTICE '   User: %', v_highblock_user;
  RAISE NOTICE '   Transaction ID: %', v_highblock_tx;
  RAISE NOTICE '   TX ID: %', v_highblock_tx_id;
  
  -- Check if already in balance_ledger
  SELECT COUNT(*) INTO v_ledger_count
  FROM balance_ledger
  WHERE canonical_user_id = v_highblock_user
    AND (
      reference_id = v_highblock_ref 
      OR reference_id = v_highblock_tx_id
      OR reference_id = v_highblock_tx::text
    );
  
  IF v_ledger_count > 0 THEN
    RAISE NOTICE '   ℹ️  Already credited - found % balance_ledger entries', v_ledger_count;
    RAISE NOTICE '   ✅ Marking transaction as posted_to_balance=true';
    
    -- Just update the flags (wallet_credited column doesn't exist in prod yet)
    UPDATE user_transactions
    SET posted_to_balance = true,
        status = 'completed',
        updated_at = NOW()
    WHERE id = v_highblock_tx;
    
  ELSE
    RAISE NOTICE '   ⚠️  NOT in balance_ledger - crediting now...';
    
    -- Credit using bonus function (handles canonical_user_id_norm properly)
    -- Won't apply bonus since user already used it
    SELECT credit_balance_with_first_deposit_bonus(
      v_highblock_user,
      v_highblock_amount,
      'Manual credit - stuck topup recovery',
      v_highblock_ref
    ) INTO v_result;
    
    IF (v_result->>'success')::boolean THEN
      RAISE NOTICE '   ✅ Credited $% successfully', v_highblock_amount;
      RAISE NOTICE '   New balance: $%', v_result->>'new_balance';
      RAISE NOTICE '   Bonus applied: %', v_result->>'bonus_applied';
      
      -- Update transaction flags (wallet_credited column doesn't exist in prod yet)
      UPDATE user_transactions
      SET posted_to_balance = true,
          status = 'completed',
          updated_at = NOW(),
          notes = COALESCE(notes, '') || ' [FIX: Manually credited ' || NOW()::DATE || ']'
      WHERE id = v_highblock_tx;
      
      RAISE NOTICE '   ✅ Transaction marked as credited';
    ELSE
      RAISE NOTICE '   ❌ Credit failed: %', v_result->>'error_message';
    END IF;
  END IF;
  
  RAISE NOTICE '';
  
  -- ============================================================================
  -- LUXE: Check and Credit $5 Topup
  -- ============================================================================
  RAISE NOTICE '2. Checking Luxe $5 topup...';
  RAISE NOTICE '   User: %', v_luxe_user;
  RAISE NOTICE '   Transaction ID: %', v_luxe_tx;
  RAISE NOTICE '   TX ID: %', v_luxe_tx_id;
  
  -- Check if already in balance_ledger
  SELECT COUNT(*) INTO v_ledger_count
  FROM balance_ledger
  WHERE canonical_user_id = v_luxe_user
    AND (
      reference_id = v_luxe_ref
      OR reference_id = v_luxe_tx_id 
      OR reference_id = v_luxe_tx::text
    );
  
  IF v_ledger_count > 0 THEN
    RAISE NOTICE '   ℹ️  Already credited - found % balance_ledger entries', v_ledger_count;
    RAISE NOTICE '   ✅ Marking transaction as posted_to_balance=true';
    
    -- Just update the flags (wallet_credited column doesn't exist in prod yet)
    UPDATE user_transactions
    SET posted_to_balance = true,
        status = 'completed',
        updated_at = NOW()
    WHERE id = v_luxe_tx;
    
  ELSE
    RAISE NOTICE '   ⚠️  NOT in balance_ledger - crediting now...';
    
    -- Credit using bonus function (handles canonical_user_id_norm properly)
    -- Won't apply bonus since user already used it
    SELECT credit_balance_with_first_deposit_bonus(
      v_luxe_user,
      v_luxe_amount,
      'Manual credit - stuck topup recovery',
      v_luxe_ref
    ) INTO v_result;
    
    IF (v_result->>'success')::boolean THEN
      RAISE NOTICE '   ✅ Credited $% successfully', v_luxe_amount;
      RAISE NOTICE '   New balance: $%', v_result->>'new_balance';
      RAISE NOTICE '   Bonus applied: %', v_result->>'bonus_applied';
      
      -- Update transaction flags (wallet_credited column doesn't exist in prod yet)
      UPDATE user_transactions
      SET posted_to_balance = true,
          status = 'completed',
          updated_at = NOW(),
          notes = COALESCE(notes, '') || ' [FIX: Manually credited ' || NOW()::DATE || ']'
      WHERE id = v_luxe_tx;
      
      RAISE NOTICE '   ✅ Transaction marked as credited';
    ELSE
      RAISE NOTICE '   ❌ Credit failed: %', v_result->>'error_message';
    END IF;
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════════════';
  RAISE NOTICE 'FIX COMPLETE';
  RAISE NOTICE '════════════════════════════════════════════════════════════════';
  RAISE NOTICE 'Next steps:';
  RAISE NOTICE '1. Deploy fixed commerce-webhook (idempotency bug fix applied)';
  RAISE NOTICE '2. Verify user balances are correct in their dashboards';
  RAISE NOTICE '3. Future topups will now credit correctly';
  RAISE NOTICE '';
END $$;
