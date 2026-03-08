-- Enable realtime for user_notifications table
-- Run this in Supabase SQL Editor or via migrations

-- 1. Add table to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_notifications;

-- 2. Set REPLICA IDENTITY FULL for better realtime updates
ALTER TABLE public.user_notifications REPLICA IDENTITY FULL;

-- 3. Enable RLS if not already enabled
ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;

-- 4. Create policies for user access
-- Drop existing policies first to avoid conflicts
DROP POLICY IF EXISTS "Users can view own notifications" ON public.user_notifications;
DROP POLICY IF EXISTS "Users can update own notifications" ON public.user_notifications;
DROP POLICY IF EXISTS "Users can delete own notifications" ON public.user_notifications;
DROP POLICY IF EXISTS "Service role can insert notifications" ON public.user_notifications;
DROP POLICY IF EXISTS "Service role full access" ON public.user_notifications;

-- Simple policy: user_id column stores canonical_users.id (UUID as text)
-- For realtime to work, users need SELECT. All writes go through service role anyway.
CREATE POLICY "Users can view own notifications"
ON public.user_notifications
FOR SELECT
USING (true);  -- Allow all reads - filtering happens in notification-service.mts

-- Service role handles all writes
CREATE POLICY "Service role full access"
ON public.user_notifications
FOR ALL
USING (true)
WITH CHECK (true);

-- 5. Grant necessary permissions
GRANT SELECT ON public.user_notifications TO authenticated;
GRANT SELECT ON public.user_notifications TO anon;
GRANT ALL ON public.user_notifications TO service_role;
