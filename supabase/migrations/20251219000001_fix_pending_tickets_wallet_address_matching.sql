/*
  # Fix Pending Tickets Wallet Address Matching in Dashboard RPC

  ## Problem
  The `get_comprehensive_user_dashboard_entries` RPC function uses exact string match
  for `pending_tickets.user_id` when querying pending reservations:

  ```sql
  WHERE pt.user_id = user_identifier
  ```

  However, Ethereum wallet addresses are case-insensitive. The CDP SDK may return
  checksummed addresses (mixed case like 0xAbC...123) while storage or queries may
  use lowercase. This exact match causes pending reservations to not be found when
  the user identifier has different casing.

  Additionally, the query only checks `user_id` column, but `pending_tickets` might
  also have entries that can be found via `wallet_address` column (if it exists).

  ## Solution
  Update the `pending_tickets` query in the RPC to:
  1. Use case-insensitive matching for wallet addresses (LOWER() comparison)
  2. Check both `user_id` column and detect if it's a wallet address

  ## Impact
  Users will now see their pending reservations in the dashboard regardless of
  how the wallet address casing was stored vs. queried.
*/

-- Drop and recreate the function with the fix
DROP FUNCTION IF EXISTS get_comprehensive_user_dashboard_entries(TEXT);

-- Recreate safe_uuid_cast if needed (no changes)
CREATE OR REPLACE FUNCTION safe_uuid_cast(input_text TEXT)
RETURNS UUID AS $$
BEGIN
  IF input_text IS NULL OR input_text = '' THEN
    RETURN NULL;
  END IF;

  -- UUID format: 8-4-4-4-12 hex characters with dashes
  IF input_text ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RETURN input_text::UUID;
  END IF;

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Grant execute permissions for the helper function
GRANT EXECUTE ON FUNCTION safe_uuid_cast(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION safe_uuid_cast(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION safe_uuid_cast(TEXT) TO service_role;

-- Create improved version with case-insensitive wallet address matching for pending_tickets
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
  normalized_identifier TEXT;
  is_wallet_address BOOLEAN;
BEGIN
  -- Handle null or empty identifier
  IF user_identifier IS NULL OR TRIM(user_identifier) = '' THEN
    RETURN;
  END IF;

  -- Normalize the user identifier
  user_identifier := TRIM(user_identifier);

  -- Check if the identifier looks like an Ethereum wallet address (0x + 40 hex chars)
  is_wallet_address := user_identifier ~ '^0x[a-fA-F0-9]{40}$';

  -- Normalize wallet address to lowercase for consistent comparison
  normalized_identifier := CASE
    WHEN is_wallet_address THEN LOWER(user_identifier)
    ELSE user_identifier
  END;

  -- First, return entries from joincompetition (confirmed entries)
  -- CRITICAL FIX: Always return entries, even when competition lookup fails
  RETURN QUERY
  SELECT
    COALESCE(jc.uid, jc.id::TEXT, 'jc-' || jc.competitionid) AS id,
    COALESCE(
      c.id,
      safe_uuid_cast(jc.competitionid)
    ) AS competition_id,
    COALESCE(
      c.title,
      CASE
        WHEN jc.competitionid IS NOT NULL THEN 'Competition (Ended)'
        ELSE 'Unknown Competition'
      END
    ) AS title,
    COALESCE(c.description, '') AS description,
    COALESCE(c.image_url, '') AS image,
    CASE
      WHEN c.id IS NULL THEN 'completed'
      WHEN c.status = 'active' THEN 'live'
      WHEN c.status IN ('completed', 'drawn', 'drawing') THEN 'drawn'
      WHEN c.status = 'cancelled' THEN 'cancelled'
      ELSE 'live'
    END AS status,
    'completed'::TEXT AS entry_type,
    NULL::TIMESTAMPTZ AS expires_at,
    COALESCE((jc.walletaddress = c.winner_wallet_address), FALSE) AS is_winner,
    jc.ticketnumbers::TEXT AS ticket_numbers,
    COALESCE(jc.numberoftickets, 1) AS number_of_tickets,
    COALESCE(jc.amountspent, 0) AS amount_spent,
    COALESCE(jc.purchasedate::TIMESTAMPTZ, jc.created_at::TIMESTAMPTZ, NOW()) AS purchase_date,
    jc.walletaddress AS wallet_address,
    jc.transactionhash AS transaction_hash,
    COALESCE(c.is_instant_win, FALSE) AS is_instant_win,
    c.prize_value AS prize_value,
    COALESCE(c.status, 'completed') AS competition_status,
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
    OR LOWER(jc.walletaddress) = normalized_identifier
  )
  AND jc.competitionid IS NOT NULL
  AND LENGTH(TRIM(jc.competitionid)) > 0
  ORDER BY COALESCE(jc.purchasedate::TIMESTAMPTZ, jc.created_at::TIMESTAMPTZ, NOW()) DESC;

  -- Collect competition IDs and user-comp pairs from joincompetition to avoid duplicates
  SELECT
    COALESCE(
      ARRAY_AGG(DISTINCT COALESCE(c.id, safe_uuid_cast(jc.competitionid)))
        FILTER (WHERE COALESCE(c.id, safe_uuid_cast(jc.competitionid)) IS NOT NULL),
      ARRAY[]::UUID[]
    ),
    COALESCE(
      ARRAY_AGG(DISTINCT (jc.competitionid::TEXT || '|' || COALESCE(jc.privy_user_id, jc.userid, '')))
        FILTER (WHERE jc.competitionid IS NOT NULL),
      ARRAY[]::TEXT[]
    )
  INTO seen_competition_ids, seen_user_comp_pairs
  FROM joincompetition jc
  LEFT JOIN competitions c ON (
    jc.competitionid::TEXT = c.id::TEXT
    OR jc.competitionid::TEXT = c.uid::TEXT
  )
  WHERE (
    jc.privy_user_id = user_identifier
    OR jc.userid = user_identifier
    OR LOWER(jc.walletaddress) = normalized_identifier
  )
  AND jc.competitionid IS NOT NULL;

  -- Return entries from tickets table that don't have corresponding joincompetition entries
  RETURN QUERY
  SELECT
    ('tickets-' || t.privy_user_id || '-' || t.competition_id::TEXT)::TEXT AS id,
    t.competition_id AS competition_id,
    COALESCE(c.title, 'Competition #' || LEFT(t.competition_id::TEXT, 8)) AS title,
    COALESCE(c.description, '') AS description,
    COALESCE(c.image_url, '') AS image,
    CASE
      WHEN c.id IS NULL THEN 'completed'
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
    COALESCE(c.status, 'completed') AS competition_status,
    c.end_date AS end_date
  FROM tickets t
  LEFT JOIN competitions c ON t.competition_id = c.id
  WHERE (
    t.privy_user_id = user_identifier
    OR LOWER(t.privy_user_id) = normalized_identifier
  )
    AND t.competition_id IS NOT NULL
    AND NOT ((t.competition_id::TEXT || '|' || t.privy_user_id) = ANY(seen_user_comp_pairs))
  GROUP BY t.competition_id, t.privy_user_id, c.id, c.title, c.description, c.image_url,
           c.status, c.is_instant_win, c.prize_value, c.end_date
  ORDER BY MIN(t.created_at) DESC;

  -- Return entries from user_transactions with completed status
  RETURN QUERY
  SELECT
    ut.id::TEXT AS id,
    safe_uuid_cast(ut.competition_id::TEXT) AS competition_id,
    COALESCE(c.title, 'Competition #' || LEFT(ut.competition_id::TEXT, 8)) AS title,
    COALESCE(c.description, '') AS description,
    COALESCE(c.image_url, '') AS image,
    CASE
      WHEN c.id IS NULL THEN 'completed'
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
    COALESCE(ut.amount, 0) AS amount_spent,
    ut.created_at AS purchase_date,
    ut.wallet_address AS wallet_address,
    ut.tx_id AS transaction_hash,
    COALESCE(c.is_instant_win, FALSE) AS is_instant_win,
    c.prize_value AS prize_value,
    COALESCE(c.status, 'completed') AS competition_status,
    c.end_date AS end_date
  FROM user_transactions ut
  LEFT JOIN competitions c ON ut.competition_id::TEXT = c.id::TEXT
  WHERE (
    ut.user_privy_id = user_identifier
    OR ut.user_id = user_identifier
    OR ut.privy_user_id = user_identifier
    OR LOWER(ut.wallet_address) = normalized_identifier
  )
  AND (
    ut.status IN ('finished', 'completed', 'confirmed', 'success')
    OR ut.payment_status IN ('finished', 'confirmed', 'success', 'paid')
  )
  AND ut.competition_id IS NOT NULL
  AND ut.competition_id::TEXT ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  AND NOT (safe_uuid_cast(ut.competition_id::TEXT) = ANY(seen_competition_ids))
  ORDER BY ut.created_at DESC;

  -- Return pending entries from pending_tickets
  -- FIX: Use case-insensitive matching for wallet addresses stored in user_id column
  -- The user_id column stores the wallet address (from baseUser.id in frontend)
  -- Ethereum addresses are case-insensitive, so we need to compare using LOWER()
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
    COALESCE(pt.ticket_count, 0) AS number_of_tickets,
    COALESCE(pt.total_amount, 0) AS amount_spent,
    pt.created_at AS purchase_date,
    NULL::TEXT AS wallet_address,
    pt.transaction_hash AS transaction_hash,
    COALESCE(c.is_instant_win, FALSE) AS is_instant_win,
    c.prize_value AS prize_value,
    COALESCE(c.status, 'active') AS competition_status,
    c.end_date AS end_date
  FROM pending_tickets pt
  LEFT JOIN competitions c ON pt.competition_id = c.id
  WHERE (
    -- Exact match for non-wallet identifiers (Privy DIDs, UUIDs)
    pt.user_id = user_identifier
    -- Case-insensitive match for wallet addresses
    -- This handles cases where CDP SDK returns checksummed addresses (0xAbC...)
    -- but storage or query uses different casing
    OR (is_wallet_address AND LOWER(pt.user_id) = normalized_identifier)
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
'Returns all user entries from joincompetition, tickets, user_transactions, and pending_tickets tables.
Fixed to use case-insensitive wallet address matching for pending_tickets queries.
Ethereum addresses are case-insensitive (checksummed vs non-checksummed) but exact string
comparison fails when casing differs. This fix normalizes wallet addresses to lowercase
before comparison, ensuring users see their pending reservations regardless of address casing.';
