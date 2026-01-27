-- Ensure the get_user_wallet_balance function exists and works correctly
-- This function retrieves user balance from privy_user_connections table

-- Drop existing function if it exists to recreate with proper permissions
DROP FUNCTION IF EXISTS get_user_wallet_balance(TEXT);

-- Recreate the function with proper error handling
CREATE OR REPLACE FUNCTION get_user_wallet_balance(user_identifier TEXT)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  balance NUMERIC;
BEGIN
  -- Handle null or empty identifier
  IF user_identifier IS NULL OR user_identifier = '' THEN
    RETURN 0;
  END IF;

  -- Get balance from privy_user_connections
  SELECT COALESCE(usdc_balance, 0) INTO balance
  FROM privy_user_connections
  WHERE privy_did = user_identifier
     OR wallet_address = user_identifier
     OR email = user_identifier
  LIMIT 1;

  -- Return 0 if user not found
  RETURN COALESCE(balance, 0);
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_user_wallet_balance(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_wallet_balance(TEXT) TO anon;

-- Ensure usdc_balance column exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'privy_user_connections' 
    AND column_name = 'usdc_balance'
  ) THEN
    ALTER TABLE privy_user_connections 
    ADD COLUMN usdc_balance NUMERIC(10, 2) DEFAULT 0 NOT NULL;
  END IF;
END $$;

-- Create index if it doesn't exist
CREATE INDEX IF NOT EXISTS idx_privy_user_connections_usdc_balance 
ON privy_user_connections(usdc_balance);

-- Also ensure get_user_active_tickets function exists
DROP FUNCTION IF EXISTS get_user_active_tickets(TEXT);

CREATE OR REPLACE FUNCTION get_user_active_tickets(user_identifier TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ticket_count INTEGER;
BEGIN
  -- Handle null or empty identifier
  IF user_identifier IS NULL OR user_identifier = '' THEN
    RETURN 0;
  END IF;

  -- Count tickets in active competitions
  SELECT COALESCE(SUM(numberoftickets), 0)::INTEGER INTO ticket_count
  FROM joincompetition jc
  INNER JOIN competitions c ON jc.competitionid = c.uid
  WHERE (jc.userid = user_identifier OR jc.wallet_address = user_identifier)
    AND c.enddate > NOW()
    AND c.is_active = TRUE;

  RETURN COALESCE(ticket_count, 0);
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_user_active_tickets(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_active_tickets(TEXT) TO anon;
