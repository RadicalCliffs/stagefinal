/*
  # Prioritize privy_user_id in Dashboard RPC Function

  ## Context
  The Privy user ID (did:privy:xxx) is the PRIMARY identifier for users since
  it's how they login via Privy/Base. This migration updates the RPC function
  to prioritize privy_user_id matching over other identifiers.

  ## Changes
  - Updates get_user_dashboard_entries to check privy_user_id FIRST
  - Still supports userid and walletaddress as fallbacks for legacy data
  - Adds explicit comment documenting privy_user_id as primary identifier
*/

-- Drop existing function to recreate with prioritized matching
DROP FUNCTION IF EXISTS get_user_dashboard_entries(text);

-- Recreate get_user_dashboard_entries with privy_user_id prioritized
CREATE OR REPLACE FUNCTION get_user_dashboard_entries(user_identifier text)
RETURNS TABLE (
  uid text,
  id text,
  competitionid text,
  userid text,
  privy_user_id text,
  numberoftickets integer,
  ticketnumbers text,
  amountspent numeric,
  wallet_address text,
  chain text,
  transactionhash text,
  purchasedate timestamp with time zone,
  created_at timestamp with time zone,
  competition_title text,
  competition_description text,
  competition_image text,
  competition_status text,
  winner_address text,
  prize_value numeric,
  is_instant_win boolean,
  competition_end_date timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    jc.uid::text as uid,
    COALESCE(jc.uid, jc.id::text)::text as id,
    jc.competitionid::text as competitionid,
    jc.userid::text as userid,
    jc.privy_user_id::text as privy_user_id,
    jc.numberoftickets,
    jc.ticketnumbers,
    jc.amountspent,
    jc.wallet_address::text as wallet_address,
    jc.chain::text as chain,
    jc.transactionhash::text as transactionhash,
    jc.purchasedate::timestamptz as purchasedate,
    jc.created_at::timestamptz as created_at,
    COALESCE(c.title, c.competitionname, 'Unknown Competition')::text as competition_title,
    COALESCE(c.description, c.competitioninformation, '')::text as competition_description,
    COALESCE(c.image_url, c.imageurl)::text as competition_image,
    COALESCE(c.status, 'active')::text as competition_status,
    c.winner_address::text as winner_address,
    c.prize_value as prize_value,
    COALESCE(c.is_instant_win, false) as is_instant_win,
    COALESCE(c.end_date, c.competitionenddate)::timestamptz as competition_end_date
  FROM joincompetition jc
  -- Join on BOTH id and uid to support entries that reference either field
  LEFT JOIN competitions c ON (
    jc.competitionid::text = c.id::text
    OR jc.competitionid::text = c.uid::text
  )
  -- PRIORITIZE privy_user_id as the PRIMARY identifier (how users login)
  -- Fall back to userid and walletaddress for legacy data compatibility
  WHERE jc.privy_user_id = user_identifier
     OR jc.userid = user_identifier
     OR jc.wallet_address = user_identifier
  ORDER BY jc.purchasedate DESC NULLS LAST;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_user_dashboard_entries(text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_dashboard_entries(text) TO anon;

-- Add helpful comment documenting privy_user_id as primary identifier
COMMENT ON FUNCTION get_user_dashboard_entries(text) IS
'Returns dashboard entries with competition details for a user.
PRIVY_USER_ID is the PRIMARY identifier (did:privy:xxx format) - this is how users login via Privy/Base.
Also supports userid and wallet_address for legacy data compatibility.
Correctly handles both UUID and legacy UID formats for competition identifiers.';
