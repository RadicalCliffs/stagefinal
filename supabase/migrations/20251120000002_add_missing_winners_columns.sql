/*
  # Add Missing Columns to Winners Table

  ## Overview
  This migration adds missing columns to the winners table that are required
  by the competition lifecycle and winner display logic.

  ## Changes
  - Add ticket_number column (integer) for the winning ticket number
  - Add prize_value column (numeric) for the prize value
  - Add prize_claimed column (boolean) for tracking prize claim status
  - Add username column (text) for display purposes
  - Add country column (text) for user location
  - Add wallet_address column (text) for winner's wallet
  - Add crdate column (timestamptz) for compatibility with legacy code
*/

-- Add missing columns to winners table
ALTER TABLE winners
ADD COLUMN IF NOT EXISTS ticket_number integer,
ADD COLUMN IF NOT EXISTS prize_value numeric(10, 2),
ADD COLUMN IF NOT EXISTS prize_claimed boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS username text,
ADD COLUMN IF NOT EXISTS country text,
ADD COLUMN IF NOT EXISTS wallet_address text,
ADD COLUMN IF NOT EXISTS crdate timestamptz DEFAULT now();

-- Add indexes for common queries
CREATE INDEX IF NOT EXISTS idx_winners_competition_id
  ON winners(competition_id);

CREATE INDEX IF NOT EXISTS idx_winners_user_id
  ON winners(user_id);

CREATE INDEX IF NOT EXISTS idx_winners_wallet_address
  ON winners(wallet_address);

-- Add a policy to allow public read access to winners for display
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'winners'
    AND policyname = 'Public can view winners'
  ) THEN
    CREATE POLICY "Public can view winners"
      ON winners
      FOR SELECT
      TO public
      USING (true);
  END IF;
END $$;
