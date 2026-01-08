/*
  # Backfill uid column for existing users

  This migration ensures all existing users have their uid column populated.
  The uid should match the id for consistency.
*/

-- Update uid to match id for all users where uid is null
UPDATE privy_user_connections
SET uid = id::text
WHERE uid IS NULL OR uid = '';

-- Create a trigger to automatically set uid when a new user is created
CREATE OR REPLACE FUNCTION set_user_uid()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.uid IS NULL OR NEW.uid = '' THEN
    NEW.uid = NEW.id::text;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if it exists and recreate
DROP TRIGGER IF EXISTS trigger_set_user_uid ON privy_user_connections;

CREATE TRIGGER trigger_set_user_uid
BEFORE INSERT ON privy_user_connections
FOR EACH ROW
EXECUTE FUNCTION set_user_uid();
