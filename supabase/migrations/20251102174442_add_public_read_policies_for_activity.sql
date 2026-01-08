/*
  # Add Public Read Access for Activity Feed

  1. Changes
    - Add policy to allow public (anon) users to read joincompetition entries
    - Add policy to allow public (anon) users to read privy_user_connections
    - These policies are needed for the live activity feed on the landing page
  
  2. Security
    - Only SELECT operations are allowed
    - Restricted to anon role (unauthenticated users)
    - No write access is granted
*/

-- Drop existing policies if they exist
DO $$ 
BEGIN
  DROP POLICY IF EXISTS "Allow public read access to joincompetition" ON joincompetition;
  DROP POLICY IF EXISTS "Allow public read access to privy_user_connections" ON privy_user_connections;
END $$;

-- Allow anonymous users to view competition entries for activity feed
DROP POLICY IF EXISTS "Allow public read access to joincompetition" ON joincompetition;
CREATE POLICY "Allow public read access to joincompetition"
  ON joincompetition
  FOR SELECT
  TO anon
  USING (true);

-- Allow anonymous users to view user connection info for activity feed
DROP POLICY IF EXISTS "Allow public read access to privy_user_connections" ON privy_user_connections;
CREATE POLICY "Allow public read access to privy_user_connections"
  ON privy_user_connections
  FOR SELECT
  TO anon
  USING (true);
