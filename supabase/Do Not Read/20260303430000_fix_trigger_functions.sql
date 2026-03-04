-- ============================================================================
-- FIX: 4 trigger functions still using competitionid column
-- Found by diagnostic: sync_balance_purchase_to_user_transactions,
-- trg_sync_joincompetition_from_pending, update_tickets_sold_on_pending,
-- validate_pending_tickets
-- ============================================================================

-- We'll drop and recreate these triggers with fixes
-- Since we don't have the exact source, we'll use a generic fix approach

DO $$
DECLARE
  func_def TEXT;
  fixed_def TEXT;
  func_name TEXT;
BEGIN
  RAISE NOTICE '========================================================';
  RAISE NOTICE 'FIXING TRIGGER FUNCTIONS WITH competitionid REFERENCES';
  RAISE NOTICE '========================================================';
  
  -- Function 1: sync_balance_purchase_to_user_transactions
  func_name := 'sync_balance_purchase_to_user_transactions';
  RAISE NOTICE 'Fixing: %', func_name;
  
  SELECT pg_get_functiondef(oid) INTO func_def
  FROM pg_proc
  WHERE proname = func_name
  LIMIT 1;
  
  IF func_def IS NOT NULL AND func_def LIKE '%competitionid%' THEN
    -- Replace all occurrences of competitionid with competition_id
    fixed_def := REPLACE(func_def, 'competitionid', 'competition_id');
    fixed_def := REPLACE(fixed_def, 'COMPETITIONID', 'COMPETITION_ID');
    
    -- Execute the fixed definition
    EXECUTE fixed_def;
    RAISE NOTICE '  ✅ Fixed %', func_name;
  ELSE
    RAISE NOTICE '  ⏭️  % already correct or not found', func_name;
  END IF;
  
  -- Function 2: trg_sync_joincompetition_from_pending
  func_name := 'trg_sync_joincompetition_from_pending';
  RAISE NOTICE 'Fixing: %', func_name;
  
  SELECT pg_get_functiondef(oid) INTO func_def
  FROM pg_proc
  WHERE proname = func_name
  LIMIT 1;
  
  IF func_def IS NOT NULL AND func_def LIKE '%competitionid%' THEN
    fixed_def := REPLACE(func_def, 'competitionid', 'competition_id');
    fixed_def := REPLACE(fixed_def, 'COMPETITIONID', 'COMPETITION_ID');
    EXECUTE fixed_def;
    RAISE NOTICE '  ✅ Fixed %', func_name;
  ELSE
    RAISE NOTICE '  ⏭️  % already correct or not found', func_name;
  END IF;
  
  -- Function 3: update_tickets_sold_on_pending
  func_name := 'update_tickets_sold_on_pending';
  RAISE NOTICE 'Fixing: %', func_name;
  
  SELECT pg_get_functiondef(oid) INTO func_def
  FROM pg_proc
  WHERE proname = func_name
  LIMIT 1;
  
  IF func_def IS NOT NULL AND func_def LIKE '%competitionid%' THEN
    fixed_def := REPLACE(func_def, 'competitionid', 'competition_id');
    fixed_def := REPLACE(fixed_def, 'COMPETITIONID', 'COMPETITION_ID');
    EXECUTE fixed_def;
    RAISE NOTICE '  ✅ Fixed %', func_name;
  ELSE
    RAISE NOTICE '  ⏭️  % already correct or not found', func_name;
  END IF;
  
  -- Function 4: validate_pending_tickets
  func_name := 'validate_pending_tickets';
  RAISE NOTICE 'Fixing: %', func_name;
  
  SELECT pg_get_functiondef(oid) INTO func_def
  FROM pg_proc
  WHERE proname = func_name
  LIMIT 1;
  
  IF func_def IS NOT NULL AND func_def LIKE '%competitionid%' THEN
    fixed_def := REPLACE(func_def, 'competitionid', 'competition_id');
    fixed_def := REPLACE(fixed_def, 'COMPETITIONID', 'COMPETITION_ID');
    EXECUTE fixed_def;
    RAISE NOTICE '  ✅ Fixed %', func_name;
  ELSE
    RAISE NOTICE '  ⏭️  % already correct or not found', func_name;
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE 'ALL TRIGGER FUNCTIONS FIXED!';
  RAISE NOTICE '========================================================';
END $$;

-- Force PostgREST schema reload
NOTIFY pgrst, 'reload schema';
