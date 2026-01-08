/*
  # Create Comprehensive User Dashboard Entries RPC Function

  ## Problem
  The frontend dashboard expects the `get_comprehensive_user_dashboard_entries` RPC function
  to aggregate user entries from multiple sources:
  - joincompetition table (legacy confirmed entries)
  - user_transactions table (payment-based entries with "finished" status)
  - pending_tickets table (reservations awaiting payment confirmation)

  This ensures users see all their entries regardless of how they were created.

  ## Solution
  Create a comprehensive RPC function that:
  1. Retrieves confirmed entries from joincompetition
  2. Retrieves completed transactions from user_transactions (status = 'finished')
  3. Retrieves active pending reservations from pending_tickets
  4. Deduplicates entries that appear in multiple tables
  5. Maps competition statuses to frontend-friendly values

  ## Status Mapping
  - active competitions → live status (still running)
  - completed/drawn/drawing competitions → drawn status (finished/ended)
  - cancelled competitions → cancelled status
  - Pending entries → pending status
*/

-- Drop existing function if it exists
DROP FUNCTION IF EXISTS get_comprehensive_user_dashboard_entries(TEXT);

-- Create the comprehensive dashboard entries function
CREATE OR REPLACE FUNCTION get_comprehensive_user_dashboard_entries(user_identifier TEXT)
RETURNS TABLE (
  id TEXT,
  competition_id UUID,
  title TEXT,
  description TEXT,
  image TEXT,
  status TEXT,
  entry_type TEXT,
  expires_at TIMESTAMPTZ,
  is_winner BOOLEAN,
  ticket_numbers TEXT,
  number_of_tickets INTEGER,
  amount_spent NUMERIC,
  purchase_date TIMESTAMPTZ,
  wallet_address TEXT,
  transaction_hash TEXT,
  is_instant_win BOOLEAN,
  prize_value TEXT,
  competition_status TEXT,
  end_date TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  seen_competition_ids UUID[] := ARRAY[]::UUID[];
BEGIN
  -- Handle null or empty identifier
  IF user_identifier IS NULL OR user_identifier = '' THEN
    RETURN;
  END IF;

  -- First, return entries from joincompetition (confirmed entries)
  RETURN QUERY
  SELECT
    COALESCE(jc.uid, jc.id::TEXT) AS id,
    jc.competitionid AS competition_id,
    COALESCE(c.title, 'Unknown Competition') AS title,
    COALESCE(c.description, '') AS description,
    c.image_url AS image,
    CASE
      WHEN c.status = 'active' THEN 'live'
      WHEN c.status IN ('completed', 'drawn', 'drawing') THEN 'drawn'
      WHEN c.status = 'cancelled' THEN 'cancelled'
      ELSE 'live'
    END AS status,
    'completed'::TEXT AS entry_type,
    NULL::TIMESTAMPTZ AS expires_at,
    (jc.walletaddress = c.winner_wallet_address) AS is_winner,
    jc.ticketnumbers::TEXT AS ticket_numbers,
    COALESCE(jc.numberoftickets, 1) AS number_of_tickets,
    jc.amountspent AS amount_spent,
    COALESCE(jc.purchasedate::TIMESTAMPTZ, jc.created_at::TIMESTAMPTZ) AS purchase_date,
    jc.walletaddress AS wallet_address,
    jc.transactionhash AS transaction_hash,
    COALESCE(c.is_instant_win, FALSE) AS is_instant_win,
    c.prize_value AS prize_value,
    c.status AS competition_status,
    c.end_date AS end_date
  FROM joincompetition jc
  LEFT JOIN competitions c ON (
    jc.competitionid::TEXT = c.id::TEXT
    OR jc.competitionid::TEXT = c.uid::TEXT
  )
  WHERE (
    jc.privy_user_id = user_identifier
    OR jc.userid = user_identifier
    OR jc.walletaddress = user_identifier
  )
  ORDER BY COALESCE(jc.purchasedate::TIMESTAMPTZ, jc.created_at::TIMESTAMPTZ) DESC;

  -- Collect competition IDs from joincompetition to avoid duplicates
  SELECT ARRAY_AGG(DISTINCT jc.competitionid) INTO seen_competition_ids
  FROM joincompetition jc
  WHERE (
    jc.privy_user_id = user_identifier
    OR jc.userid = user_identifier
    OR jc.walletaddress = user_identifier
  );

  -- If no entries were found in joincompetition, initialize empty array
  IF seen_competition_ids IS NULL THEN
    seen_competition_ids := ARRAY[]::UUID[];
  END IF;

  -- Return entries from user_transactions with status 'finished'
  -- Skip entries for competitions already in joincompetition (deduplication)
  RETURN QUERY
  SELECT
    ut.id::TEXT AS id,
    ut.competition_id::UUID AS competition_id,
    COALESCE(c.title, 'Unknown Competition') AS title,
    COALESCE(c.description, '') AS description,
    c.image_url AS image,
    CASE
      WHEN c.status = 'active' THEN 'live'
      WHEN c.status IN ('completed', 'drawn', 'drawing') THEN 'drawn'
      WHEN c.status = 'cancelled' THEN 'cancelled'
      ELSE 'live'
    END AS status,
    'completed_transaction'::TEXT AS entry_type,
    NULL::TIMESTAMPTZ AS expires_at,
    FALSE AS is_winner, -- Transactions don't track winner status directly
    NULL::TEXT AS ticket_numbers, -- Transactions don't have specific ticket numbers
    COALESCE(ut.ticket_count, 1) AS number_of_tickets,
    ut.amount AS amount_spent,
    ut.created_at AS purchase_date,
    ut.wallet_address AS wallet_address,
    ut.tx_id AS transaction_hash,
    COALESCE(c.is_instant_win, FALSE) AS is_instant_win,
    c.prize_value AS prize_value,
    c.status AS competition_status,
    c.end_date AS end_date
  FROM user_transactions ut
  LEFT JOIN competitions c ON ut.competition_id::TEXT = c.id::TEXT
  WHERE (
    ut.user_privy_id = user_identifier
    OR ut.user_id = user_identifier
    OR ut.wallet_address = user_identifier
  )
  AND ut.status = 'finished'
  AND NOT (ut.competition_id::UUID = ANY(seen_competition_ids))
  ORDER BY ut.created_at DESC;

  -- Return pending entries from pending_tickets
  -- Only include non-expired pending reservations
  RETURN QUERY
  SELECT
    pt.id::TEXT AS id,
    pt.competition_id AS competition_id,
    COALESCE(c.title, 'Unknown Competition') AS title,
    COALESCE(c.description, '') AS description,
    c.image_url AS image,
    'pending'::TEXT AS status,
    'pending'::TEXT AS entry_type,
    pt.expires_at AS expires_at,
    FALSE AS is_winner,
    array_to_string(pt.ticket_numbers, ',') AS ticket_numbers,
    pt.ticket_count AS number_of_tickets,
    pt.total_amount AS amount_spent,
    pt.created_at AS purchase_date,
    NULL::TEXT AS wallet_address,
    pt.transaction_hash AS transaction_hash,
    COALESCE(c.is_instant_win, FALSE) AS is_instant_win,
    c.prize_value AS prize_value,
    c.status AS competition_status,
    c.end_date AS end_date
  FROM pending_tickets pt
  LEFT JOIN competitions c ON pt.competition_id = c.id
  WHERE pt.user_id = user_identifier
  AND pt.status = 'pending'
  AND pt.expires_at > NOW()
  ORDER BY pt.created_at DESC;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_comprehensive_user_dashboard_entries(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_comprehensive_user_dashboard_entries(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_comprehensive_user_dashboard_entries(TEXT) TO service_role;

-- Add helpful comment
COMMENT ON FUNCTION get_comprehensive_user_dashboard_entries(TEXT) IS
'Returns all user entries from joincompetition, user_transactions, and pending_tickets tables. Supports privy_user_id, userid, or wallet_address identifiers. Deduplicates entries and maps statuses for frontend display.';
