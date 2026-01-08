/*
  # Add Missing User Data RPC Functions

  ## Problem:
  The frontend code in userDataService.ts calls two RPC functions that don't exist:
  1. `get_user_tickets_bypass_rls` - Called to get all tickets for a user
  2. `get_recent_entries_count_bypass_rls` - Called to count recent entries

  These functions are needed by the getUserAggregatedData() method to display
  user statistics in the dashboard.

  ## Solution:
  Create both functions with SECURITY DEFINER to bypass RLS and properly handle
  all user identifier formats (privy_user_id, userid, walletaddress).

  This ensures case-insensitive wallet address matching for consistency with
  other RPC functions in the codebase.
*/

-- ============================================================================
-- Part 1: Create get_user_tickets_bypass_rls function
-- Returns all tickets for a user from joincompetition and tickets tables
-- ============================================================================

DROP FUNCTION IF EXISTS get_user_tickets_bypass_rls(TEXT);

CREATE OR REPLACE FUNCTION get_user_tickets_bypass_rls(user_identifier TEXT)
RETURNS TABLE (
  id TEXT,
  competition_id TEXT,
  ticket_number INTEGER,
  ticket_numbers TEXT,
  number_of_tickets INTEGER,
  amount_spent NUMERIC,
  purchase_date TIMESTAMPTZ,
  wallet_address TEXT,
  transaction_hash TEXT,
  is_active BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  lower_identifier TEXT;
BEGIN
  -- Handle null or empty identifier
  IF user_identifier IS NULL OR TRIM(user_identifier) = '' THEN
    RETURN;
  END IF;

  -- Normalize for case-insensitive wallet address comparison
  user_identifier := TRIM(user_identifier);
  lower_identifier := LOWER(user_identifier);

  -- Return tickets from joincompetition (primary source)
  RETURN QUERY
  SELECT
    COALESCE(jc.uid, 'jc-' || jc.competitionid::TEXT || '-' || jc.id::TEXT)::TEXT AS id,
    jc.competitionid::TEXT AS competition_id,
    NULL::INTEGER AS ticket_number,
    jc.ticketnumbers::TEXT AS ticket_numbers,
    COALESCE(jc.numberoftickets, 1)::INTEGER AS number_of_tickets,
    COALESCE(jc.amountspent, 0)::NUMERIC AS amount_spent,
    COALESCE(jc.purchasedate, jc.created_at, NOW())::TIMESTAMPTZ AS purchase_date,
    jc.walletaddress::TEXT AS wallet_address,
    jc.transactionhash::TEXT AS transaction_hash,
    -- Determine if ticket is active based on competition status and end date
    CASE
      WHEN c.id IS NULL THEN FALSE
      WHEN c.status IN ('completed', 'drawn', 'cancelled') THEN FALSE
      WHEN c.end_date IS NOT NULL AND c.end_date < NOW() THEN FALSE
      ELSE TRUE
    END AS is_active
  FROM joincompetition jc
  LEFT JOIN competitions c ON (
    jc.competitionid::TEXT = c.id::TEXT
    OR jc.competitionid::TEXT = c.uid::TEXT
  )
  WHERE (
    jc.privy_user_id = user_identifier
    OR jc.userid = user_identifier
    OR LOWER(jc.walletaddress) = lower_identifier
  )
  AND jc.competitionid IS NOT NULL

  UNION ALL

  -- Also include tickets from tickets table (may have entries not in joincompetition)
  SELECT
    ('t-' || t.id::TEXT) AS id,
    t.competition_id::TEXT AS competition_id,
    t.ticket_number::INTEGER AS ticket_number,
    t.ticket_number::TEXT AS ticket_numbers,
    1::INTEGER AS number_of_tickets,
    COALESCE(t.purchase_price, t.payment_amount, 0)::NUMERIC AS amount_spent,
    COALESCE(t.purchase_date, t.created_at, NOW())::TIMESTAMPTZ AS purchase_date,
    NULL::TEXT AS wallet_address,
    t.payment_tx_hash::TEXT AS transaction_hash,
    -- Determine if ticket is active based on competition status and end date
    CASE
      WHEN c.id IS NULL THEN FALSE
      WHEN c.status IN ('completed', 'drawn', 'cancelled') THEN FALSE
      WHEN c.end_date IS NOT NULL AND c.end_date < NOW() THEN FALSE
      ELSE TRUE
    END AS is_active
  FROM tickets t
  LEFT JOIN competitions c ON t.competition_id = c.id
  WHERE (
    t.privy_user_id = user_identifier
    OR LOWER(t.privy_user_id) = lower_identifier
  )
  AND t.competition_id IS NOT NULL

  ORDER BY purchase_date DESC;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_user_tickets_bypass_rls(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_tickets_bypass_rls(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_user_tickets_bypass_rls(TEXT) TO service_role;

COMMENT ON FUNCTION get_user_tickets_bypass_rls(TEXT) IS
'Returns all tickets for a user from joincompetition and tickets tables.
Bypasses RLS using SECURITY DEFINER. Supports privy_user_id, userid, or
wallet address identifiers with case-insensitive wallet matching.';


-- ============================================================================
-- Part 2: Create get_recent_entries_count_bypass_rls function
-- Returns count of recent entries (last 30 days) for a user
-- ============================================================================

DROP FUNCTION IF EXISTS get_recent_entries_count_bypass_rls(TEXT);

CREATE OR REPLACE FUNCTION get_recent_entries_count_bypass_rls(user_identifier TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  entry_count INTEGER;
  lower_identifier TEXT;
BEGIN
  -- Handle null or empty identifier
  IF user_identifier IS NULL OR TRIM(user_identifier) = '' THEN
    RETURN 0;
  END IF;

  -- Normalize for case-insensitive wallet address comparison
  user_identifier := TRIM(user_identifier);
  lower_identifier := LOWER(user_identifier);

  -- Count entries from the last 30 days in joincompetition
  SELECT COUNT(*)::INTEGER INTO entry_count
  FROM joincompetition jc
  WHERE (
    jc.privy_user_id = user_identifier
    OR jc.userid = user_identifier
    OR LOWER(jc.walletaddress) = lower_identifier
  )
  AND jc.competitionid IS NOT NULL
  AND COALESCE(jc.purchasedate, jc.created_at) >= NOW() - INTERVAL '30 days';

  RETURN COALESCE(entry_count, 0);
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_recent_entries_count_bypass_rls(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_recent_entries_count_bypass_rls(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_recent_entries_count_bypass_rls(TEXT) TO service_role;

COMMENT ON FUNCTION get_recent_entries_count_bypass_rls(TEXT) IS
'Returns count of entries from the last 30 days for a user.
Bypasses RLS using SECURITY DEFINER. Supports privy_user_id, userid, or
wallet address identifiers with case-insensitive wallet matching.';


-- ============================================================================
-- Completion Notice
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '============================================================';
  RAISE NOTICE 'Missing User Data RPC Functions Migration Complete';
  RAISE NOTICE '============================================================';
  RAISE NOTICE 'Changes:';
  RAISE NOTICE '  - Created get_user_tickets_bypass_rls RPC function';
  RAISE NOTICE '  - Created get_recent_entries_count_bypass_rls RPC function';
  RAISE NOTICE '';
  RAISE NOTICE 'These functions support:';
  RAISE NOTICE '  - privy_user_id, userid, and wallet address identifiers';
  RAISE NOTICE '  - Case-insensitive wallet address matching';
  RAISE NOTICE '  - SECURITY DEFINER to bypass RLS for aggregation queries';
  RAISE NOTICE '============================================================';
END $$;
