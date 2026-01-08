-- Migration: add_new_user_bonus_field
-- Created at: 1763846566

-- Add has_used_new_user_bonus field to track first purchase bonus
ALTER TABLE privy_user_connections 
ADD COLUMN IF NOT EXISTS has_used_new_user_bonus BOOLEAN DEFAULT FALSE;

-- Update existing users to FALSE (ensure all users start with bonus available)
UPDATE privy_user_connections 
SET has_used_new_user_bonus = FALSE 
WHERE has_used_new_user_bonus IS NULL;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_bonus_status 
ON privy_user_connections(privy_user_id, has_used_new_user_bonus) 
WHERE has_used_new_user_bonus = FALSE;;