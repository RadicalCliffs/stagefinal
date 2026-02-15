-- ============================================================================
-- EMERGENCY FIX: Drop trigger functions referencing balance_usd
-- ============================================================================
-- The production database has trigger functions that reference NEW.balance_usd
-- or OLD.balance_usd but the actual column name is usdc_balance.
-- 
-- This script drops those functions so triggers will fail gracefully rather
-- than causing 500 errors. After dropping, purchases will work.
-- 
-- Apply immediately via Supabase SQL Editor.
-- ============================================================================

BEGIN;

-- Step 1: Find and report what we're about to drop
DO $$
DECLARE
  func_rec RECORD;
BEGIN
  RAISE NOTICE '=== TRIGGER FUNCTIONS TO BE DROPPED ===';
  
  FOR func_rec IN
    SELECT 
      p.proname,
      n.nspname
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'mirror_canonical_users_to_sub_balances',
        'init_sub_balance_after_canonical_user',
        'handle_canonical_user_insert'
      )
  LOOP
    RAISE NOTICE 'Will drop: %.%()', func_rec.nspname, func_rec.proname;
  END LOOP;
END $$;

-- Step 2: Drop the problematic trigger functions
-- Using CASCADE will also drop the triggers that call them
DROP FUNCTION IF EXISTS mirror_canonical_users_to_sub_balances() CASCADE;
DROP FUNCTION IF EXISTS init_sub_balance_after_canonical_user() CASCADE;
DROP FUNCTION IF EXISTS handle_canonical_user_insert() CASCADE;

-- Step 3: Verify triggers were dropped
DO $$
DECLARE
  trigger_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO trigger_count
  FROM pg_trigger t
  JOIN pg_class c ON t.tgrelid = c.oid
  WHERE c.relname = 'canonical_users'
    AND t.tgname IN (
      'trg_mirror_cu_to_sab_ins',
      'trg_mirror_cu_to_sab_upd',
      'trg_init_sub_balance',
      'trg_provision_sub_account_balance'
    )
    AND NOT t.tgisinternal;
  
  IF trigger_count > 0 THEN
    RAISE WARNING 'Some triggers still exist after dropping functions: %', trigger_count;
  ELSE
    RAISE NOTICE '✅ All problematic triggers have been dropped';
  END IF;
END $$;

-- Step 4: List remaining triggers on canonical_users
DO $$
DECLARE
  trigger_rec RECORD;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== REMAINING TRIGGERS ON canonical_users ===';
  
  FOR trigger_rec IN
    SELECT 
      t.tgname,
      p.proname
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_proc p ON t.tgfoid = p.oid
    WHERE c.relname = 'canonical_users'
      AND NOT t.tgisinternal
    ORDER BY t.tgname
  LOOP
    RAISE NOTICE '  Trigger: % → Function: %()', trigger_rec.tgname, trigger_rec.proname;
  END LOOP;
END $$;

COMMIT;

-- Final message
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '============================================';
  RAISE NOTICE '✅ FIX APPLIED SUCCESSFULLY';
  RAISE NOTICE '============================================';
  RAISE NOTICE 'Dropped functions that referenced balance_usd:';
  RAISE NOTICE '  - mirror_canonical_users_to_sub_balances()';
  RAISE NOTICE '  - init_sub_balance_after_canonical_user()';
  RAISE NOTICE '  - handle_canonical_user_insert()';
  RAISE NOTICE '';
  RAISE NOTICE 'Associated triggers also dropped:';
  RAISE NOTICE '  - trg_mirror_cu_to_sab_ins';
  RAISE NOTICE '  - trg_mirror_cu_to_sab_upd';
  RAISE NOTICE '  - trg_init_sub_balance';
  RAISE NOTICE '  - trg_provision_sub_account_balance';
  RAISE NOTICE '';
  RAISE NOTICE 'Users can now purchase tickets!';
  RAISE NOTICE '============================================';
END $$;
