-- ============================================================================
-- CHECK REALTIME STATUS ON LANDING PAGE TABLES
-- ============================================================================
-- Run this in Supabase Dashboard > SQL Editor
-- ============================================================================

-- First, just check what's currently enabled:
SELECT 'Tables currently in supabase_realtime publication:' as info;
SELECT schemaname, tablename 
FROM pg_publication_tables 
WHERE pubname = 'supabase_realtime' 
ORDER BY tablename;

-- Check if our required tables are there:
SELECT 
  t.table_name,
  CASE WHEN p.tablename IS NOT NULL THEN '✅ ENABLED' ELSE '❌ NOT ENABLED' END as realtime_status
FROM (
  VALUES ('joincompetition'), ('winners'), ('competition_entries'), ('competitions')
) AS t(table_name)
LEFT JOIN pg_publication_tables p 
  ON p.tablename = t.table_name AND p.pubname = 'supabase_realtime';

-- ============================================================================
-- If any table shows NOT ENABLED, run the appropriate line below:
-- (Comment out lines for tables already enabled to avoid errors)
-- ============================================================================

-- ALTER PUBLICATION supabase_realtime ADD TABLE public.joincompetition;
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.winners;
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.competition_entries;
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.competitions;

-- Set REPLICA IDENTITY FULL (safe to run even if already set):
ALTER TABLE public.joincompetition REPLICA IDENTITY FULL;
ALTER TABLE public.winners REPLICA IDENTITY FULL;

-- ============================================================================
-- If realtime IS enabled but still not working, the issue is likely:
-- 1. RLS policies blocking the subscription
-- 2. The client not subscribing to the right table/events
-- 3. Network/connection issues with the realtime websocket
-- ============================================================================
