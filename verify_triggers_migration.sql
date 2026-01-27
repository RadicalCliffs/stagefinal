-- ============================================================================
-- VERIFY TRIGGERS BASELINE MIGRATION
-- ============================================================================
-- Purpose: Verify that the triggers baseline migration was applied successfully
-- Usage: Run in Supabase SQL Editor or via CLI:
--        supabase db execute -f verify_triggers_migration.sql
-- ============================================================================

-- ============================================================================
-- SECTION 1: TRIGGER COUNTS
-- ============================================================================

DO $$ 
DECLARE
  v_trigger_count INTEGER;
  v_expected_min INTEGER := 9; -- Phase 1: 8 timestamp triggers + 1 expiry trigger
BEGIN
  -- Count all non-internal triggers in public schema
  SELECT COUNT(*) INTO v_trigger_count
  FROM pg_trigger t
  JOIN pg_class c ON t.tgrelid = c.oid
  WHERE NOT t.tgisinternal
  AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
  
  RAISE NOTICE '';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'TRIGGER VERIFICATION REPORT';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Total Triggers Found: %', v_trigger_count;
  RAISE NOTICE 'Minimum Expected (Phase 1): %', v_expected_min;
  
  IF v_trigger_count >= v_expected_min THEN
    RAISE NOTICE 'Status: ✓ PASS - Sufficient triggers found';
  ELSE
    RAISE WARNING 'Status: ✗ FAIL - Expected at least % triggers, found %', v_expected_min, v_trigger_count;
  END IF;
  RAISE NOTICE '';
END $$;

-- ============================================================================
-- SECTION 2: SPECIFIC TRIGGER VERIFICATION
-- ============================================================================

DO $$
DECLARE
  v_trigger_exists BOOLEAN;
  v_pass_count INTEGER := 0;
  v_fail_count INTEGER := 0;
BEGIN
  RAISE NOTICE '-----------------------------------------------------------------';
  RAISE NOTICE 'Phase 1 Core Triggers (Expected: 9 total)';
  RAISE NOTICE '-----------------------------------------------------------------';
  RAISE NOTICE '';
  
  -- Check timestamp update triggers (8 expected)
  RAISE NOTICE 'Timestamp Update Triggers (8 expected):';
  
  -- user_transactions
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    WHERE t.tgname = 'update_user_transactions_updated_at'
    AND c.relname = 'user_transactions'
  ) INTO v_trigger_exists;
  IF v_trigger_exists THEN
    RAISE NOTICE '  ✓ update_user_transactions_updated_at';
    v_pass_count := v_pass_count + 1;
  ELSE
    RAISE WARNING '  ✗ update_user_transactions_updated_at - NOT FOUND';
    v_fail_count := v_fail_count + 1;
  END IF;
  
  -- pending_tickets
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    WHERE t.tgname = 'update_pending_tickets_updated_at'
    AND c.relname = 'pending_tickets'
  ) INTO v_trigger_exists;
  IF v_trigger_exists THEN
    RAISE NOTICE '  ✓ update_pending_tickets_updated_at';
    v_pass_count := v_pass_count + 1;
  ELSE
    RAISE WARNING '  ✗ update_pending_tickets_updated_at - NOT FOUND';
    v_fail_count := v_fail_count + 1;
  END IF;
  
  -- sub_account_balances
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    WHERE t.tgname = 'update_sub_account_balances_updated_at'
    AND c.relname = 'sub_account_balances'
  ) INTO v_trigger_exists;
  IF v_trigger_exists THEN
    RAISE NOTICE '  ✓ update_sub_account_balances_updated_at';
    v_pass_count := v_pass_count + 1;
  ELSE
    RAISE WARNING '  ✗ update_sub_account_balances_updated_at - NOT FOUND';
    v_fail_count := v_fail_count + 1;
  END IF;
  
  -- canonical_users
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    WHERE t.tgname = 'update_canonical_users_updated_at'
    AND c.relname = 'canonical_users'
  ) INTO v_trigger_exists;
  IF v_trigger_exists THEN
    RAISE NOTICE '  ✓ update_canonical_users_updated_at';
    v_pass_count := v_pass_count + 1;
  ELSE
    RAISE WARNING '  ✗ update_canonical_users_updated_at - NOT FOUND';
    v_fail_count := v_fail_count + 1;
  END IF;
  
  -- users
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    WHERE t.tgname = 'update_users_updated_at'
    AND c.relname = 'users'
  ) INTO v_trigger_exists;
  IF v_trigger_exists THEN
    RAISE NOTICE '  ✓ update_users_updated_at';
    v_pass_count := v_pass_count + 1;
  ELSE
    RAISE WARNING '  ✗ update_users_updated_at - NOT FOUND';
    v_fail_count := v_fail_count + 1;
  END IF;
  
  -- profiles
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    WHERE t.tgname = 'update_profiles_updated_at'
    AND c.relname = 'profiles'
  ) INTO v_trigger_exists;
  IF v_trigger_exists THEN
    RAISE NOTICE '  ✓ update_profiles_updated_at';
    v_pass_count := v_pass_count + 1;
  ELSE
    RAISE WARNING '  ✗ update_profiles_updated_at - NOT FOUND';
    v_fail_count := v_fail_count + 1;
  END IF;
  
  -- orders
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    WHERE t.tgname = 'update_orders_updated_at'
    AND c.relname = 'orders'
  ) INTO v_trigger_exists;
  IF v_trigger_exists THEN
    RAISE NOTICE '  ✓ update_orders_updated_at';
    v_pass_count := v_pass_count + 1;
  ELSE
    RAISE WARNING '  ✗ update_orders_updated_at - NOT FOUND';
    v_fail_count := v_fail_count + 1;
  END IF;
  
  -- competitions
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    WHERE t.tgname = 'update_competitions_updated_at'
    AND c.relname = 'competitions'
  ) INTO v_trigger_exists;
  IF v_trigger_exists THEN
    RAISE NOTICE '  ✓ update_competitions_updated_at';
    v_pass_count := v_pass_count + 1;
  ELSE
    RAISE WARNING '  ✗ update_competitions_updated_at - NOT FOUND';
    v_fail_count := v_fail_count + 1;
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE 'Reservation Expiry Trigger (1 expected):';
  
  -- check_reservation_expiry
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    WHERE t.tgname = 'check_reservation_expiry'
    AND c.relname = 'pending_tickets'
  ) INTO v_trigger_exists;
  IF v_trigger_exists THEN
    RAISE NOTICE '  ✓ check_reservation_expiry';
    v_pass_count := v_pass_count + 1;
  ELSE
    RAISE WARNING '  ✗ check_reservation_expiry - NOT FOUND';
    v_fail_count := v_fail_count + 1;
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE '-----------------------------------------------------------------';
  RAISE NOTICE 'Phase 1 Results: % passed, % failed', v_pass_count, v_fail_count;
  RAISE NOTICE '-----------------------------------------------------------------';
  RAISE NOTICE '';
END $$;

-- ============================================================================
-- SECTION 3: TRIGGER FUNCTION VERIFICATION
-- ============================================================================

DO $$
DECLARE
  v_function_exists BOOLEAN;
  v_pass_count INTEGER := 0;
  v_fail_count INTEGER := 0;
BEGIN
  RAISE NOTICE '-----------------------------------------------------------------';
  RAISE NOTICE 'Trigger Functions (Expected: 2)';
  RAISE NOTICE '-----------------------------------------------------------------';
  RAISE NOTICE '';
  
  -- update_updated_at_column
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
    AND p.proname = 'update_updated_at_column'
  ) INTO v_function_exists;
  IF v_function_exists THEN
    RAISE NOTICE '  ✓ update_updated_at_column()';
    v_pass_count := v_pass_count + 1;
  ELSE
    RAISE WARNING '  ✗ update_updated_at_column() - NOT FOUND';
    v_fail_count := v_fail_count + 1;
  END IF;
  
  -- auto_expire_reservations
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
    AND p.proname = 'auto_expire_reservations'
  ) INTO v_function_exists;
  IF v_function_exists THEN
    RAISE NOTICE '  ✓ auto_expire_reservations()';
    v_pass_count := v_pass_count + 1;
  ELSE
    RAISE WARNING '  ✗ auto_expire_reservations() - NOT FOUND';
    v_fail_count := v_fail_count + 1;
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE '-----------------------------------------------------------------';
  RAISE NOTICE 'Function Results: % passed, % failed', v_pass_count, v_fail_count;
  RAISE NOTICE '-----------------------------------------------------------------';
  RAISE NOTICE '';
END $$;

-- ============================================================================
-- SECTION 4: DETAILED TRIGGER LISTING
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'ALL TRIGGERS IN PUBLIC SCHEMA';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Table Name                    | Trigger Name';
  RAISE NOTICE '------------------------------+--------------------------------';
END $$;

SELECT 
  RPAD(c.relname, 30, ' ') || '| ' || t.tgname as trigger_info
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
WHERE NOT t.tgisinternal
AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
ORDER BY c.relname, t.tgname;

-- ============================================================================
-- SECTION 5: FINAL SUMMARY
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'VERIFICATION COMPLETE';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE '';
  RAISE NOTICE 'If all Phase 1 triggers show ✓ (checkmark), the migration was';
  RAISE NOTICE 'applied successfully. If any show ✗ (x), re-run the migration.';
  RAISE NOTICE '';
  RAISE NOTICE 'For Phase 2 (remaining 41 triggers), see:';
  RAISE NOTICE '  - TRIGGERS_MIGRATION_README.md';
  RAISE NOTICE '  - TRIGGERS_MIGRATION_TASK_SUMMARY.md';
  RAISE NOTICE '';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE '';
END $$;
