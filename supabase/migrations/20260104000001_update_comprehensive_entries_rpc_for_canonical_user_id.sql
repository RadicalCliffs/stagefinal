-- Update get_comprehensive_user_dashboard_entries to check canonical_user_id in pending_tickets
-- This ensures pending tickets are correctly matched regardless of how user_id is stored

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
    jc.uid::TEXT AS id,
    safe_uuid_cast(jc.competitionid::TEXT) AS competition_id,
    COALESCE(c.title, 'Unknown Competition') AS title,
    COALESCE(c.description, '') AS description,
    c.image_url AS image,
    CASE
      WHEN c.status = 'active' THEN 'live'
      WHEN c.status IN ('completed', 'drawn', 'drawing') THEN 'drawn'
      WHEN c.status = 'cancelled' THEN 'cancelled'
      ELSE 'unknown'
    END AS status,
    'confirmed'::TEXT AS entry_type,
    NULL::TIMESTAMPTZ AS expires_at,
    (w.winner_id IS NOT NULL) AS is_winner,
    COALESCE(jc.ticketnumbers, '') AS ticket_numbers,
    COALESCE(jc.numberoftickets, 0) AS number_of_tickets,
    COALESCE(jc.amountspent, 0) AS amount_spent,
    jc.purchasedate AS purchase_date,
    jc.walletaddress AS wallet_address,
    jc.transactionhash AS transaction_hash,
    COALESCE(c.is_instant_win, FALSE) AS is_instant_win,
    c.prize_value AS prize_value,
    COALESCE(c.status, 'unknown') AS competition_status,
    c.end_date AS end_date
  FROM joincompetition jc
  LEFT JOIN competitions c ON safe_uuid_cast(jc.competitionid::TEXT) = c.id
  LEFT JOIN winners w ON w.competition_id = safe_uuid_cast(jc.competitionid::TEXT)
    AND (w.winner_id = jc.privy_user_id OR w.winner_id = jc.userid)
  WHERE (
    jc.privy_user_id = user_identifier
    OR jc.userid = user_identifier
    OR jc.walletaddress = user_identifier
  );

  -- Track seen competitions
  SELECT ARRAY_AGG(DISTINCT safe_uuid_cast(jc.competitionid::TEXT))
  INTO seen_competition_ids
  FROM joincompetition jc
  WHERE (
    jc.privy_user_id = user_identifier
    OR jc.userid = user_identifier
    OR jc.walletaddress = user_identifier
  );

  IF seen_competition_ids IS NULL THEN
    seen_competition_ids := ARRAY[]::UUID[];
  END IF;

  -- Return entries from user_transactions with status 'finished'
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
      ELSE 'unknown'
    END AS status,
    'confirmed'::TEXT AS entry_type,
    NULL::TIMESTAMPTZ AS expires_at,
    (w.winner_id IS NOT NULL) AS is_winner,
    ''::TEXT AS ticket_numbers,
    COALESCE(ut.ticket_count, 0) AS number_of_tickets,
    COALESCE(ut.amount, 0) AS amount_spent,
    COALESCE(ut.completed_at, ut.created_at) AS purchase_date,
    ut.wallet_address AS wallet_address,
    ut.tx_id AS transaction_hash,
    COALESCE(c.is_instant_win, FALSE) AS is_instant_win,
    c.prize_value AS prize_value,
    COALESCE(c.status, 'unknown') AS competition_status,
    c.end_date AS end_date
  FROM user_transactions ut
  LEFT JOIN competitions c ON ut.competition_id = c.id
  LEFT JOIN winners w ON w.competition_id = ut.competition_id
    AND w.winner_id = ut.user_id
  WHERE ut.user_id = user_identifier
  AND ut.status = 'finished'
  AND ut.competition_id IS NOT NULL
  AND ut.competition_id != '00000000-0000-0000-0000-000000000000'::UUID
  AND NOT (ut.competition_id = ANY(seen_competition_ids));

  -- Update seen competitions
  SELECT seen_competition_ids || ARRAY_AGG(DISTINCT ut.competition_id)
  INTO seen_competition_ids
  FROM user_transactions ut
  WHERE ut.user_id = user_identifier
  AND ut.status = 'finished'
  AND ut.competition_id IS NOT NULL;

  -- Return pending tickets (awaiting payment confirmation)
  -- UPDATED: Also check canonical_user_id for matching
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
    ARRAY_TO_STRING(pt.ticket_numbers, ',') AS ticket_numbers,
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
    OR pt.canonical_user_id = user_identifier
  )
  AND pt.status = 'pending'
  AND pt.expires_at > NOW()
  ORDER BY pt.created_at DESC;
END;
$$;

-- Ensure permissions are set
GRANT EXECUTE ON FUNCTION get_comprehensive_user_dashboard_entries(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_comprehensive_user_dashboard_entries(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_comprehensive_user_dashboard_entries(TEXT) TO service_role;

-- Add helpful comment
COMMENT ON FUNCTION get_comprehensive_user_dashboard_entries(TEXT) IS
'Returns all user entries from joincompetition, user_transactions, and pending_tickets tables. 
Handles missing competitions gracefully, supports multiple ID formats, and checks both user_id and canonical_user_id for pending tickets.';
