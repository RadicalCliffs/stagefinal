-- Add country and telephone_number columns to privy_user_connections table
--
-- This migration adds optional profile fields for country and phone number
-- as requested to match the entry form fields when purchasing tickets.
--
-- 1. New Columns
--    - country (text) - User's country
--    - telephone_number (text) - User's phone number
--
-- Both fields are optional and can be set/updated by the user in their dashboard profile.

-- Add country column
ALTER TABLE privy_user_connections
ADD COLUMN IF NOT EXISTS country text;

-- Add telephone_number column
ALTER TABLE privy_user_connections
ADD COLUMN IF NOT EXISTS telephone_number text;

-- Add index on country for potential geographic queries
CREATE INDEX IF NOT EXISTS idx_privy_user_connections_country
  ON privy_user_connections(country);

COMMENT ON COLUMN privy_user_connections.country IS 'User''s country, auto-populated via IP or set manually';
COMMENT ON COLUMN privy_user_connections.telephone_number IS 'User''s phone number (optional)';
