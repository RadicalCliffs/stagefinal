-- ============================================================================
-- ENABLE REALTIME ON LANDING PAGE TABLES
-- ============================================================================
-- Run this in Supabase Dashboard > SQL Editor
-- This enables realtime subscriptions for the live entries and winners sections
-- ============================================================================

-- 1. Add tables to the realtime publication
-- The supabase_realtime publication is what powers postgres_changes subscriptions

ALTER PUBLICATION supabase_realtime ADD TABLE public.joincompetition;
ALTER PUBLICATION supabase_realtime ADD TABLE public.winners;
ALTER PUBLICATION supabase_realtime ADD TABLE public.competition_entries;
ALTER PUBLICATION supabase_realtime ADD TABLE public.competitions;

-- 2. Set REPLICA IDENTITY FULL for better update tracking
-- This ensures UPDATE events include both old and new values

ALTER TABLE public.joincompetition REPLICA IDENTITY FULL;
ALTER TABLE public.winners REPLICA IDENTITY FULL;
ALTER TABLE public.competition_entries REPLICA IDENTITY FULL;
ALTER TABLE public.competitions REPLICA IDENTITY FULL;

-- 3. Verify the configuration
SELECT 'Tables in supabase_realtime publication:' as info;
SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' ORDER BY tablename;

-- ============================================================================
-- IMPORTANT: After running this, you may need to:
-- 1. Go to Database > Replication in Supabase Dashboard
-- 2. Verify the tables show as enabled
-- 3. Your app's realtime subscriptions should now receive updates
-- ============================================================================
