/*
  # Fix Balance Payments - Missing Dashboard Entries

  ## Problem
  When users pay for competition entries using their account balance (via purchase-tickets-with-bonus),
  the entries don't appear in:
  1. User dashboard "Entries" tab
  2. User dashboard "Orders/Purchases" tab
  3. Competition page ticket availability

  ## Root Causes Identified
  1. `purchase-tickets-with-bonus` wasn't creating a `user_transactions` record
     - Now fixed in the edge function code
  2. The dashboard RPC function uses exact string matching for wallet addresses
     - Wallet addresses can have case differences (0x vs 0X, uppercase vs lowercase)
  3. The canonical user ID format (`prize:pid:...`) stored in joincompetition may not
     match the user_identifier passed to the dashboard function

  ## Solution
  Improve the `get_comprehensive_user_dashboard_entries` RPC to:
  1. Use case-insensitive matching for wallet addresses
  2. Also check the `user_id` column in joincompetition (stores canonical format)
  3. Add canonical ID pattern matching for `prize:pid:` format
*/

-- Drop existing function
DROP FUNCTION IF EXISTS get_comprehensive_user_dashboard_entries(TEXT);

-- Create improved version with case-insensitive wallet matching
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
  lower_identifier TEXT;
BEGIN
  -- Handle null or empty identifier
  IF user_identifier IS NULL OR user_identifier = '' THEN
    RETURN;
  END IF;

  -- Prepare lowercase version for case-insensitive wallet comparisons
  lower_identifier := LOWER(user_identifier);

  -- First, return entries from joincompetition (confirmed entries)
  -- Use case-insensitive matching for wallet addresses
  -- Also match against userid which stores canonical_user_id (prize:pid:...)
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
    COALESCE((LOWER(jc.walletaddress) = LOWER(c.winner_wallet_address)), FALSE) AS is_winner,
    jc.ticketnumbers::TEXT AS ticket_numbers,
    COALESCE(jc.numberoftickets, 1) AS number_of_tickets,
    jc.amountspent AS amount_spent,
    COALESCE(jc.purchasedate::TIMESTAMPTZ, jc.created_at::TIMESTAMPTZ) AS purchase_date,
    jc.walletaddress AS wallet_address,
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
    -- Exact match on privy_user_id (canonical format)
    jc.privy_user_id = user_identifier
    -- Exact match on userid (also stores canonical format)
    OR jc.userid = user_identifier
    -- Case-insensitive wallet address match
    OR LOWER(jc.walletaddress) = lower_identifier
    -- Canonical ID pattern match (prize:pid:xxx matches if xxx is the wallet or privy id)
    OR (
      user_identifier LIKE 'prize:pid:%' AND (
        jc.privy_user_id = user_identifier
        OR jc.userid = user_identifier
      )
    )
    -- Reverse: if stored as canonical but searching with plain ID
    OR (
      jc.privy_user_id LIKE 'prize:pid:%' AND (
        jc.privy_user_id = 'prize:pid:' || user_identifier
        OR jc.privy_user_id = 'prize:pid:' || LOWER(user_identifier)
      )
    )
    OR (
      jc.userid LIKE 'prize:pid:%' AND (
        jc.userid = 'prize:pid:' || user_identifier
        OR jc.userid = 'prize:pid:' || LOWER(user_identifier)
      )
    )
  )
  AND (c.id IS NOT NULL OR jc.competitionid ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
  ORDER BY COALESCE(jc.purchasedate::TIMESTAMPTZ, jc.created_at::TIMESTAMPTZ) DESC;

  -- Collect competition IDs and user-comp pairs for deduplication
  SELECT ARRAY_AGG(DISTINCT COALESCE(c.id, safe_uuid_cast(jc.competitionid))),
         ARRAY_AGG(DISTINCT (jc.competitionid::TEXT || '|' || COALESCE(jc.privy_user_id, jc.userid, LOWER(jc.walletaddress))))
  INTO seen_competition_ids, seen_user_comp_pairs
  FROM joincompetition jc
  LEFT JOIN competitions c ON (
    jc.competitionid::TEXT = c.id::TEXT
    OR jc.competitionid::TEXT = c.uid::TEXT
  )
  WHERE (
    jc.privy_user_id = user_identifier
    OR jc.userid = user_identifier
    OR LOWER(jc.walletaddress) = lower_identifier
    OR (
      user_identifier LIKE 'prize:pid:%' AND (
        jc.privy_user_id = user_identifier
        OR jc.userid = user_identifier
      )
    )
    OR (
      jc.privy_user_id LIKE 'prize:pid:%' AND (
        jc.privy_user_id = 'prize:pid:' || user_identifier
        OR jc.privy_user_id = 'prize:pid:' || LOWER(user_identifier)
      )
    )
    OR (
      jc.userid LIKE 'prize:pid:%' AND (
        jc.userid = 'prize:pid:' || user_identifier
        OR jc.userid = 'prize:pid:' || LOWER(user_identifier)
      )
    )
  )
  AND (c.id IS NOT NULL OR jc.competitionid ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');

  -- Initialize arrays if null
  IF seen_competition_ids IS NULL THEN
    seen_competition_ids := ARRAY[]::UUID[];
  END IF;
  IF seen_user_comp_pairs IS NULL THEN
    seen_user_comp_pairs := ARRAY[]::TEXT[];
  END IF;

  -- Return entries from tickets table that don't have corresponding joincompetition entries
  -- Use case-insensitive user_id matching for wallet addresses
  RETURN QUERY
  SELECT
    ('tickets-' || COALESCE(t.privy_user_id, t.user_id) || '-' || t.competition_id::TEXT)::TEXT AS id,
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
  WHERE (
    t.privy_user_id = user_identifier
    OR t.user_id = user_identifier
    OR LOWER(t.user_id) = lower_identifier
    -- Match canonical format
    OR t.user_id = 'prize:pid:' || user_identifier
    OR t.user_id = 'prize:pid:' || LOWER(user_identifier)
  )
  AND NOT ((t.competition_id::TEXT || '|' || COALESCE(t.privy_user_id, t.user_id, LOWER(t.user_id))) = ANY(seen_user_comp_pairs))
  GROUP BY t.competition_id, COALESCE(t.privy_user_id, t.user_id), c.id, c.title, c.description, c.image_url,
           c.status, c.is_instant_win, c.prize_value, c.end_date
  ORDER BY MIN(t.created_at) DESC;

  -- Return entries from user_transactions with status 'finished'
  -- Use case-insensitive matching for wallet addresses
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
    OR LOWER(ut.wallet_address) = lower_identifier
    -- Match canonical format
    OR ut.user_id = 'prize:pid:' || user_identifier
    OR ut.user_id = 'prize:pid:' || LOWER(user_identifier)
    OR ut.user_privy_id = 'prize:pid:' || user_identifier
    OR ut.user_privy_id = 'prize:pid:' || LOWER(user_identifier)
  )
  AND ut.status = 'finished'
  AND ut.competition_id IS NOT NULL
  AND ut.competition_id::TEXT ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  AND NOT (safe_uuid_cast(ut.competition_id::TEXT) = ANY(seen_competition_ids))
  ORDER BY ut.created_at DESC;

  -- Return pending entries from pending_tickets
  -- Use case-insensitive user_id matching
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
    OR LOWER(pt.user_id) = lower_identifier
    -- Match canonical format
    OR pt.user_id = 'prize:pid:' || user_identifier
    OR pt.user_id = 'prize:pid:' || LOWER(user_identifier)
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
'Returns all user entries from joincompetition, tickets (fallback), user_transactions, and pending_tickets tables.
Uses case-insensitive matching for wallet addresses and handles canonical ID format (prize:pid:...).
Fixed to properly show entries from balance payments.';

-- Also add index for case-insensitive wallet lookups
CREATE INDEX IF NOT EXISTS idx_joincompetition_walletaddress_lower
ON joincompetition (LOWER(walletaddress));

CREATE INDEX IF NOT EXISTS idx_user_transactions_wallet_lower
ON user_transactions (LOWER(wallet_address));

CREATE INDEX IF NOT EXISTS idx_tickets_user_id_lower
ON tickets (LOWER(user_id));
