-- ============================================================================
-- COMPLETE FIX: Recreate Trigger to Sync canonical_users TO sub_account_balances
-- ============================================================================
-- This fixes the balance sync issue where:
-- 1. sub_account_balances only allows credits, not debits
-- 2. canonical_users allows both credits and debits
-- 3. Need to sync FROM canonical_users TO sub_account_balances
--
-- Apply this AFTER running HOTFIX_DROP_BALANCE_USD_TRIGGERS.sql
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Ensure old broken functions are dropped
-- ============================================================================

DROP FUNCTION IF EXISTS mirror_canonical_users_to_sub_balances() CASCADE;
DROP FUNCTION IF EXISTS init_sub_balance_after_canonical_user() CASCADE;
DROP FUNCTION IF EXISTS handle_canonical_user_insert() CASCADE;

-- ============================================================================
-- STEP 2: Create NEW sync function with CORRECT column name
-- ============================================================================

CREATE OR REPLACE FUNCTION sync_canonical_users_to_sub_account_balances()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_record_exists BOOLEAN;
BEGIN
  -- Only sync if usdc_balance changed or is being set
  IF (TG_OP = 'UPDATE' AND NEW.usdc_balance = OLD.usdc_balance) THEN
    RETURN NEW;
  END IF;

  -- Check if sub_account_balances record exists for this user
  SELECT EXISTS(
    SELECT 1 FROM sub_account_balances
    WHERE canonical_user_id = NEW.canonical_user_id
      AND currency = 'USD'
  ) INTO v_record_exists;

  IF v_record_exists THEN
    -- Update existing record
    UPDATE sub_account_balances
    SET 
      available_balance = NEW.usdc_balance,
      updated_at = NOW()
    WHERE canonical_user_id = NEW.canonical_user_id
      AND currency = 'USD';
    
    RAISE NOTICE '[Sync] Updated sub_account_balances for % with balance %', 
      NEW.canonical_user_id, NEW.usdc_balance;
  ELSE
    -- Insert new record
    INSERT INTO sub_account_balances (
      canonical_user_id,
      user_id,
      privy_user_id,
      currency,
      available_balance,
      pending_balance,
      bonus_balance
    ) VALUES (
      NEW.canonical_user_id,
      NEW.uid,
      NEW.privy_user_id,
      'USD',
      COALESCE(NEW.usdc_balance, 0),
      0,
      COALESCE(NEW.bonus_balance, 0)
    )
    ON CONFLICT (canonical_user_id, currency) DO UPDATE
    SET 
      available_balance = EXCLUDED.available_balance,
      bonus_balance = EXCLUDED.bonus_balance,
      updated_at = NOW();
    
    RAISE NOTICE '[Sync] Inserted sub_account_balances for % with balance %', 
      NEW.canonical_user_id, NEW.usdc_balance;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION sync_canonical_users_to_sub_account_balances() IS
'Syncs balance changes from canonical_users.usdc_balance to sub_account_balances.available_balance.
This ensures that when canonical_users balance is debited (decreased), sub_account_balances is also updated.
Fixes issue where sub_account_balances only allowed credits and would overwrite debits.';

-- ============================================================================
-- STEP 3: Create trigger on canonical_users table
-- ============================================================================

-- Drop trigger if it exists
DROP TRIGGER IF EXISTS trg_sync_cu_balance_to_sab ON canonical_users;

-- Create trigger that fires AFTER UPDATE
CREATE TRIGGER trg_sync_cu_balance_to_sab
  AFTER INSERT OR UPDATE OF usdc_balance
  ON canonical_users
  FOR EACH ROW
  EXECUTE FUNCTION sync_canonical_users_to_sub_account_balances();

COMMENT ON TRIGGER trg_sync_cu_balance_to_sab ON canonical_users IS
'Syncs balance changes from canonical_users to sub_account_balances after every balance update.
This ensures both tables stay in sync for credits AND debits.';

-- ============================================================================
-- STEP 4: Verification
-- ============================================================================

DO $$
DECLARE
  v_trigger_count INTEGER;
  v_function_exists BOOLEAN;
BEGIN
  -- Check if function exists
  SELECT EXISTS(
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname = 'sync_canonical_users_to_sub_account_balances'
  ) INTO v_function_exists;

  -- Check if trigger exists
  SELECT COUNT(*) INTO v_trigger_count
  FROM pg_trigger t
  JOIN pg_class c ON t.tgrelid = c.oid
  WHERE c.relname = 'canonical_users'
    AND t.tgname = 'trg_sync_cu_balance_to_sab'
    AND NOT t.tgisinternal;

  RAISE NOTICE '';
  RAISE NOTICE '============================================';
  RAISE NOTICE '✅ SYNC TRIGGER CREATED SUCCESSFULLY';
  RAISE NOTICE '============================================';
  
  IF v_function_exists THEN
    RAISE NOTICE '✅ Function: sync_canonical_users_to_sub_account_balances()';
  ELSE
    RAISE WARNING '❌ Function not found!';
  END IF;

  IF v_trigger_count = 1 THEN
    RAISE NOTICE '✅ Trigger: trg_sync_cu_balance_to_sab';
  ELSE
    RAISE WARNING '❌ Trigger not found! Count: %', v_trigger_count;
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE 'Sync direction: canonical_users → sub_account_balances';
  RAISE NOTICE 'Column synced: usdc_balance → available_balance';
  RAISE NOTICE 'Currency filter: USD only';
  RAISE NOTICE '';
  RAISE NOTICE 'Balance debits from canonical_users will now';
  RAISE NOTICE 'automatically sync to sub_account_balances!';
  RAISE NOTICE '============================================';
END $$;

COMMIT;

-- ============================================================================
-- STEP 5: Test the trigger (optional - uncomment to test)
-- ============================================================================

/*
-- Test: Update a user's balance and verify sync
DO $$
DECLARE
  v_test_user TEXT := 'prize:pid:0x0961e49f78817fb35617ef2c377ee7630c155aa1';
  v_cu_balance NUMERIC;
  v_sab_balance NUMERIC;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== TESTING TRIGGER ===';
  
  -- Get current balances
  SELECT usdc_balance INTO v_cu_balance
  FROM canonical_users
  WHERE canonical_user_id = v_test_user;
  
  SELECT available_balance INTO v_sab_balance
  FROM sub_account_balances
  WHERE canonical_user_id = v_test_user
    AND currency = 'USD';
  
  RAISE NOTICE 'Before update:';
  RAISE NOTICE '  canonical_users.usdc_balance: %', v_cu_balance;
  RAISE NOTICE '  sub_account_balances.available_balance: %', v_sab_balance;
  
  -- Update canonical_users balance (simulate a purchase debit)
  UPDATE canonical_users
  SET usdc_balance = usdc_balance - 10
  WHERE canonical_user_id = v_test_user;
  
  -- Check if sync happened
  SELECT usdc_balance INTO v_cu_balance
  FROM canonical_users
  WHERE canonical_user_id = v_test_user;
  
  SELECT available_balance INTO v_sab_balance
  FROM sub_account_balances
  WHERE canonical_user_id = v_test_user
    AND currency = 'USD';
  
  RAISE NOTICE '';
  RAISE NOTICE 'After update (debited $10):';
  RAISE NOTICE '  canonical_users.usdc_balance: %', v_cu_balance;
  RAISE NOTICE '  sub_account_balances.available_balance: %', v_sab_balance;
  
  IF v_cu_balance = v_sab_balance THEN
    RAISE NOTICE '';
    RAISE NOTICE '✅ SYNC SUCCESSFUL - Balances match!';
  ELSE
    RAISE WARNING '❌ SYNC FAILED - Balances do not match!';
  END IF;
  
  -- Rollback test changes
  ROLLBACK;
END $$;
*/
