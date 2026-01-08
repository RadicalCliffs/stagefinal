/*
  # Fix Comprehensive User Dashboard Entries - Handle Unknown Competitions

  ## Problem
  The `get_comprehensive_user_dashboard_entries` function displays "Unknown Competition" when:
  1. The competition has been deleted but entries remain in joincompetition
  2. The competitionid stored is in a different format (UUID id vs TEXT uid)
  3. Type casting issues between UUID and TEXT columns

  ## Solution
  1. Improve the JOIN condition to handle both UUID and TEXT formats
  2. Add COALESCE for competition fields to gracefully handle missing competitions
  3. Also include entries from the tickets table as a fallback
*/

-- Drop existing function
DROP FUNCTION IF EXISTS get_comprehensive_user_dashboard_entries(TEXT);

-- Helper function to safely cast text to UUID (returns NULL if invalid)
CREATE OR REPLACE FUNCTION safe_uuid_cast(input_text TEXT)
RETURNS UUID AS $$
BEGIN
  -- Check if input matches UUID format before casting
  IF input_text IS NULL THEN
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

-- Create improved version
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
BEGIN
  -- Handle null or empty identifier
  IF user_identifier IS NULL OR user_identifier = '' THEN
    RETURN;
  END IF;

  -- First, return entries from joincompetition (confirmed entries)
  -- Improved JOIN to handle both UUID and TEXT competitionid formats
  -- Use safe_uuid_cast to handle invalid UUID values gracefully
  RETURN QUERY
  SELECT
    COALESCE(jc.uid, jc.id::TEXT) AS id,
    COALESCE(c.id, safe_uuid_cast(jc.competitionid)) AS competition_id,
    COALESCE(c.title, 'Competition #' || LEFT(jc.competitionid::TEXT, 8)) AS title,
    COALESCE(c.description, '') AS description,
    COALESCE(c.image_url, '') AS image,
    CASE
      WHEN c.id IS NULL THEN 'ended'  -- Competition deleted/not found
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
    -- Try multiple matching strategies to handle format inconsistencies
    jc.competitionid::TEXT = c.id::TEXT
    OR jc.competitionid::TEXT = c.uid::TEXT
    OR (
      -- Handle case where competitionid is stored without dashes
      LENGTH(jc.competitionid) = 32 AND
      jc.competitionid = REPLACE(c.id::TEXT, '-', '')
    )
  )
  WHERE (
    jc.privy_user_id = user_identifier
    OR jc.userid = user_identifier
    OR jc.walletaddress = user_identifier
  )
  -- Only include entries with valid competition IDs (skip entries with regex patterns or invalid data)
  AND (c.id IS NOT NULL OR jc.competitionid ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
  ORDER BY COALESCE(jc.purchasedate::TIMESTAMPTZ, jc.created_at::TIMESTAMPTZ) DESC;

  -- Collect competition IDs and user-comp pairs from joincompetition to avoid duplicates
  -- Use safe_uuid_cast to avoid errors on invalid UUID values
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
    OR jc.walletaddress = user_identifier
  )
  -- Only include entries with valid UUID format competition IDs
  AND (c.id IS NOT NULL OR jc.competitionid ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');

  -- If no entries were found in joincompetition, initialize empty arrays
  IF seen_competition_ids IS NULL THEN
    seen_competition_ids := ARRAY[]::UUID[];
  END IF;
  IF seen_user_comp_pairs IS NULL THEN
    seen_user_comp_pairs := ARRAY[]::TEXT[];
  END IF;

  -- Return entries from tickets table that don't have corresponding joincompetition entries
  -- This catches purchases where joincompetition insert failed
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
    -- Exclude entries that already have joincompetition records
    AND NOT ((t.competition_id::TEXT || '|' || t.privy_user_id) = ANY(seen_user_comp_pairs))
  GROUP BY t.competition_id, t.privy_user_id, c.id, c.title, c.description, c.image_url,
           c.status, c.is_instant_win, c.prize_value, c.end_date
  ORDER BY MIN(t.created_at) DESC;

  -- Return entries from user_transactions with status 'finished'
  -- Skip entries for competitions already covered above
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
    OR ut.wallet_address = user_identifier
  )
  AND ut.status = 'finished'
  AND ut.competition_id IS NOT NULL
  -- Only include entries with valid UUID format competition IDs
  AND ut.competition_id::TEXT ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  AND NOT (safe_uuid_cast(ut.competition_id::TEXT) = ANY(seen_competition_ids))
  ORDER BY ut.created_at DESC;

  -- Return pending entries from pending_tickets
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
'Returns all user entries from joincompetition, tickets (fallback), user_transactions, and pending_tickets tables. Handles missing competitions gracefully and supports multiple ID formats.';
