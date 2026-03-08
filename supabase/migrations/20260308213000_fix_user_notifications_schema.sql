-- Fix user_notifications table schema
-- This migration adds missing columns that the notification service expects

-- Add missing columns to user_notifications table
-- Use ALTER TABLE ... ADD COLUMN IF NOT EXISTS to be idempotent

DO $$
BEGIN
    -- Add 'type' column (required)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_notifications' AND column_name = 'type') THEN
        ALTER TABLE public.user_notifications ADD COLUMN type TEXT NOT NULL DEFAULT 'announcement';
    END IF;

    -- Add 'title' column (required)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_notifications' AND column_name = 'title') THEN
        ALTER TABLE public.user_notifications ADD COLUMN title TEXT NOT NULL DEFAULT '';
    END IF;

    -- Add 'message' column (required)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_notifications' AND column_name = 'message') THEN
        ALTER TABLE public.user_notifications ADD COLUMN message TEXT NOT NULL DEFAULT '';
    END IF;

    -- Add 'competition_id' column (optional, for linking to competitions)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_notifications' AND column_name = 'competition_id') THEN
        ALTER TABLE public.user_notifications ADD COLUMN competition_id UUID;
    END IF;

    -- Add 'prize_info' column (optional, for win notifications)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_notifications' AND column_name = 'prize_info') THEN
        ALTER TABLE public.user_notifications ADD COLUMN prize_info TEXT;
    END IF;

    -- Add 'amount' column (optional, for payment/topup notifications)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_notifications' AND column_name = 'amount') THEN
        ALTER TABLE public.user_notifications ADD COLUMN amount NUMERIC;
    END IF;

    -- Add 'expires_at' column (optional, for time-limited notifications)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_notifications' AND column_name = 'expires_at') THEN
        ALTER TABLE public.user_notifications ADD COLUMN expires_at TIMESTAMPTZ;
    END IF;

    -- Add 'read' column (required for tracking read status)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_notifications' AND column_name = 'read') THEN
        ALTER TABLE public.user_notifications ADD COLUMN read BOOLEAN NOT NULL DEFAULT FALSE;
    END IF;

    -- Add 'created_at' column (required for ordering)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_notifications' AND column_name = 'created_at') THEN
        ALTER TABLE public.user_notifications ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    END IF;

    -- Add 'user_id' column (required for ownership - stores canonical_users.id)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_notifications' AND column_name = 'user_id') THEN
        ALTER TABLE public.user_notifications ADD COLUMN user_id TEXT NOT NULL DEFAULT '';
    END IF;
END $$;

-- Create index on user_id for fast lookups
CREATE INDEX IF NOT EXISTS idx_user_notifications_user_id ON public.user_notifications(user_id);

-- Create index on created_at for ordering
CREATE INDEX IF NOT EXISTS idx_user_notifications_created_at ON public.user_notifications(created_at DESC);

-- Create index on read status for counting unread
CREATE INDEX IF NOT EXISTS idx_user_notifications_read ON public.user_notifications(user_id, read) WHERE read = FALSE;

-- Add check constraint for valid notification types
DO $$
BEGIN
    ALTER TABLE public.user_notifications DROP CONSTRAINT IF EXISTS user_notifications_type_check;
    ALTER TABLE public.user_notifications ADD CONSTRAINT user_notifications_type_check
        CHECK (type IN ('win', 'competition_ended', 'special_offer', 'announcement', 'payment', 'topup', 'entry'));
EXCEPTION WHEN duplicate_object THEN
    -- Constraint already exists, ignore
END $$;

-- Grant permissions: service_role needs full access, authenticated users need SELECT only
GRANT ALL ON public.user_notifications TO service_role;
GRANT SELECT ON public.user_notifications TO authenticated;
GRANT SELECT ON public.user_notifications TO anon;

COMMENT ON TABLE public.user_notifications IS 'User in-app notifications - mirrors email notifications for in-app display';
COMMENT ON COLUMN public.user_notifications.type IS 'Notification type: win, competition_ended, special_offer, announcement, payment, topup, entry';
COMMENT ON COLUMN public.user_notifications.user_id IS 'References canonical_users.id (UUID stored as text)';
