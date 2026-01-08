/*
  # Fix Winner Column Name in Dashboard RPC

  ## Problem
  The `get_comprehensive_user_dashboard_entries` RPC function uses `c.winner_wallet_address`
  for winner comparison, but the actual column in the competitions table is `winner_address`.

  This causes `is_winner` to ALWAYS be FALSE because:
  - The VRF webhook stores winner in `competitions.winner_address`
  - But the RPC queries `c.winner_wallet_address` which doesn't exist (returns NULL)
  - So LOWER(jc.walletaddress) = LOWER(NULL) is always FALSE

  ## Impact
  Users who won competitions are incorrectly shown as "COMPETITION LOST" because
  the winner comparison always fails due to the wrong column name.

  ## Solution
  Replace all occurrences of `winner_wallet_address` with `winner_address` in the RPC function.
*/

-- Drop existing function
DROP FUNCTION IF EXISTS get_comprehensive_user_dashboard_entries(TEXT);

-- Recreate safe_uuid_cast if needed
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

-- Grant permissions
GRANT EXECUTE ON FUNCTION safe_uuid_cast(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION safe_uuid_cast(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION safe_uuid_cast(TEXT) TO service_role;

-- Create fixed function with correct winner_address column name
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
  -- Track seen entries to prevent duplicates across data sources
  seen_tx_hashes TEXT[] := ARRAY[]::TEXT[];
  seen_ticket_sets TEXT[] := ARRAY[]::TEXT[]; -- competition_id + sorted ticket numbers
  seen_competition_user_pairs TEXT[] := ARRAY[]::TEXT[]; -- competition_id + user identifier
  -- Normalize wallet addresses to lowercase for case-insensitive comparison
  lower_identifier TEXT;
  -- Extract wallet from prize:pid: format if present
  search_wallet TEXT := NULL;
BEGIN
  -- Handle null or empty identifier
  IF user_identifier IS NULL OR user_identifier = '' THEN
    RETURN;
  END IF;

  -- Pre-compute lowercase identifier for efficient case-insensitive comparisons
  lower_identifier := LOWER(user_identifier);

  -- FIX: Extract wallet address from prize:pid:0x... format
  -- This matches the logic in get_user_wallet_balance function
  IF user_identifier LIKE 'prize:pid:0x%' THEN
    -- Extract the wallet address part (after 'prize:pid:')
    search_wallet := LOWER(SUBSTRING(user_identifier FROM 11));
  ELSIF user_identifier ~ '^0x[a-fA-F0-9]{40}$' THEN
    -- Already a wallet address
    search_wallet := lower_identifier;
  END IF;

  -- ============================================================================
  -- QUERY 1: joincompetition table (PRIMARY source)
  -- ============================================================================
  RETURN QUERY
  SELECT
    COALESCE(jc.uid::TEXT, jc.id::TEXT, ('jc-' || jc.competitionid)::TEXT) AS id,
    safe_uuid_cast(jc.competitionid) AS competition_id,
    COALESCE(c.title, 'Competition (Ended)') AS title,
    COALESCE(c.description, '') AS description,
    COALESCE(c.image_url, '') AS image,
    -- ISSUE B/C FIX: Calculate effective status from end_date
    -- If end_date has passed but status is still 'active', override to 'completed'
    CASE
      WHEN c.id IS NULL THEN 'completed'
      WHEN c.status IN ('completed', 'drawn', 'drawing') THEN 'drawn'
      WHEN c.status = 'cancelled' THEN 'cancelled'
      WHEN c.status = 'active' AND c.end_date IS NOT NULL AND c.end_date < NOW() THEN 'drawn'
      WHEN c.status = 'active' THEN 'live'
      ELSE 'live'
    END AS status,
    'completed'::TEXT AS entry_type,
    NULL::TIMESTAMPTZ AS expires_at,
    -- FIX: Use winner_address (correct column) instead of winner_wallet_address (wrong column)
    -- Case-insensitive winner check
    COALESCE((LOWER(jc.walletaddress) = LOWER(c.winner_address)), FALSE) AS is_winner,
    jc.ticketnumbers::TEXT AS ticket_numbers,
    COALESCE(jc.numberoftickets, 1) AS number_of_tickets,
    COALESCE(jc.amountspent, 0) AS amount_spent,
    COALESCE(jc.purchasedate::TIMESTAMPTZ, jc.created_at::TIMESTAMPTZ, NOW()) AS purchase_date,
    jc.walletaddress AS wallet_address,
    jc.transactionhash AS transaction_hash,
    COALESCE(c.is_instant_win, FALSE) AS is_instant_win,
    c.prize_value::TEXT AS prize_value,
    -- Also return the raw competition status for client-side double-checking
    COALESCE(c.status, 'completed') AS competition_status,
    c.end_date AS end_date
  FROM joincompetition jc
  LEFT JOIN competitions c ON (
    jc.competitionid::TEXT = c.id::TEXT
    OR jc.competitionid::TEXT = c.uid::TEXT
    OR (LENGTH(jc.competitionid) = 32 AND jc.competitionid = REPLACE(c.id::TEXT, '-', ''))
  )
  WHERE (
    -- ISSUE D FIX: Case-insensitive wallet address comparison using LOWER()
    jc.privy_user_id = user_identifier
    OR jc.userid = user_identifier
    OR LOWER(jc.walletaddress) = lower_identifier
    -- FIX: Also match by extracted wallet from prize:pid: format
    OR (search_wallet IS NOT NULL AND LOWER(jc.walletaddress) = search_wallet)
  )
  AND jc.competitionid IS NOT NULL
  AND LENGTH(TRIM(COALESCE(jc.competitionid, ''))) > 0
  ORDER BY COALESCE(jc.purchasedate::TIMESTAMPTZ, jc.created_at::TIMESTAMPTZ, NOW()) DESC;

  -- Collect deduplication keys from joincompetition results
  SELECT
    COALESCE(
      ARRAY_AGG(DISTINCT jc.transactionhash) FILTER (WHERE jc.transactionhash IS NOT NULL AND jc.transactionhash != '' AND jc.transactionhash != 'no-hash'),
      ARRAY[]::TEXT[]
    ),
    COALESCE(
      ARRAY_AGG(DISTINCT (jc.competitionid || '|' || COALESCE(jc.ticketnumbers, ''))) FILTER (WHERE jc.ticketnumbers IS NOT NULL),
      ARRAY[]::TEXT[]
    ),
    COALESCE(
      ARRAY_AGG(DISTINCT (jc.competitionid || '|' || COALESCE(jc.privy_user_id, jc.userid, LOWER(jc.walletaddress), ''))),
      ARRAY[]::TEXT[]
    )
  INTO seen_tx_hashes, seen_ticket_sets, seen_competition_user_pairs
  FROM joincompetition jc
  WHERE (
    jc.privy_user_id = user_identifier
    OR jc.userid = user_identifier
    OR LOWER(jc.walletaddress) = lower_identifier
    OR (search_wallet IS NOT NULL AND LOWER(jc.walletaddress) = search_wallet)
  )
  AND jc.competitionid IS NOT NULL;

  -- ============================================================================
  -- QUERY 2: tickets table (SECONDARY source - catches entries where joincompetition insert failed)
  -- Only include if NOT already in joincompetition (dedupe by user+competition pair)
  -- ============================================================================
  RETURN QUERY
  SELECT
    ('tickets-' || t.privy_user_id || '-' || t.competition_id::TEXT)::TEXT AS id,
    t.competition_id AS competition_id,
    COALESCE(c.title, 'Competition #' || LEFT(t.competition_id::TEXT, 8)) AS title,
    COALESCE(c.description, '') AS description,
    COALESCE(c.image_url, '') AS image,
    -- ISSUE B/C FIX: Same end_date-based status calculation
    CASE
      WHEN c.id IS NULL THEN 'completed'
      WHEN c.status IN ('completed', 'drawn', 'drawing') THEN 'drawn'
      WHEN c.status = 'cancelled' THEN 'cancelled'
      WHEN c.status = 'active' AND c.end_date IS NOT NULL AND c.end_date < NOW() THEN 'drawn'
      WHEN c.status = 'active' THEN 'live'
      ELSE 'live'
    END AS status,
    'completed_from_tickets'::TEXT AS entry_type,
    NULL::TIMESTAMPTZ AS expires_at,
    -- FIX: Use winner_address (correct column) for tickets table too
    FALSE AS is_winner, -- tickets table doesn't store wallet, so we can't determine winner here
    string_agg(t.ticket_number::TEXT, ',' ORDER BY t.ticket_number) AS ticket_numbers,
    COUNT(*)::INTEGER AS number_of_tickets,
    COALESCE(SUM(t.purchase_price), 0)::NUMERIC AS amount_spent,
    MIN(t.created_at)::TIMESTAMPTZ AS purchase_date,
    NULL::TEXT AS wallet_address,
    NULL::TEXT AS transaction_hash,
    COALESCE(c.is_instant_win, FALSE) AS is_instant_win,
    c.prize_value::TEXT AS prize_value,
    COALESCE(c.status, 'completed') AS competition_status,
    c.end_date AS end_date
  FROM tickets t
  LEFT JOIN competitions c ON t.competition_id = c.id
  WHERE t.privy_user_id = user_identifier
  AND t.competition_id IS NOT NULL
  -- ISSUE A FIX: Dedupe by competition+user pair (not already in joincompetition)
  AND NOT ((t.competition_id::TEXT || '|' || t.privy_user_id) = ANY(seen_competition_user_pairs))
  GROUP BY t.privy_user_id, t.competition_id, c.id, c.uid, c.title, c.description, c.image_url, c.status, c.end_date, c.is_instant_win, c.prize_value;

  -- ============================================================================
  -- QUERY 3: user_transactions table (TERTIARY source - for payment-based entries)
  -- Only include entries NOT already found via joincompetition or tickets
  -- ============================================================================
  RETURN QUERY
  SELECT
    ut.id::TEXT AS id,
    ut.competition_id AS competition_id,
    COALESCE(c.title, 'Competition #' || LEFT(ut.competition_id::TEXT, 8)) AS title,
    COALESCE(c.description, '') AS description,
    COALESCE(c.image_url, '') AS image,
    -- ISSUE B/C FIX: Same end_date-based status calculation
    CASE
      WHEN c.id IS NULL THEN 'completed'
      WHEN c.status IN ('completed', 'drawn', 'drawing') THEN 'drawn'
      WHEN c.status = 'cancelled' THEN 'cancelled'
      WHEN c.status = 'active' AND c.end_date IS NOT NULL AND c.end_date < NOW() THEN 'drawn'
      WHEN c.status = 'active' THEN 'live'
      ELSE 'live'
    END AS status,
    'completed_from_transaction'::TEXT AS entry_type,
    NULL::TIMESTAMPTZ AS expires_at,
    -- FIX: Use winner_address (correct column) - check wallet against winner
    COALESCE((LOWER(ut.wallet_address) = LOWER(c.winner_address)), FALSE) AS is_winner,
    ut.ticket_numbers AS ticket_numbers,
    COALESCE(ut.ticket_count, 0) AS number_of_tickets,
    COALESCE(ut.amount, 0) AS amount_spent,
    ut.created_at AS purchase_date,
    ut.wallet_address AS wallet_address,
    ut.tx_id AS transaction_hash,
    COALESCE(c.is_instant_win, FALSE) AS is_instant_win,
    c.prize_value::TEXT AS prize_value,
    COALESCE(c.status, 'completed') AS competition_status,
    c.end_date AS end_date
  FROM user_transactions ut
  LEFT JOIN competitions c ON ut.competition_id = c.id
  WHERE (
    -- ISSUE D FIX: Case-insensitive wallet address comparison
    ut.user_id = user_identifier
    OR ut.user_privy_id = user_identifier
    OR LOWER(ut.wallet_address) = lower_identifier
    OR (search_wallet IS NOT NULL AND LOWER(ut.wallet_address) = search_wallet)
  )
  AND ut.competition_id IS NOT NULL
  -- Only include finished/completed transactions (successful payments)
  AND (
    LOWER(ut.status) IN ('finished', 'completed', 'confirmed', 'success')
    OR LOWER(ut.payment_status) IN ('finished', 'completed', 'confirmed', 'success')
  )
  -- ISSUE A FIX: Dedupe by tx hash (not already in joincompetition)
  AND (ut.tx_id IS NULL OR ut.tx_id = '' OR ut.tx_id = 'no-hash' OR NOT (ut.tx_id = ANY(seen_tx_hashes)))
  -- ISSUE A FIX: Also dedupe by ticket set
  AND NOT ((ut.competition_id::TEXT || '|' || COALESCE(ut.ticket_numbers, '')) = ANY(seen_ticket_sets))
  ORDER BY ut.created_at DESC;

  -- ============================================================================
  -- QUERY 4: pending_tickets table (for reservations awaiting payment)
  -- ============================================================================
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
    c.prize_value::TEXT AS prize_value,
    COALESCE(c.status, 'active') AS competition_status,
    c.end_date AS end_date
  FROM pending_tickets pt
  LEFT JOIN competitions c ON pt.competition_id = c.id
  WHERE (
    -- ISSUE D FIX: Case-insensitive user_id comparison
    pt.user_id = user_identifier
    OR LOWER(pt.user_id) = lower_identifier
    -- FIX: Also match by extracted wallet from prize:pid: format
    OR (search_wallet IS NOT NULL AND LOWER(pt.user_id) = search_wallet)
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
'Returns all user entries from multiple tables with comprehensive deduplication.
FIX: Uses correct column name winner_address (not winner_wallet_address) for winner determination.
This fixes the bug where users who won competitions were incorrectly shown as losing.';
