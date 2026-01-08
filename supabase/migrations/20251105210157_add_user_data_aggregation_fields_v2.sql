/*
  # Add User Data Aggregation Fields and Functions

  ## Overview
  This migration adds fields and functions necessary for user data aggregation
  including avatar selection, ticket counting, and wallet balance calculations.

  ## Changes Made
  
  1. New Fields
    - Add `avatar_url` to privy_user_connections table for persistent avatar selection
    - Add `email` to privy_user_connections for better user identification
    - Add `username` to privy_user_connections for display purposes
    - Add `telegram_handle` to privy_user_connections for contact info
    - Add `uid` to privy_user_connections as primary identifier
    
  2. Database Functions
    - `get_user_ticket_count`: Calculates total tickets owned by user across all competitions
    - `get_user_wallet_balance`: Calculates total USD value from all user transactions
    - `get_user_active_tickets`: Returns count of tickets in active competitions only
    
  3. Indexes
    - Index on privy_user_connections.privy_user_id for fast lookups
    - Index on joincompetition.userid for aggregation queries
    
  4. Security
    - Users can read and update their own avatar_url
    - Public read access maintained for activity feeds
*/

-- Add missing columns to privy_user_connections if they don't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'privy_user_connections' AND column_name = 'avatar_url'
  ) THEN
    ALTER TABLE privy_user_connections ADD COLUMN avatar_url text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'privy_user_connections' AND column_name = 'email'
  ) THEN
    ALTER TABLE privy_user_connections ADD COLUMN email text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'privy_user_connections' AND column_name = 'username'
  ) THEN
    ALTER TABLE privy_user_connections ADD COLUMN username text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'privy_user_connections' AND column_name = 'telegram_handle'
  ) THEN
    ALTER TABLE privy_user_connections ADD COLUMN telegram_handle text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'privy_user_connections' AND column_name = 'uid'
  ) THEN
    ALTER TABLE privy_user_connections ADD COLUMN uid text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'privy_user_connections' AND column_name = 'created_at'
  ) THEN
    ALTER TABLE privy_user_connections ADD COLUMN created_at timestamptz DEFAULT now();
  END IF;
END $$;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_privy_user_connections_privy_user_id 
  ON privy_user_connections(privy_user_id);

CREATE INDEX IF NOT EXISTS idx_privy_user_connections_uid 
  ON privy_user_connections(uid);

CREATE INDEX IF NOT EXISTS idx_joincompetition_userid 
  ON joincompetition(userid);

CREATE INDEX IF NOT EXISTS idx_joincompetition_walletaddress 
  ON joincompetition(walletaddress);

-- Function to get total ticket count for a user
CREATE OR REPLACE FUNCTION get_user_ticket_count(user_identifier text)
RETURNS integer AS $$
DECLARE
  ticket_count integer;
BEGIN
  SELECT COALESCE(SUM(numberoftickets), 0)::integer
  INTO ticket_count
  FROM joincompetition
  WHERE userid = user_identifier 
     OR walletaddress = user_identifier;
  
  RETURN ticket_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get user's total wallet balance (sum of all transactions)
CREATE OR REPLACE FUNCTION get_user_wallet_balance(user_identifier text)
RETURNS numeric AS $$
DECLARE
  balance numeric;
BEGIN
  SELECT COALESCE(SUM(amountspent), 0)
  INTO balance
  FROM joincompetition
  WHERE userid = user_identifier 
     OR walletaddress = user_identifier;
  
  RETURN balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get active competition ticket count for a user
CREATE OR REPLACE FUNCTION get_user_active_tickets(user_identifier text)
RETURNS integer AS $$
DECLARE
  ticket_count integer;
BEGIN
  SELECT COALESCE(SUM(jc.numberoftickets), 0)::integer
  INTO ticket_count
  FROM joincompetition jc
  INNER JOIN competitions c ON jc.competitionid = c.uid
  WHERE (jc.userid = user_identifier OR jc.walletaddress = user_identifier)
    AND c.competitionended = 0;
  
  RETURN ticket_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update RLS policies to allow users to update their own avatar
DO $$
BEGIN
  DROP POLICY IF EXISTS "Users can update own avatar" ON privy_user_connections;
END $$;

DROP POLICY IF EXISTS "Users can update own avatar" ON privy_user_connections;
CREATE POLICY "Users can update own avatar"
  ON privy_user_connections
  FOR UPDATE
  TO authenticated
  USING (privy_user_id = (SELECT auth.uid()::text) OR uid = (SELECT auth.uid()::text))
  WITH CHECK (privy_user_id = (SELECT auth.uid()::text) OR uid = (SELECT auth.uid()::text));

-- Allow users to read their own data
DO $$
BEGIN
  DROP POLICY IF EXISTS "Users can read own data" ON privy_user_connections;
END $$;

DROP POLICY IF EXISTS "Users can read own data" ON privy_user_connections;
CREATE POLICY "Users can read own data"
  ON privy_user_connections
  FOR SELECT
  TO authenticated
  USING (privy_user_id = (SELECT auth.uid()::text) OR uid = (SELECT auth.uid()::text));