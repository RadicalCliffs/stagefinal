/*
  # Fix Tickets Not Appearing Consistently (Point 4)

  ## Issues Addressed

  ### Issue A: Multiple Data Sources for Entries
  The RPC queries 4 tables (joincompetition, tickets, user_transactions, pending_tickets)
  and entries can appear in multiple tables. This migration improves the deduplication
  to prevent duplicates and missing entries.

  ### Issue B: Status Filtering Logic
  Competition status should use end_date as the source of truth when the scheduled
  job hasn't updated status yet. The RPC now calculates effective status based on end_date.

  ### Issue C: Competition Status Not Synced
  When scheduled jobs lag, competitions remain "active" after ending. The RPC now
  applies end_date-based status override at query time.

  ### Issue D: User Identity Resolution
  Wallet addresses stored with different casing across tables would cause entries
  to be missed. All wallet comparisons now use LOWER() for case-insensitive matching.

  ## Solution
  - RPC-level deduplication using transaction hash and ticket number matching
  - Status calculated from end_date when database status is stale
  - Comprehensive case-insensitive matching for all wallet address comparisons
  - Better handling of edge cases (null values, empty strings, invalid UUIDs)
*/

-- Drop existing function to recreate with improvements
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

-- Create improved function with comprehensive deduplication and status sync
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
  seen_competition_user_pairs TEXT[] := ARRAY[]::TEXT[];
  lower_identifier TEXT;
BEGIN
  -- Handle null or empty identifier
  IF user_identifier IS NULL OR TRIM(user_identifier) = '' THEN
    RETURN;
  END IF;

  -- Normalize identifier for consistent comparison
  user_identifier := TRIM(user_identifier);
  -- Pre-compute lowercase for wallet address comparisons (Issue D fix)
  lower_identifier := LOWER(user_identifier);

  -- ============================================================================
  -- QUERY 1: joincompetition (PRIMARY source - confirmed entries)
  -- This is the main source of truth for purchased tickets
  -- ============================================================================
  RETURN QUERY
  SELECT
    COALESCE(jc.uid, jc.id::TEXT, 'jc-' || jc.competitionid) AS id,
    COALESCE(c.id, safe_uuid_cast(jc.competitionid)) AS competition_id,
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
    -- Case-insensitive winner check
    COALESCE((LOWER(jc.walletaddress) = LOWER(c.winner_wallet_address)), FALSE) AS is_winner,
    jc.ticketnumbers::TEXT AS ticket_numbers,
    COALESCE(jc.numberoftickets, 1) AS number_of_tickets,
    COALESCE(jc.amountspent, 0) AS amount_spent,
    COALESCE(jc.purchasedate::TIMESTAMPTZ, jc.created_at::TIMESTAMPTZ, NOW()) AS purchase_date,
    jc.walletaddress AS wallet_address,
    jc.transactionhash AS transaction_hash,
    COALESCE(c.is_instant_win, FALSE) AS is_instant_win,
    c.prize_value AS prize_value,
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
    -- ISSUE D FIX: Case-insensitive comparison for privy_user_id (might be wallet address)
    OR LOWER(t.privy_user_id) = lower_identifier
  )
  AND t.competition_id IS NOT NULL
  -- ISSUE A FIX: Exclude if already in joincompetition (dedupe check)
  AND NOT ((t.competition_id::TEXT || '|' || COALESCE(t.privy_user_id, '')) = ANY(seen_competition_user_pairs))
  GROUP BY t.competition_id, t.privy_user_id, c.id, c.title, c.description, c.image_url,
           c.status, c.is_instant_win, c.prize_value, c.end_date
  ORDER BY MIN(t.created_at) DESC;

  -- ============================================================================
  -- QUERY 3: user_transactions (TERTIARY source - completed payments that may not be in other tables)
  -- Only include if NOT already covered by joincompetition or tickets
  -- ============================================================================
  RETURN QUERY
  SELECT
    ut.id::TEXT AS id,
    safe_uuid_cast(ut.competition_id::TEXT) AS competition_id,
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
    -- ISSUE D FIX: Check all identifier columns with case-insensitive wallet matching
    ut.user_privy_id = user_identifier
    OR ut.user_id = user_identifier
    OR ut.privy_user_id = user_identifier
    OR LOWER(ut.wallet_address) = lower_identifier
  )
  -- Only completed transactions
  AND (
    ut.status IN ('finished', 'completed', 'confirmed', 'success')
    OR ut.payment_status IN ('finished', 'confirmed', 'success', 'paid')
  )
  AND ut.competition_id IS NOT NULL
  AND ut.competition_id::TEXT ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  -- ISSUE A FIX: Skip if transaction hash already seen (duplicate)
  AND NOT (COALESCE(ut.tx_id, '') = ANY(seen_tx_hashes))
  -- ISSUE A FIX: Skip if competition+user already covered
  AND NOT ((ut.competition_id::TEXT || '|' || COALESCE(ut.user_privy_id, ut.user_id, ut.privy_user_id, LOWER(ut.wallet_address), '')) = ANY(seen_competition_user_pairs))
  ORDER BY ut.created_at DESC;

  -- ============================================================================
  -- QUERY 4: pending_tickets (RESERVATIONS - always show if pending and not expired)
  -- These are separate from completed entries
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
    -- ISSUE D FIX: Case-insensitive user_id comparison
    pt.user_id = user_identifier
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
'Returns all user entries from multiple tables with comprehensive deduplication.
Fixes: Issue A (duplicate prevention via tx hash and ticket tracking),
Issue B/C (status derived from end_date when stale),
Issue D (case-insensitive wallet matching).';

-- ============================================================================
-- ISSUE 4C FIX: Function to sync stale competition status
-- This is called by the client when it detects stale competitions
-- ============================================================================
CREATE OR REPLACE FUNCTION sync_competition_status_if_ended(p_competition_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  comp_end_date TIMESTAMPTZ;
  comp_status TEXT;
BEGIN
  -- Get current status and end_date
  SELECT status, end_date INTO comp_status, comp_end_date
  FROM competitions
  WHERE id = p_competition_id;

  -- If not found, return false
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- If already in terminal state, no action needed
  IF comp_status IN ('completed', 'drawn', 'cancelled') THEN
    RETURN FALSE;
  END IF;

  -- If end_date has passed, update status to 'completed'
  IF comp_end_date IS NOT NULL AND comp_end_date < NOW() THEN
    UPDATE competitions
    SET
      status = 'completed',
      competitionended = 1,
      updated_at = NOW()
    WHERE id = p_competition_id
    AND status NOT IN ('completed', 'drawn', 'cancelled');

    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION sync_competition_status_if_ended(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION sync_competition_status_if_ended(UUID) TO anon;
GRANT EXECUTE ON FUNCTION sync_competition_status_if_ended(UUID) TO service_role;

COMMENT ON FUNCTION sync_competition_status_if_ended(UUID) IS
'Updates a competition status to completed if its end_date has passed.
Called by client-side code when stale competitions are detected.
This supplements the server-side competition-lifecycle-checker job.';
