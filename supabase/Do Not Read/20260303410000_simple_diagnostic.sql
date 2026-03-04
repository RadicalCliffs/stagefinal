-- ============================================================================
-- SIMPLE DIAGNOSTIC: Check if specific functions contain "competitionid"
-- ============================================================================

DO $$
DECLARE
  func_def TEXT;
BEGIN
  RAISE NOTICE '========================================================';
  RAISE NOTICE 'CHECKING allocate_lucky_dip_tickets_batch';
  
  SELECT pg_get_functiondef(oid) INTO func_def
  FROM pg_proc
  WHERE proname = 'allocate_lucky_dip_tickets_batch'
  LIMIT 1;
  
  IF func_def LIKE '%jc.competitionid%' THEN
    RAISE NOTICE ' ❌ CONTAINS jc.competitionid';
  ELSIF func_def LIKE '%competition_id%' THEN
    RAISE NOTICE '✅ Uses competition_id (looks correct)';
  ELSE
    RAISE NOTICE '⚠️  No competition column references found';
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE 'CHECKING reserve_lucky_dip';
  
  SELECT pg_get_functiondef(oid) INTO func_def
  FROM pg_proc
  WHERE proname = 'reserve_lucky_dip'
  LIMIT 1;
  
  IF func_def LIKE '%jc.competitionid%' THEN
    RAISE NOTICE '❌ CONTAINS jc.competitionid';
  ELSIF func_def LIKE '%competition_id%' THEN
    RAISE NOTICE '✅ Uses competition_id (looks correct)';
  ELSE
    RAISE NOTICE '⚠️  No competition column references found';
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE 'CHECKING get_competition_entries_bypass_rls';
  
  SELECT pg_get_functiondef(oid) INTO func_def
  FROM pg_proc
  WHERE proname = 'get_competition_entries_bypass_rls'
  LIMIT 1;
  
  IF func_def LIKE '%jc.competitionid%' THEN
    RAISE NOTICE '❌ CONTAINS jc.competitionid';
  ELSIF func_def LIKE '%competition_id%' THEN
    RAISE NOTICE '✅ Uses competition_id (looks correct)';
  ELSE
    RAISE NOTICE '⚠️  No competition column references found';
  END IF;
  
  RAISE NOTICE '========================================================';
END $$;
