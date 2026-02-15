-- ============================================================================
-- EMERGENCY HOTFIX: Add missing updated_at column to sub_account_balances
-- ============================================================================
-- Error: column "updated_at" of relation "sub_account_balances" does not exist
-- This column is referenced in the application code but missing from production
-- ============================================================================

BEGIN;

-- Check if column exists
DO $$
DECLARE
  v_column_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sub_account_balances'
      AND column_name = 'updated_at'
  ) INTO v_column_exists;
  
  IF v_column_exists THEN
    RAISE NOTICE '✅ Column updated_at already exists in sub_account_balances';
  ELSE
    RAISE NOTICE '❌ Column updated_at is MISSING from sub_account_balances';
    RAISE NOTICE 'Adding column now...';
    
    -- Add the missing column
    ALTER TABLE sub_account_balances 
      ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;
    
    RAISE NOTICE '✅ Column updated_at added successfully';
  END IF;
END $$;

-- Create or replace trigger to auto-update updated_at
DROP TRIGGER IF EXISTS update_sub_account_balances_updated_at ON sub_account_balances;

CREATE TRIGGER update_sub_account_balances_updated_at
  BEFORE UPDATE ON sub_account_balances
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Verify
DO $$
DECLARE
  v_column_exists BOOLEAN;
  v_trigger_exists BOOLEAN;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '============================================';
  RAISE NOTICE '✅ VERIFICATION';
  RAISE NOTICE '============================================';
  
  -- Check column
  SELECT EXISTS (
    SELECT 1 
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sub_account_balances'
      AND column_name = 'updated_at'
  ) INTO v_column_exists;
  
  IF v_column_exists THEN
    RAISE NOTICE '✅ Column updated_at exists';
  ELSE
    RAISE WARNING '❌ Column updated_at still missing!';
  END IF;
  
  -- Check trigger
  SELECT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    WHERE c.relname = 'sub_account_balances'
      AND t.tgname = 'update_sub_account_balances_updated_at'
      AND NOT t.tgisinternal
  ) INTO v_trigger_exists;
  
  IF v_trigger_exists THEN
    RAISE NOTICE '✅ Trigger update_sub_account_balances_updated_at exists';
  ELSE
    RAISE WARNING '❌ Trigger not found!';
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE 'Purchases should now work without updated_at error!';
  RAISE NOTICE '============================================';
END $$;

COMMIT;
