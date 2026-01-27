/*
  # Create Join Competition Table

  ## Overview
  This migration creates the joincompetition table which tracks user entries
  into competitions. This table is used by payment webhooks to record ticket
  purchases and by the competition lifecycle to determine winners.

  ## Tables Created

  ### joincompetition
  - `uid` (text, primary key) - Unique entry identifier
  - `competitionid` (text) - Competition UID (references competitions.uid)
  - `userid` (text) - User identifier
  - `walletaddress` (text) - User's wallet address
  - `numberoftickets` (integer) - Number of tickets purchased
  - `ticketnumbers` (text) - Comma-separated list of ticket numbers
  - `amountspent` (numeric) - Total amount spent on tickets
  - `chain` (text) - Blockchain/currency used
  - `transactionhash` (text) - Transaction hash for verification
  - `purchasedate` (timestamptz) - Purchase timestamp
  - `buytime` (timestamptz) - Alternative purchase timestamp
  - `created_at` (timestamptz) - Record creation timestamp

  ## Security
  - Enable RLS on joincompetition table
  - Allow users to read their own entries
  - Allow public read access (for activity feed)
  - Allow authenticated users to insert entries

  ## Indexes
  - Index on competitionid for fast competition lookups
  - Index on userid for user entry lookups
  - Index on walletaddress for wallet-based queries
*/

-- Create joincompetition table
CREATE TABLE IF NOT EXISTS joincompetition (
  uid text PRIMARY KEY,
  competitionid text NOT NULL,
  userid text NOT NULL,
  wallet_address text,
  numberoftickets integer NOT NULL DEFAULT 1,
  ticketnumbers text,
  amountspent numeric(10, 2) NOT NULL DEFAULT 0,
  chain text,
  transactionhash text,
  purchasedate timestamptz DEFAULT now(),
  buytime timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE joincompetition ENABLE ROW LEVEL SECURITY;

-- Users can read their own entries
CREATE POLICY "Users can read own entries"
  ON joincompetition
  FOR SELECT
  TO authenticated
  USING (userid = current_setting('request.jwt.claims', true)::json->>'sub');

-- Allow public read access for activity feed
CREATE POLICY "Public can view all entries"
  ON joincompetition
  FOR SELECT
  TO public
  USING (true);

-- Allow authenticated users to insert entries
CREATE POLICY "Authenticated users can insert entries"
  ON joincompetition
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Service role can manage everything (for webhooks)
CREATE POLICY "Service role can manage all entries"
  ON joincompetition
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_joincompetition_competitionid
  ON joincompetition(competitionid);

CREATE INDEX IF NOT EXISTS idx_joincompetition_userid
  ON joincompetition(userid);

CREATE INDEX IF NOT EXISTS idx_joincompetition_wallet_address
  ON joincompetition(wallet_address);

CREATE INDEX IF NOT EXISTS idx_joincompetition_transactionhash
  ON joincompetition(transactionhash);

CREATE INDEX IF NOT EXISTS idx_joincompetition_purchasedate
  ON joincompetition(purchasedate DESC);
