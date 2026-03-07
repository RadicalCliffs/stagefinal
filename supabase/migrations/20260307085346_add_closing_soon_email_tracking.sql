-- Add columns to track "closing soon" email notifications
-- This prevents sending duplicate emails to users

-- Add column to competitions table to track when we sent the closing soon email
ALTER TABLE public.competitions 
ADD COLUMN IF NOT EXISTS last_closing_soon_email_sent timestamp with time zone;

COMMENT ON COLUMN public.competitions.last_closing_soon_email_sent IS 
'Timestamp when the "competition closing soon" email was last sent for this competition';

-- Add column to canonical_users to track when they last received ANY closing soon notification
ALTER TABLE public.canonical_users 
ADD COLUMN IF NOT EXISTS last_closing_soon_notification timestamp with time zone;

COMMENT ON COLUMN public.canonical_users.last_closing_soon_notification IS 
'Timestamp when user last received a "competition closing soon" notification (prevents spam)';

-- Create index for efficient queries
CREATE INDEX IF NOT EXISTS idx_competitions_closing_soon 
ON public.competitions(end_date, status, last_closing_soon_email_sent) 
WHERE status = 'live';

COMMENT ON INDEX public.idx_competitions_closing_soon IS 
'Index for finding competitions closing soon that need notification emails';
