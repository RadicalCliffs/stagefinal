-- Create privy_user_connections table
--
-- This migration creates the missing privy_user_connections table that is referenced
-- throughout the codebase but was never created in the initial schema.
--
-- 1. New Tables
--    - privy_user_connections
--      - id (uuid, primary key) - Database user ID
--      - privy_user_id (text) - Privy authentication ID
--      - wallet_address (text) - User's crypto wallet address
--      - email (text) - User's email
--      - username (text) - Display username
--      - telegram_handle (text) - Telegram contact
--      - avatar_url (text) - Profile avatar
--      - uid (text) - Alternative user identifier
--      - created_at (timestamptz) - Creation timestamp
--
-- 2. Security
--    - Enable RLS on privy_user_connections table
--    - Add policy for users to read their own data
--    - Add policy for users to update their own profile
--    - Add policy for public read access (needed for activity display)
--
-- 3. Indexes
--    - Index on privy_user_id for fast auth lookups
--    - Index on wallet_address for wallet-based lookups
--    - Index on email for email-based lookups
--    - Index on uid for UID-based lookups

-- Create privy_user_connections table
CREATE TABLE IF NOT EXISTS privy_user_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  privy_user_id text UNIQUE,
  wallet_address text,
  email text,
  username text,
  telegram_handle text,
  avatar_url text,
  uid text,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE privy_user_connections ENABLE ROW LEVEL SECURITY;

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_privy_user_connections_privy_user_id 
  ON privy_user_connections(privy_user_id);

CREATE INDEX IF NOT EXISTS idx_privy_user_connections_wallet_address 
  ON privy_user_connections(wallet_address);

CREATE INDEX IF NOT EXISTS idx_privy_user_connections_email 
  ON privy_user_connections(email);

CREATE INDEX IF NOT EXISTS idx_privy_user_connections_uid 
  ON privy_user_connections(uid);

-- RLS Policies (drop if exists, then create)
-- Allow users to read their own data
DROP POLICY IF EXISTS "Users can read own data" ON privy_user_connections;
CREATE POLICY "Users can read own data"
  ON privy_user_connections
  FOR SELECT
  TO authenticated
  USING (privy_user_id = current_setting('request.jwt.claims', true)::json->>'sub');

-- Allow users to insert their own data
DROP POLICY IF EXISTS "Users can insert own data" ON privy_user_connections;
CREATE POLICY "Users can insert own data"
  ON privy_user_connections
  FOR INSERT
  TO authenticated
  WITH CHECK (privy_user_id = current_setting('request.jwt.claims', true)::json->>'sub');

-- Allow users to update their own profile
DROP POLICY IF EXISTS "Users can update own data" ON privy_user_connections;
CREATE POLICY "Users can update own data"
  ON privy_user_connections
  FOR UPDATE
  TO authenticated
  USING (privy_user_id = current_setting('request.jwt.claims', true)::json->>'sub')
  WITH CHECK (privy_user_id = current_setting('request.jwt.claims', true)::json->>'sub');

-- Allow public read access (needed for displaying user activity)
DROP POLICY IF EXISTS "Allow public read access to privy_user_connections" ON privy_user_connections;
CREATE POLICY "Allow public read access to privy_user_connections"
  ON privy_user_connections
  FOR SELECT
  TO anon
  USING (true);