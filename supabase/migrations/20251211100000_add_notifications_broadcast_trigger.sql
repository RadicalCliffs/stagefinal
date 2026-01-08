-- Migration: Add realtime broadcast trigger for notifications
-- This enables per-user realtime notifications via Supabase broadcast
-- Topic: user:{user_id}:notifications
-- Event: notification_created

-- Create the trigger function that broadcasts to the user's private channel
CREATE OR REPLACE FUNCTION public.broadcast_notification_to_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  topic_name TEXT;
  payload JSONB;
BEGIN
  -- Build the topic name for per-user notification channel
  topic_name := 'user:' || NEW.user_id || ':notifications';

  -- Build the payload with essential notification data
  payload := jsonb_build_object(
    'event', 'notification_created',
    'table', 'notifications',
    'schema', 'public',
    'new', jsonb_build_object(
      'id', NEW.id,
      'user_id', NEW.user_id,
      'type', NEW.type,
      'title', NEW.title,
      'message', NEW.message,
      'data', NEW.data,
      'read', NEW.read,
      'created_at', NEW.created_at
    ),
    'old', NULL
  );

  -- Use Supabase realtime broadcast (if available)
  -- This will fail silently if realtime is not configured
  BEGIN
    PERFORM pg_notify('realtime:broadcast', jsonb_build_object(
      'topic', topic_name,
      'event', 'notification_created',
      'payload', payload,
      'private', TRUE
    )::text);
  EXCEPTION WHEN OTHERS THEN
    -- Log but don't fail if broadcast is not available
    RAISE NOTICE 'Could not broadcast notification: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

-- Create trigger on notifications table for INSERT events
DROP TRIGGER IF EXISTS trigger_broadcast_notification ON public.notifications;

CREATE TRIGGER trigger_broadcast_notification
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.broadcast_notification_to_user();

-- Also create a trigger function for wallet/balance updates
CREATE OR REPLACE FUNCTION public.broadcast_balance_update_to_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  topic_name TEXT;
  payload JSONB;
BEGIN
  -- Build the topic name for per-user wallet channel
  topic_name := 'user:' || NEW.privy_user_id || ':wallet';

  -- Build the payload with balance data
  payload := jsonb_build_object(
    'event', 'balance_updated',
    'table', 'privy_user_connections',
    'schema', 'public',
    'new', jsonb_build_object(
      'privy_user_id', NEW.privy_user_id,
      'usdc_balance', NEW.usdc_balance,
      'bonus_balance', NEW.bonus_balance,
      'updated_at', NEW.updated_at
    ),
    'old', CASE
      WHEN TG_OP = 'UPDATE' THEN jsonb_build_object(
        'privy_user_id', OLD.privy_user_id,
        'usdc_balance', OLD.usdc_balance,
        'bonus_balance', OLD.bonus_balance
      )
      ELSE NULL
    END
  );

  -- Broadcast the update
  BEGIN
    PERFORM pg_notify('realtime:broadcast', jsonb_build_object(
      'topic', topic_name,
      'event', 'balance_updated',
      'payload', payload,
      'private', TRUE
    )::text);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not broadcast balance update: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

-- Create trigger on privy_user_connections for balance changes (only if bonus_balance exists)
DROP TRIGGER IF EXISTS trigger_broadcast_balance_update ON public.privy_user_connections;

-- Add bonus_balance column if it doesn't exist
ALTER TABLE public.privy_user_connections ADD COLUMN IF NOT EXISTS bonus_balance NUMERIC DEFAULT 0;

CREATE TRIGGER trigger_broadcast_balance_update
  AFTER UPDATE OF usdc_balance ON public.privy_user_connections
  FOR EACH ROW
  WHEN (OLD.usdc_balance IS DISTINCT FROM NEW.usdc_balance)
  EXECUTE FUNCTION public.broadcast_balance_update_to_user();

-- Add a helper function to manually send notifications
CREATE OR REPLACE FUNCTION public.send_user_notification(
  p_user_id TEXT,
  p_type TEXT,
  p_title TEXT,
  p_message TEXT,
  p_data JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  notification_id UUID;
BEGIN
  INSERT INTO public.notifications (
    user_id,
    type,
    title,
    message,
    data,
    read,
    created_at
  ) VALUES (
    p_user_id,
    p_type,
    p_title,
    p_message,
    COALESCE(p_data, '{}'::jsonb),
    FALSE,
    NOW()
  )
  RETURNING id INTO notification_id;

  RETURN notification_id;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.send_user_notification(TEXT, TEXT, TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_user_notification(TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;

-- Ensure RLS is enabled on notifications table
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for notifications if they don't exist
DO $$
BEGIN
  -- Drop existing policies to avoid conflicts
  DROP POLICY IF EXISTS "Users can view their own notifications" ON public.notifications;
  DROP POLICY IF EXISTS "Users can update their own notifications" ON public.notifications;
  DROP POLICY IF EXISTS "Service role can manage all notifications" ON public.notifications;
END $$;

-- Users can view their own notifications
DROP POLICY IF EXISTS "Users can view their own notifications" ON public.notifications;
CREATE POLICY "Users can view their own notifications"
  ON public.notifications
  FOR SELECT
  TO authenticated
  USING (user_id = current_setting('request.jwt.claims', true)::json->>'privy_user_id'
         OR user_id = auth.uid()::text);

-- Users can update (mark as read) their own notifications
DROP POLICY IF EXISTS "Users can update their own notifications" ON public.notifications;
CREATE POLICY "Users can update their own notifications"
  ON public.notifications
  FOR UPDATE
  TO authenticated
  USING (user_id = current_setting('request.jwt.claims', true)::json->>'privy_user_id'
         OR user_id = auth.uid()::text);

-- Service role can manage all notifications
DROP POLICY IF EXISTS "Service role can manage all notifications" ON public.notifications;
CREATE POLICY "Service role can manage all notifications"
  ON public.notifications
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Add index for efficient user notification queries
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id_created_at ON public.notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id_read ON public.notifications(user_id, read);
