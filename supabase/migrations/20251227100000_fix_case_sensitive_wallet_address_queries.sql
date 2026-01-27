/*
  # Fix Case-Sensitive Wallet Address Comparisons in RPC Functions

  ## Problem
  The `get_comprehensive_user_dashboard_entries` function uses exact string matching (=)
  for wallet address comparisons, which is case-sensitive. Ethereum wallet addresses are
  case-insensitive (0xABC == 0xabc), but different systems may store them in different cases:
  - MetaMask returns checksummed addresses (mixed case)
  - Some SDKs return lowercase addresses
  - Users may manually enter addresses in various cases

  This causes entries to not be found when the wallet address in the query doesn't match
  the exact case stored in the database.

  ## Solution
  Update the RPC function to use LOWER() for wallet address comparisons, ensuring
  case-insensitive matching. This is more efficient than using ILIKE as it can leverage
  indexes on lowercased columns.

  ## Index Analysis
  The existing indexes from the user's Supabase instance show:
  - No explicit indexes on wallet_address columns in public schema tables
  - The OR queries in the RPC can still be slow without proper indexes

  We'll also add function indexes on LOWER(wallet_address) columns for the key tables
  to optimize the case-insensitive queries.
*/

-- Drop existing function
DROP FUNCTION IF EXISTS get_comprehensive_user_dashboard_entries(TEXT);

-- Create improved version with case-insensitive wallet address matching
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
  seen_user_comp_pairs TEXT[] := ARRAY[]::TEXT[];
  -- Normalize wallet addresses to lowercase for case-insensitive comparison
  lower_identifier TEXT := LOWER(user_identifier);
BEGIN
  -- Handle null or empty identifier
  IF user_identifier IS NULL OR user_identifier = '' THEN
    RETURN;
  END IF;

  -- First, return entries from joincompetition (confirmed entries)
  -- Use LOWER() for wallet address comparisons to handle case differences
  RETURN QUERY
  SELECT
    COALESCE(jc.uid, jc.id::TEXT) AS id,
    COALESCE(c.id, safe_uuid_cast(jc.competitionid)) AS competition_id,
    COALESCE(c.title, 'Competition #' || LEFT(jc.competitionid::TEXT, 8)) AS title,
    COALESCE(c.description, '') AS description,
    COALESCE(c.image_url, '') AS image,
    CASE
      WHEN c.id IS NULL THEN 'ended'
      WHEN c.status = 'active' THEN 'live'
      WHEN c.status IN ('completed', 'drawn', 'drawing') THEN 'drawn'
      WHEN c.status = 'cancelled' THEN 'cancelled'
      ELSE 'live'
    END AS status,
    'completed'::TEXT AS entry_type,
    NULL::TIMESTAMPTZ AS expires_at,
    COALESCE((LOWER(jc.wallet_address) = LOWER(c.winner_wallet_address)), FALSE) AS is_winner,
    jc.ticketnumbers::TEXT AS ticket_numbers,
    COALESCE(jc.numberoftickets, 1) AS number_of_tickets,
    jc.amountspent AS amount_spent,
    COALESCE(jc.purchasedate::TIMESTAMPTZ, jc.created_at::TIMESTAMPTZ) AS purchase_date,
    jc.wallet_address AS wallet_address,
    jc.transactionhash AS transaction_hash,
    COALESCE(c.is_instant_win, FALSE) AS is_instant_win,
    c.prize_value AS prize_value,
    COALESCE(c.status, 'unknown') AS competition_status,
    c.end_date AS end_date
  FROM joincompetition jc
  LEFT JOIN competitions c ON (
    jc.competitionid::TEXT = c.id::TEXT
    OR jc.competitionid::TEXT = c.uid::TEXT
    OR (
      LENGTH(jc.competitionid) = 32 AND
      jc.competitionid = REPLACE(c.id::TEXT, '-', '')
    )
  )
  WHERE (
    jc.privy_user_id = user_identifier
    OR jc.userid = user_identifier
    -- Case-insensitive wallet address comparison
    OR LOWER(jc.wallet_address) = lower_identifier
  )
  AND (c.id IS NOT NULL OR jc.competitionid ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
  ORDER BY COALESCE(jc.purchasedate::TIMESTAMPTZ, jc.created_at::TIMESTAMPTZ) DESC;

  -- Collect competition IDs and user-comp pairs from joincompetition to avoid duplicates
  SELECT ARRAY_AGG(DISTINCT COALESCE(c.id, safe_uuid_cast(jc.competitionid))),
         ARRAY_AGG(DISTINCT (jc.competitionid::TEXT || '|' || COALESCE(jc.privy_user_id, jc.userid)))
  INTO seen_competition_ids, seen_user_comp_pairs
  FROM joincompetition jc
  LEFT JOIN competitions c ON (
    jc.competitionid::TEXT = c.id::TEXT
    OR jc.competitionid::TEXT = c.uid::TEXT
  )
  WHERE (
    jc.privy_user_id = user_identifier
    OR jc.userid = user_identifier
    -- Case-insensitive wallet address comparison
    OR LOWER(jc.wallet_address) = lower_identifier
  )
  AND (c.id IS NOT NULL OR jc.competitionid ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');

  -- Initialize empty arrays if null
  IF seen_competition_ids IS NULL THEN
    seen_competition_ids := ARRAY[]::UUID[];
  END IF;
  IF seen_user_comp_pairs IS NULL THEN
    seen_user_comp_pairs := ARRAY[]::TEXT[];
  END IF;

  -- Return entries from tickets table that don't have corresponding joincompetition entries
  RETURN QUERY
  SELECT
    ('tickets-' || t.privy_user_id || '-' || t.competition_id::TEXT)::TEXT AS id,
    t.competition_id AS competition_id,
    COALESCE(c.title, 'Competition #' || LEFT(t.competition_id::TEXT, 8)) AS title,
    COALESCE(c.description, '') AS description,
    COALESCE(c.image_url, '') AS image,
    CASE
      WHEN c.id IS NULL THEN 'ended'
      WHEN c.status = 'active' THEN 'live'
      WHEN c.status IN ('completed', 'drawn', 'drawing') THEN 'drawn'
      WHEN c.status = 'cancelled' THEN 'cancelled'
      ELSE 'live'
    END AS status,
    'completed_from_tickets'::TEXT AS entry_type,
    NULL::TIMESTAMPTZ AS expires_at,
    FALSE AS is_winner,
    string_agg(t.ticket_number::TEXT, ',' ORDER BY t.ticket_number) AS ticket_numbers,
    COUNT(*)::INTEGER AS number_of_tickets,
    COALESCE(SUM(t.purchase_price), 0)::NUMERIC AS amount_spent,
    MIN(t.created_at)::TIMESTAMPTZ AS purchase_date,
    NULL::TEXT AS wallet_address,
    NULL::TEXT AS transaction_hash,
    COALESCE(c.is_instant_win, FALSE) AS is_instant_win,
    c.prize_value AS prize_value,
    COALESCE(c.status, 'unknown') AS competition_status,
    c.end_date AS end_date
  FROM tickets t
  LEFT JOIN competitions c ON t.competition_id = c.id
  WHERE t.privy_user_id = user_identifier
    AND NOT ((t.competition_id::TEXT || '|' || t.privy_user_id) = ANY(seen_user_comp_pairs))
  GROUP BY t.competition_id, t.privy_user_id, c.id, c.title, c.description, c.image_url,
           c.status, c.is_instant_win, c.prize_value, c.end_date
  ORDER BY MIN(t.created_at) DESC;

  -- Return entries from user_transactions with status 'finished'
  -- Use case-insensitive wallet address comparison
  RETURN QUERY
  SELECT
    ut.id::TEXT AS id,
    safe_uuid_cast(ut.competition_id::TEXT) AS competition_id,
    COALESCE(c.title, 'Competition #' || LEFT(ut.competition_id::TEXT, 8)) AS title,
    COALESCE(c.description, '') AS description,
    COALESCE(c.image_url, '') AS image,
    CASE
      WHEN c.id IS NULL THEN 'ended'
      WHEN c.status = 'active' THEN 'live'
      WHEN c.status IN ('completed', 'drawn', 'drawing') THEN 'drawn'
      WHEN c.status = 'cancelled' THEN 'cancelled'
      ELSE 'live'
    END AS status,
    'completed_transaction'::TEXT AS entry_type,
    NULL::TIMESTAMPTZ AS expires_at,
    FALSE AS is_winner,
    NULL::TEXT AS ticket_numbers,
    COALESCE(ut.ticket_count, 1) AS number_of_tickets,
    ut.amount AS amount_spent,
    ut.created_at AS purchase_date,
    ut.wallet_address AS wallet_address,
    ut.tx_id AS transaction_hash,
    COALESCE(c.is_instant_win, FALSE) AS is_instant_win,
    c.prize_value AS prize_value,
    COALESCE(c.status, 'unknown') AS competition_status,
    c.end_date AS end_date
  FROM user_transactions ut
  LEFT JOIN competitions c ON ut.competition_id::TEXT = c.id::TEXT
  WHERE (
    ut.user_privy_id = user_identifier
    OR ut.user_id = user_identifier
    -- Case-insensitive wallet address comparison
    OR LOWER(ut.wallet_address) = lower_identifier
  )
  AND ut.status = 'finished'
  AND ut.competition_id IS NOT NULL
  AND ut.competition_id::TEXT ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  AND NOT (safe_uuid_cast(ut.competition_id::TEXT) = ANY(seen_competition_ids))
  ORDER BY ut.created_at DESC;

  -- Return pending entries from pending_tickets
  -- pending_tickets uses user_id, not wallet_address directly
  RETURN QUERY
  SELECT
    pt.id::TEXT AS id,
    pt.competition_id AS competition_id,
    COALESCE(c.title, 'Competition #' || LEFT(pt.competition_id::TEXT, 8)) AS title,
    COALESCE(c.description, '') AS description,
    COALESCE(c.image_url, '') AS image,
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
    COALESCE(c.status, 'unknown') AS competition_status,
    c.end_date AS end_date
  FROM pending_tickets pt
  LEFT JOIN competitions c ON pt.competition_id = c.id
  WHERE (
    pt.user_id = user_identifier
    -- Also check case-insensitive wallet address match in user_id field
    OR LOWER(pt.user_id) = lower_identifier
  )
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
'Returns all user entries with case-insensitive wallet address matching. Queries joincompetition, tickets, user_transactions, and pending_tickets tables.';

/*
  ## Index Recommendations

  Based on the provided index list from Supabase, the following indexes should be considered
  for optimal performance of the OR queries in this RPC (to be created in production):

  -- For joincompetition table
  CREATE INDEX IF NOT EXISTS idx_joincompetition_privy_user_id ON joincompetition(privy_user_id);
  CREATE INDEX IF NOT EXISTS idx_joincompetition_userid ON joincompetition(userid);
  CREATE INDEX IF NOT EXISTS idx_joincompetition_wallet_address_lower ON joincompetition(LOWER(wallet_address));

  -- For user_transactions table
  CREATE INDEX IF NOT EXISTS idx_user_transactions_user_privy_id ON user_transactions(user_privy_id);
  CREATE INDEX IF NOT EXISTS idx_user_transactions_wallet_address_lower ON user_transactions(LOWER(wallet_address));

  -- For pending_tickets table
  CREATE INDEX IF NOT EXISTS idx_pending_tickets_user_id_lower ON pending_tickets(LOWER(user_id));

  -- For privy_user_connections table (used by balance queries)
  CREATE INDEX IF NOT EXISTS idx_privy_user_connections_wallet_lower ON privy_user_connections(LOWER(wallet_address));
  CREATE INDEX IF NOT EXISTS idx_privy_user_connections_base_wallet_lower ON privy_user_connections(LOWER(base_wallet_address));

  Note: These are provided as recommendations. The actual impact should be measured with EXPLAIN ANALYZE
  before and after index creation.
*/

-- Create indexes for optimized wallet address lookups
-- Using LOWER() expression indexes for case-insensitive matching

-- Index on joincompetition for wallet address lookups
CREATE INDEX IF NOT EXISTS idx_joincompetition_wallet_address_lower
ON joincompetition(LOWER(wallet_address));

-- Index on joincompetition for privy_user_id lookups
CREATE INDEX IF NOT EXISTS idx_joincompetition_privy_user_id
ON joincompetition(privy_user_id)
WHERE privy_user_id IS NOT NULL;

-- Index on user_transactions for wallet address lookups
CREATE INDEX IF NOT EXISTS idx_user_transactions_wallet_lower
ON user_transactions(LOWER(wallet_address));

-- Index on user_transactions for user_privy_id lookups
CREATE INDEX IF NOT EXISTS idx_user_transactions_user_privy_id
ON user_transactions(user_privy_id)
WHERE user_privy_id IS NOT NULL;

-- Index on pending_tickets for user_id lookups (includes wallet addresses)
CREATE INDEX IF NOT EXISTS idx_pending_tickets_user_id_lower
ON pending_tickets(LOWER(user_id));

-- Index on privy_user_connections for case-insensitive wallet lookups
CREATE INDEX IF NOT EXISTS idx_privy_user_connections_wallet_lower
ON privy_user_connections(LOWER(wallet_address));

-- Index on privy_user_connections for base_wallet_address lookups
CREATE INDEX IF NOT EXISTS idx_privy_user_connections_base_wallet_lower
ON privy_user_connections(LOWER(base_wallet_address));
