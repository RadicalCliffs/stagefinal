-- ============================================================================
-- CHECK: Find triggers that might reference competitionid
-- ============================================================================

DO $$
DECLARE
  trigger_rec RECORD;
  trigger_def TEXT;
  func_def TEXT;
BEGIN
  RAISE NOTICE '========================================================';
  RAISE NOTICE 'CHECKING TRIGGERS ON RELEVANT TABLES';
  RAISE NOTICE '========================================================';
  
  -- Check triggers on joincompetition, pending_tickets, tickets, competitions
  FOR trigger_rec IN 
    SELECT 
      t.tgname as trigger_name,
      c.relname as table_name,
      p.proname as function_name,
      p.oid as function_oid
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    LEFT JOIN pg_proc p ON t.tgfoid = p.oid
    WHERE n.nspname = 'public'
      AND c.relname IN ('joincompetition', 'pending_tickets', 'tickets', 'competitions')
      AND NOT t.tgisinternal
  LOOP
    RAISE NOTICE '';
    RAISE NOTICE 'Trigger: % on table %', trigger_rec.trigger_name, trigger_rec.table_name;
    RAISE NOTICE '  Function: %', trigger_rec.function_name;
    
    IF trigger_rec.function_oid IS NOT NULL THEN
      SELECT pg_get_functiondef(trigger_rec.function_oid) INTO func_def;
      
      IF func_def LIKE '%competitionid%' THEN
        RAISE NOTICE '  â Œ TRIGGER FUNCTION CONTAINS "competitionid"';
      ELSE
        RAISE NOTICE '  â Checkmark No competitionid reference found';
      END IF;
    END IF;
  END LOOP;
  
  RAISE NOTICE '';
  RAISE NOTICE '========================================================';
END $$;
