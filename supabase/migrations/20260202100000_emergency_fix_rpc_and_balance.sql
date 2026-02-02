-- =====================================================
-- EMERGENCY FIX: Remove ticket_numbers and Fix Balance Sync
-- =====================================================
-- This migration fixes critical production issues:
-- 1. Removes ticket_numbers from get_user_transactions (column doesn't exist)
-- 2. Fixes sync_balance_discrepancies to use balance_ledger as source of truth
-- 3. Provides rollback_balance_from_ledger to restore correct balances
--
-- Date: 2026-02-02
-- =====================================================

BEGIN;

-- =====================================================
-- FIX 1: get_user_transactions - Remove ticket_numbers
-- The ticket_numbers column doesn't exist in user_transactions table
-- =====================================================

DROP FUNCTION IF EXISTS get_user_transactions(TEXT) CASCADE;

CREATE OR REPLACE FUNCTION public.get_user_transactions(user_identifier text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE 
  v_transactions JSONB; 
  v_canonical_user_id TEXT; 
  search_wallet TEXT;
BEGIN
  -- Extract wallet from prize:pid: format
  IF user_identifier LIKE 'prize:pid:0x%' THEN 
    search_wallet := LOWER(SUBSTRING(user_identifier FROM 11));
  ELSIF user_identifier LIKE '0x%' THEN 
    search_wallet := LOWER(user_identifier); 
  END IF;

  -- Resolve canonical user ID
  SELECT cu.canonical_user_id INTO v_canonical_user_id FROM canonical_users cu
  WHERE cu.canonical_user_id = user_identifier 
     OR cu.uid = user_identifier
     OR (search_wallet IS NOT NULL AND LOWER(cu.wallet_address) = search_wallet) 
  LIMIT 1;

  -- Build transactions with competition data enrichment
  -- FIXED: Removed ut.ticket_numbers (column doesn't exist)
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', ut.id,
      'type', ut.type,
      'amount', ut.amount,
      'currency', ut.currency,
      'status', ut.status,
      'payment_status', ut.payment_status,
      'competition_id', ut.competition_id,
      'competition_name', COALESCE(c.title, 'Unknown Competition'),
      'competition_image', c.image_url,
      'ticket_count', ut.ticket_count,
      'created_at', ut.created_at,
      'completed_at', ut.completed_at,
      'payment_method', ut.method,
      'payment_provider', ut.payment_provider,
      'tx_id', ut.tx_id,
      'transaction_hash', ut.transaction_hash,
      'order_id', ut.order_id,
      'webhook_ref', ut.webhook_ref,
      'metadata', ut.metadata,
      'balance_before', ut.balance_before,
      'balance_after', ut.balance_after,
      'is_topup', (ut.competition_id IS NULL OR (ut.webhook_ref IS NOT NULL AND ut.webhook_ref LIKE 'TOPUP_%'))
    ) 
    ORDER BY ut.created_at DESC
  ) INTO v_transactions
  FROM user_transactions ut
  LEFT JOIN competitions c ON ut.competition_id = c.id
  WHERE ut.user_id = user_identifier 
     OR ut.canonical_user_id = v_canonical_user_id 
     OR ut.user_id = v_canonical_user_id
     OR (search_wallet IS NOT NULL AND LOWER(ut.wallet_address) = search_wallet)
  LIMIT 100;

  -- Return array directly
  RETURN COALESCE(v_transactions, '[]'::jsonb);
END;
$function$;

-- =====================================================
-- FIX 2: Rollback Balance From Ledger
-- Reconstruct correct balance from balance_ledger history
-- This is the PROPER way to fix balance discrepancies
-- =====================================================

CREATE OR REPLACE FUNCTION rollback_balance_from_ledger(p_canonical_user_id TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_record RECORD;
  v_ledger_balance NUMERIC;
  v_fixed_count INTEGER := 0;
  v_total_checked INTEGER := 0;
BEGIN
  -- If specific user provided, fix only that user
  IF p_canonical_user_id IS NOT NULL THEN
    -- Get the last balance_after from balance_ledger for this user
    SELECT COALESCE(balance_after, 0) INTO v_ledger_balance
    FROM balance_ledger
    WHERE canonical_user_id = p_canonical_user_id
      AND currency = 'USD'
    ORDER BY created_at DESC, id DESC
    LIMIT 1;

    -- If no ledger entries, check sub_account_balances
    IF v_ledger_balance IS NULL THEN
      SELECT COALESCE(available_balance, 0) INTO v_ledger_balance
      FROM sub_account_balances
      WHERE canonical_user_id = p_canonical_user_id
        AND currency = 'USD'
      LIMIT 1;
    END IF;

    -- Update both tables with correct balance from ledger
    UPDATE canonical_users
    SET usdc_balance = COALESCE(v_ledger_balance, 0),
        updated_at = NOW()
    WHERE canonical_user_id = p_canonical_user_id;

    UPDATE sub_account_balances
    SET available_balance = COALESCE(v_ledger_balance, 0),
        last_updated = NOW()
    WHERE canonical_user_id = p_canonical_user_id
      AND currency = 'USD';

    v_fixed_count := 1;
    v_total_checked := 1;

  ELSE
    -- Fix all users with discrepancies
    FOR v_user_record IN
      SELECT DISTINCT bl.canonical_user_id
      FROM balance_ledger bl
      WHERE bl.currency = 'USD'
    LOOP
      v_total_checked := v_total_checked + 1;

      -- Get the last balance_after from balance_ledger
      SELECT COALESCE(balance_after, 0) INTO v_ledger_balance
      FROM balance_ledger
      WHERE canonical_user_id = v_user_record.canonical_user_id
        AND currency = 'USD'
      ORDER BY created_at DESC, id DESC
      LIMIT 1;

      -- Update both tables with correct balance from ledger
      UPDATE canonical_users
      SET usdc_balance = v_ledger_balance,
          updated_at = NOW()
      WHERE canonical_user_id = v_user_record.canonical_user_id;

      UPDATE sub_account_balances
      SET available_balance = v_ledger_balance,
          last_updated = NOW()
      WHERE canonical_user_id = v_user_record.canonical_user_id
        AND currency = 'USD';

      v_fixed_count := v_fixed_count + 1;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'users_checked', v_total_checked,
    'users_fixed', v_fixed_count,
    'message', 'Balances restored from balance_ledger (source of truth)'
  );
END;
$$;

COMMENT ON FUNCTION rollback_balance_from_ledger IS 
'Restores correct balances from balance_ledger transaction history. 
Use: SELECT * FROM rollback_balance_from_ledger(); -- fix all users
     SELECT * FROM rollback_balance_from_ledger(''prize:pid:0x...''); -- fix specific user';

-- =====================================================
-- FIX 3: Update sync_balance_discrepancies to use ledger
-- =====================================================

DROP FUNCTION IF EXISTS sync_balance_discrepancies() CASCADE;

CREATE OR REPLACE FUNCTION sync_balance_discrepancies()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  -- Use rollback_balance_from_ledger as the proper sync method
  SELECT rollback_balance_from_ledger() INTO v_result;
  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION sync_balance_discrepancies IS 
'Syncs balance discrepancies using balance_ledger as source of truth.
This is an alias to rollback_balance_from_ledger() for backward compatibility.';

COMMIT;

-- Log completion
DO $$
BEGIN
  RAISE NOTICE 'Emergency fix complete:';
  RAISE NOTICE '- Removed ticket_numbers from get_user_transactions RPC';
  RAISE NOTICE '- Added rollback_balance_from_ledger() function';
  RAISE NOTICE '- Updated sync_balance_discrepancies() to use ledger';
  RAISE NOTICE '';
  RAISE NOTICE 'To restore correct balances, run:';
  RAISE NOTICE '  SELECT * FROM rollback_balance_from_ledger();';
  RAISE NOTICE '';
  RAISE NOTICE 'To restore a specific user:';
  RAISE NOTICE '  SELECT * FROM rollback_balance_from_ledger(''prize:pid:0x...'');';
END $$;
