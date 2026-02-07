-- ============================================================================
-- EMERGENCY HOTFIX: Fix balance_usd trigger error
-- ============================================================================
-- Error: "record \"new\" has no field \"balance_usd\""
-- Issue: A trigger in production references balance_usd but correct column is usdc_balance
-- 
-- Apply this immediately via Supabase SQL Editor:
-- 1. Supabase Dashboard → SQL Editor
-- 2. Copy and paste this entire file
-- 3. Click "Run"
-- ============================================================================

BEGIN;

-- Step 1: Find and drop any triggers that might be causing issues
DO $$
DECLARE
  trigger_rec RECORD;
  func_rec RECORD;
BEGIN
  RAISE NOTICE '=== SCANNING FOR PROBLEMATIC TRIGGERS ===';
  
  -- Find all triggers on canonical_users
  FOR trigger_rec IN 
    SELECT 
      t.tgname,
      c.relname,
      p.proname,
      pg_get_triggerdef(t.oid) AS def
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_proc p ON t.tgfoid = p.oid
    WHERE c.relname = 'canonical_users'
      AND NOT t.tgisinternal
  LOOP
    RAISE NOTICE 'Found trigger: % on % calling function %', 
      trigger_rec.tgname, trigger_rec.relname, trigger_rec.proname;
  END LOOP;
  
  -- Find functions that reference balance_usd
  FOR func_rec IN
    SELECT 
      p.proname,
      pg_get_functiondef(p.oid) AS def
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND pg_get_functiondef(p.oid) ILIKE '%balance_usd%'
  LOOP
    RAISE NOTICE '⚠️  FOUND FUNCTION WITH balance_usd: %', func_rec.proname;
    RAISE NOTICE 'Function definition contains: %', 
      SUBSTRING(func_rec.def FROM POSITION('balance_usd' IN func_rec.def) - 50 FOR 100);
  END LOOP;
  
END $$;

-- Step 2: If we found any, we need to recreate them with usdc_balance
-- Common trigger function names that might reference balance:
-- - sync_balance_to_canonical_users
-- - update_canonical_balance
-- - sync_canonical_user_balance
-- etc.

-- Check if there are any balance-sync functions and drop them
DROP FUNCTION IF EXISTS sync_balance_to_canonical_users() CASCADE;
DROP FUNCTION IF EXISTS update_canonical_balance() CASCADE;
DROP FUNCTION IF EXISTS sync_canonical_user_balance() CASCADE;
DROP FUNCTION IF EXISTS update_canonical_users_balance() CASCADE;
DROP FUNCTION IF EXISTS sync_user_balance() CASCADE;

-- Step 3: Verify canonical_users has usdc_balance column (not balance_usd)
DO $$
DECLARE
  v_column_exists BOOLEAN;
  v_column_name TEXT;
BEGIN
  -- Check for usdc_balance
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'canonical_users'
      AND column_name = 'usdc_balance'
  ) INTO v_column_exists;
  
  IF v_column_exists THEN
    RAISE NOTICE '✅ canonical_users.usdc_balance column EXISTS';
  ELSE
    RAISE WARNING '❌ canonical_users.usdc_balance column DOES NOT EXIST!';
  END IF;
  
  -- Check for balance_usd (should NOT exist)
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'canonical_users'
      AND column_name = 'balance_usd'
  ) INTO v_column_exists;
  
  IF v_column_exists THEN
    RAISE WARNING '⚠️  canonical_users.balance_usd column EXISTS (this is WRONG - should be usdc_balance)';
    RAISE WARNING '   Action required: Rename column from balance_usd to usdc_balance';
  ELSE
    RAISE NOTICE '✅ canonical_users.balance_usd column does NOT exist (correct)';
  END IF;
  
  -- List all balance-related columns
  RAISE NOTICE '';
  RAISE NOTICE 'Balance-related columns in canonical_users:';
  FOR v_column_name IN
    SELECT column_name 
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'canonical_users'
      AND column_name LIKE '%balance%'
    ORDER BY ordinal_position
  LOOP
    RAISE NOTICE '  - %', v_column_name;
  END LOOP;
END $$;

-- Step 4: If balance_usd column exists, rename it to usdc_balance
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'canonical_users'
      AND column_name = 'balance_usd'
  ) THEN
    RAISE NOTICE '';
    RAISE NOTICE '=== RENAMING COLUMN ===';
    RAISE NOTICE 'Renaming canonical_users.balance_usd to usdc_balance...';
    
    ALTER TABLE canonical_users 
      RENAME COLUMN balance_usd TO usdc_balance;
    
    RAISE NOTICE '✅ Column renamed successfully!';
  ELSE
    RAISE NOTICE '';
    RAISE NOTICE 'No column rename needed - using correct column name';
  END IF;
END $$;

COMMIT;

-- Step 5: Final verification
DO $$
DECLARE
  v_balance_count INTEGER;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== FINAL VERIFICATION ===';
  
  -- Count balance columns
  SELECT COUNT(*) INTO v_balance_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'canonical_users'
    AND column_name = 'usdc_balance';
  
  IF v_balance_count = 1 THEN
    RAISE NOTICE '✅ canonical_users.usdc_balance column verified';
    RAISE NOTICE '';
    RAISE NOTICE 'Fix applied successfully!';
    RAISE NOTICE 'Users should now be able to purchase tickets.';
  ELSE
    RAISE WARNING '❌ Verification failed - usdc_balance column count: %', v_balance_count;
  END IF;
END $$;
