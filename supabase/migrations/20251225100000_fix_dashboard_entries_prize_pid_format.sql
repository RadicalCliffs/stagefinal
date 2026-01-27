/*
  # Fix Dashboard Entries RPC to Handle prize:pid: Format

  ## Problem
  The `get_comprehensive_user_dashboard_entries` function doesn't properly handle
  the canonical `prize:pid:0x...` format used by the frontend. When a user identifier
  like `prize:pid:0x1234...` is passed, the function compares it against stored
  wallet addresses that are in plain `0x1234...` format.

  This causes entries to not be found because:
  - `LOWER('prize:pid:0x1234...')` = `prize:pid:0x1234...`
  - `LOWER(wallet_address)` = `0x1234...`
  - These never match!

  ## Root Cause
  The frontend AuthContext converts wallet addresses to canonical `prize:pid:` format
  using `toPrizePid()` before calling RPC functions. However, the RPC function doesn't
  extract the actual wallet address from this format.

  The `get_user_wallet_balance` function (from migration 20251224000000) correctly
  handles this by extracting the wallet:
  ```sql
  IF user_identifier LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(user_identifier FROM 11));
  ```

  But `get_comprehensive_user_dashboard_entries` doesn't have this logic.

  ## Solution
  Add the same wallet address extraction logic to extract the actual wallet address
  from `prize:pid:0x...` format, then use both the original identifier AND the
  extracted wallet for comparisons.
*/

-- Drop existing function to recreate with fix
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

-- Create improved function with prize:pid: format handling
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
  seen_ticket_sets TEXT[] := ARRAY[]::TEXT[];
  seen_competition_user_pairs TEXT[] := ARRAY[]::TEXT[];
  lower_identifier TEXT;
  -- NEW: Extracted wallet address from prize:pid: format
  search_wallet TEXT := NULL;
BEGIN
  -- Handle null or empty identifier
  IF user_identifier IS NULL OR TRIM(user_identifier) = '' THEN
    RETURN;
  END IF;

  -- Normalize identifier for consistent comparison
  user_identifier := TRIM(user_identifier);
  -- Pre-compute lowercase for comparisons
  lower_identifier := LOWER(user_identifier);

  -- ============================================================================
  -- FIX: Extract wallet address from prize:pid: format
  -- This matches the logic in get_user_wallet_balance function
  -- ============================================================================
  IF user_identifier LIKE 'prize:pid:0x%' THEN
    -- Extract the wallet address after 'prize:pid:' prefix (11 characters)
    search_wallet := LOWER(SUBSTRING(user_identifier FROM 11));
  ELSIF user_identifier LIKE '0x%' AND LENGTH(user_identifier) = 42 THEN
    -- Already a wallet address
    search_wallet := LOWER(user_identifier);
  END IF;

  -- ============================================================================
  -- QUERY 1: joincompetition (PRIMARY source - confirmed entries)
  -- ============================================================================
  RETURN QUERY
  SELECT
    COALESCE(jc.uid, jc.id::TEXT, 'jc-' || jc.competitionid) AS id,
    COALESCE(c.id, safe_uuid_cast(jc.competitionid)) AS competition_id,
    COALESCE(c.title, 'Competition (Ended)') AS title,
    COALESCE(c.description, '') AS description,
    COALESCE(c.image_url, '') AS image,
    -- Calculate effective status from end_date
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
    COALESCE((LOWER(jc.wallet_address) = LOWER(c.winner_wallet_address)), FALSE) AS is_winner,
    jc.ticketnumbers::TEXT AS ticket_numbers,
    COALESCE(jc.numberoftickets, 1) AS number_of_tickets,
    COALESCE(jc.amountspent, 0) AS amount_spent,
    COALESCE(jc.purchasedate::TIMESTAMPTZ, jc.created_at::TIMESTAMPTZ, NOW()) AS purchase_date,
    jc.wallet_address AS wallet_address,
    jc.transactionhash AS transaction_hash,
    COALESCE(c.is_instant_win, FALSE) AS is_instant_win,
    c.prize_value AS prize_value,
    COALESCE(c.status, 'completed') AS competition_status,
    c.end_date AS end_date
  FROM joincompetition jc
  LEFT JOIN competitions c ON (
    jc.competitionid::TEXT = c.id::TEXT
    OR jc.competitionid::TEXT = c.uid::TEXT
    OR (LENGTH(jc.competitionid) = 32 AND jc.competitionid = REPLACE(c.id::TEXT, '-', ''))
  )
  WHERE (
    -- Match by privy_user_id or userid columns (exact match)
    jc.privy_user_id = user_identifier
    OR jc.userid = user_identifier
    -- Match by lower_identifier (handles case where prize:pid: is stored in these columns)
    OR jc.privy_user_id = lower_identifier
    OR jc.userid = lower_identifier
    -- FIX: Match by extracted wallet address (handles prize:pid:0x... format)
    OR (search_wallet IS NOT NULL AND LOWER(jc.wallet_address) = search_wallet)
    -- Also try case-insensitive match on the full identifier
    OR LOWER(jc.wallet_address) = lower_identifier
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
      ARRAY_AGG(DISTINCT (jc.competitionid || '|' || COALESCE(jc.privy_user_id, jc.userid, LOWER(jc.wallet_address), ''))),
      ARRAY[]::TEXT[]
    )
  INTO seen_tx_hashes, seen_ticket_sets, seen_competition_user_pairs
  FROM joincompetition jc
  WHERE (
    jc.privy_user_id = user_identifier
    OR jc.userid = user_identifier
    OR jc.privy_user_id = lower_identifier
    OR jc.userid = lower_identifier
    OR (search_wallet IS NOT NULL AND LOWER(jc.wallet_address) = search_wallet)
    OR LOWER(jc.wallet_address) = lower_identifier
  )
  AND jc.competitionid IS NOT NULL;

  -- ============================================================================
  -- QUERY 2: tickets table (SECONDARY source)
  -- ============================================================================
  RETURN QUERY
  SELECT
    ('tickets-' || t.privy_user_id || '-' || t.competition_id::TEXT)::TEXT AS id,
    t.competition_id AS competition_id,
    COALESCE(c.title, 'Competition #' || LEFT(t.competition_id::TEXT, 8)) AS title,
    COALESCE(c.description, '') AS description,
    COALESCE(c.image_url, '') AS image,
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
    OR t.privy_user_id = lower_identifier
    -- FIX: Also check user_id column with extracted wallet
    OR t.user_id = user_identifier
    OR t.user_id = lower_identifier
    -- FIX: Match by extracted wallet (for prize:pid:0x... format stored in user_id)
    OR (search_wallet IS NOT NULL AND LOWER(t.user_id) = search_wallet)
    OR (search_wallet IS NOT NULL AND LOWER(t.privy_user_id) = search_wallet)
  )
  AND t.competition_id IS NOT NULL
  AND NOT ((t.competition_id::TEXT || '|' || COALESCE(t.privy_user_id, '')) = ANY(seen_competition_user_pairs))
  GROUP BY t.competition_id, t.privy_user_id, c.id, c.title, c.description, c.image_url,
           c.status, c.is_instant_win, c.prize_value, c.end_date
  ORDER BY MIN(t.created_at) DESC;

  -- ============================================================================
  -- QUERY 3: user_transactions (TERTIARY source)
  -- ============================================================================
  RETURN QUERY
  SELECT
    ut.id::TEXT AS id,
    safe_uuid_cast(ut.competition_id::TEXT) AS competition_id,
    COALESCE(c.title, 'Competition #' || LEFT(ut.competition_id::TEXT, 8)) AS title,
    COALESCE(c.description, '') AS description,
    COALESCE(c.image_url, '') AS image,
    CASE
      WHEN c.id IS NULL THEN 'completed'
      WHEN c.status IN ('completed', 'drawn', 'drawing') THEN 'drawn'
      WHEN c.status = 'cancelled' THEN 'cancelled'
      WHEN c.status = 'active' AND c.end_date IS NOT NULL AND c.end_date < NOW() THEN 'drawn'
      WHEN c.status = 'active' THEN 'live'
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
    OR ut.user_privy_id = lower_identifier
    OR ut.user_id = lower_identifier
    OR ut.privy_user_id = lower_identifier
    -- FIX: Match by extracted wallet address
    OR (search_wallet IS NOT NULL AND LOWER(ut.wallet_address) = search_wallet)
    OR LOWER(ut.wallet_address) = lower_identifier
  )
  AND (
    ut.status IN ('finished', 'completed', 'confirmed', 'success')
    OR ut.payment_status IN ('finished', 'confirmed', 'success', 'paid')
  )
  AND ut.competition_id IS NOT NULL
  AND ut.competition_id::TEXT ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  AND NOT (COALESCE(ut.tx_id, '') = ANY(seen_tx_hashes))
  AND NOT ((ut.competition_id::TEXT || '|' || COALESCE(ut.user_privy_id, ut.user_id, ut.privy_user_id, LOWER(ut.wallet_address), '')) = ANY(seen_competition_user_pairs))
  ORDER BY ut.created_at DESC;

  -- ============================================================================
  -- QUERY 4: pending_tickets (RESERVATIONS)
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
    c.prize_value AS prize_value,
    COALESCE(c.status, 'active') AS competition_status,
    c.end_date AS end_date
  FROM pending_tickets pt
  LEFT JOIN competitions c ON pt.competition_id = c.id
  WHERE (
    pt.user_id = user_identifier
    OR pt.user_id = lower_identifier
    -- FIX: Match by extracted wallet address from prize:pid: format
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
Fixed to properly handle prize:pid:0x... format by extracting the wallet address.
This matches the logic in get_user_wallet_balance function.';


-- ============================================================================
-- Also fix get_user_active_tickets to handle prize:pid: format
-- ============================================================================
DROP FUNCTION IF EXISTS get_user_active_tickets(TEXT);

CREATE OR REPLACE FUNCTION get_user_active_tickets(user_identifier TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  ticket_count INTEGER;
  search_wallet TEXT := NULL;
  lower_identifier TEXT;
BEGIN
  -- Handle null or empty identifier
  IF user_identifier IS NULL OR user_identifier = '' THEN
    RETURN 0;
  END IF;

  -- Pre-compute lowercase
  lower_identifier := LOWER(user_identifier);

  -- Extract wallet address from prize:pid: format if present
  IF user_identifier LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(user_identifier FROM 11));
  ELSIF user_identifier LIKE '0x%' AND LENGTH(user_identifier) = 42 THEN
    search_wallet := LOWER(user_identifier);
  END IF;

  -- Count tickets in active (live) competitions
  -- Query by privy_user_id, userid, or walletaddress
  -- JOIN on both c.id and c.uid to support new and legacy competition entries
  -- FIX: Handle prize:pid: format by extracting wallet address
  SELECT COALESCE(SUM(jc.numberoftickets), 0)::INTEGER INTO ticket_count
  FROM joincompetition jc
  INNER JOIN competitions c ON (
    jc.competitionid::text = c.id::text
    OR jc.competitionid::text = c.uid::text
  )
  WHERE (
    jc.privy_user_id = user_identifier
    OR jc.userid = user_identifier
    OR jc.privy_user_id = lower_identifier
    OR jc.userid = lower_identifier
    -- FIX: Match by extracted wallet address (handles prize:pid:0x... format)
    OR (search_wallet IS NOT NULL AND LOWER(jc.wallet_address) = search_wallet)
    -- Also case-insensitive match on full identifier
    OR LOWER(jc.wallet_address) = lower_identifier
  )
  AND c.status IN ('live', 'active');

  RETURN COALESCE(ticket_count, 0);
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_user_active_tickets(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_active_tickets(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_user_active_tickets(TEXT) TO service_role;

-- Add helpful comment
COMMENT ON FUNCTION get_user_active_tickets(TEXT) IS
'Returns count of active tickets for a user. Fixed to properly handle prize:pid:0x... format.
Supports privy_user_id, userid, or wallet_address identifiers with case-insensitive wallet matching.';
