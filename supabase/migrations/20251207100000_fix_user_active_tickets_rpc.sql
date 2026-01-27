/*
  # Fix get_user_active_tickets RPC Function

  ## Problem
  The get_user_active_tickets function doesn't query by privy_user_id,
  which is the identifier used when creating entries via the purchase-tickets-with-bonus
  edge function. This causes the dashboard to not reflect recent ticket purchases.

  ## Solution
  Update the function to query by:
  - privy_user_id (Privy DID format: did:privy:xxx)
  - userid
  - walletaddress

  Also fix the JOIN to work with both new (id) and legacy (uid) competition identifiers.
*/

-- Drop existing function to recreate
DROP FUNCTION IF EXISTS get_user_active_tickets(TEXT);

-- Recreate with Privy user ID support
CREATE OR REPLACE FUNCTION get_user_active_tickets(user_identifier TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  ticket_count INTEGER;
BEGIN
  -- Handle null or empty identifier
  IF user_identifier IS NULL OR user_identifier = '' THEN
    RETURN 0;
  END IF;

  -- Count tickets in active (live) competitions
  -- Query by privy_user_id, userid, or walletaddress
  -- JOIN on both c.id and c.uid to support new and legacy competition entries
  SELECT COALESCE(SUM(jc.numberoftickets), 0)::INTEGER INTO ticket_count
  FROM joincompetition jc
  INNER JOIN competitions c ON (
    jc.competitionid::text = c.id::text
    OR jc.competitionid::text = c.uid::text
  )
  WHERE (
    jc.privy_user_id = user_identifier
    OR jc.userid = user_identifier
    OR jc.wallet_address = user_identifier
  )
  AND c.status = 'live';

  RETURN COALESCE(ticket_count, 0);
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_user_active_tickets(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_active_tickets(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_user_active_tickets(TEXT) TO service_role;

-- Add helpful comment
COMMENT ON FUNCTION get_user_active_tickets(TEXT) IS
'Returns count of active tickets for a user. Supports privy_user_id, userid, or wallet_address identifiers.';
