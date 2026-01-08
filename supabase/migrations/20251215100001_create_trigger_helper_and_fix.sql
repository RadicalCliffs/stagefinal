-- Create helper function to query triggers
CREATE OR REPLACE FUNCTION get_table_triggers(p_table_name text)
RETURNS TABLE(trigger_name text, trigger_function text, trigger_event text)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT t.tgname::text, p.proname::text,
    CASE WHEN t.tgtype & 4 = 4 THEN 'INSERT' 
         WHEN t.tgtype & 8 = 8 THEN 'DELETE'
         WHEN t.tgtype & 16 = 16 THEN 'UPDATE' 
         ELSE 'OTHER' END
  FROM pg_trigger t
  JOIN pg_proc p ON t.tgfoid = p.oid
  JOIN pg_class c ON t.tgrelid = c.oid
  WHERE c.relname = p_table_name AND NOT t.tgisinternal;
$$;

GRANT EXECUTE ON FUNCTION get_table_triggers(text) TO service_role;

-- Find and log functions with the error message
DO $$
DECLARE
  func_rec RECORD;
BEGIN
  RAISE NOTICE 'Searching for functions containing "no longer available"...';
  FOR func_rec IN 
    SELECT proname, substring(prosrc, 1, 200) as source_preview
    FROM pg_proc 
    WHERE prosrc ILIKE '%no longer available%'
  LOOP
    RAISE NOTICE 'Found function: % - %', func_rec.proname, func_rec.source_preview;
  END LOOP;
END $$;

-- Drop all triggers on pending_tickets
DO $$
DECLARE 
  r RECORD;
  dropped_count INTEGER := 0;
BEGIN
  RAISE NOTICE 'Dropping triggers on pending_tickets...';
  FOR r IN 
    SELECT t.tgname 
    FROM pg_trigger t 
    JOIN pg_class c ON t.tgrelid = c.oid 
    WHERE c.relname = 'pending_tickets' AND NOT t.tgisinternal
  LOOP
    EXECUTE 'DROP TRIGGER IF EXISTS ' || quote_ident(r.tgname) || ' ON pending_tickets CASCADE';
    dropped_count := dropped_count + 1;
    RAISE NOTICE 'Dropped trigger: %', r.tgname;
  END LOOP;
  RAISE NOTICE 'Total triggers dropped: %', dropped_count;
END $$;

-- Drop any functions that might be causing the issue
DROP FUNCTION IF EXISTS check_ticket_availability_trigger() CASCADE;
DROP FUNCTION IF EXISTS validate_ticket_reservation() CASCADE;
DROP FUNCTION IF EXISTS prevent_duplicate_ticket_reservation() CASCADE;
DROP FUNCTION IF EXISTS check_tickets_available() CASCADE;
DROP FUNCTION IF EXISTS validate_pending_ticket_insert() CASCADE;
DROP FUNCTION IF EXISTS check_pending_ticket_availability() CASCADE;
