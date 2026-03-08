-- Enable realtime for user_notifications table
-- Run this in Supabase SQL Editor or via migrations

-- 1. Add table to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_notifications;

-- 2. Set REPLICA IDENTITY FULL for better realtime updates
ALTER TABLE public.user_notifications REPLICA IDENTITY FULL;

-- 3. Enable RLS if not already enabled
ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;

-- 4. Create policies for user access (users can only see their own notifications)
-- Drop existing policies first to avoid conflicts
DROP POLICY IF EXISTS "Users can view own notifications" ON public.user_notifications;
DROP POLICY IF EXISTS "Users can update own notifications" ON public.user_notifications;
DROP POLICY IF EXISTS "Users can delete own notifications" ON public.user_notifications;
DROP POLICY IF EXISTS "Service role can insert notifications" ON public.user_notifications;

-- Policy: Users can view their own notifications
CREATE POLICY "Users can view own notifications"
ON public.user_notifications
FOR SELECT
USING (
  user_id = auth.uid()::text
  OR user_id = (SELECT id::text FROM public.canonical_users WHERE auth.uid()::text = id::text LIMIT 1)
);

-- Policy: Users can update their own notifications (mark as read)
CREATE POLICY "Users can update own notifications"
ON public.user_notifications
FOR UPDATE
USING (
  user_id = auth.uid()::text
  OR user_id = (SELECT id::text FROM public.canonical_users WHERE auth.uid()::text = id::text LIMIT 1)
);

-- Policy: Users can delete their own notifications
CREATE POLICY "Users can delete own notifications"
ON public.user_notifications
FOR DELETE
USING (
  user_id = auth.uid()::text
  OR user_id = (SELECT id::text FROM public.canonical_users WHERE auth.uid()::text = id::text LIMIT 1)
);

-- Policy: Service role can insert notifications (for admin/system use)
CREATE POLICY "Service role can insert notifications"
ON public.user_notifications
FOR INSERT
WITH CHECK (true); -- Service role bypasses RLS anyway, but this makes it explicit

-- 5. Grant necessary permissions
GRANT SELECT, UPDATE, DELETE ON public.user_notifications TO authenticated;
GRANT ALL ON public.user_notifications TO service_role;
