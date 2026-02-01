-- EMERGENCY FIX: Add joincompetition to dashboard queries
-- The get_comprehensive_user_dashboard_entries function was only querying
-- competition_entries and user_transactions, but user data is in joincompetition!

BEGIN;

-- Fix get_comprehensive_user_dashboard_entries to include joincompetition data
CREATE OR REPLACE FUNCTION get_comprehensive_user_dashboard_entries(p_user_identifier TEXT)
RETURNS TABLE (
  id TEXT,
  competition_id TEXT,
  title TEXT,
  description TEXT,
  image TEXT,
  status TEXT,
  entry_type TEXT,
  is_winner BOOLEAN,
  ticket_numbers TEXT,
  total_tickets INTEGER,
  total_amount_spent NUMERIC,
  purchase_date TIMESTAMPTZ,
  transaction_hash TEXT,
  is_instant_win BOOLEAN,
  prize_value NUMERIC,
  competition_status TEXT,
  end_date TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_canonical_user_id TEXT;
  search_wallet TEXT;
BEGIN
  -- Extract wallet from prize:pid: format
  IF p_user_identifier LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(p_user_identifier FROM 11));
  ELSIF p_user_identifier LIKE '0x%' THEN
    search_wallet := LOWER(p_user_identifier);
  END IF;

  -- Resolve canonical user ID
  SELECT canonical_user_id INTO v_canonical_user_id
  FROM canonical_users
  WHERE canonical_user_id = p_user_identifier
     OR uid = p_user_identifier
     OR (search_wallet IS NOT NULL AND LOWER(wallet_address) = search_wallet)
     OR (search_wallet IS NOT NULL AND LOWER(base_wallet_address) = search_wallet)
  LIMIT 1;

  IF v_canonical_user_id IS NULL THEN
    RETURN;
  END IF;

  -- Return dashboard entries from multiple sources INCLUDING joincompetition
  RETURN QUERY
  WITH user_entries AS (
    -- Source 1: competition_entries table
    SELECT DISTINCT
      ce.id,
      ce.competition_id,
      c.title,
      c.description,
      c.image_url AS image,
      c.status AS competition_status,
      'competition_entry' AS entry_type,
      ce.is_winner,
      ce.ticket_numbers_csv AS ticket_numbers,
      ce.tickets_count AS total_tickets,
      ce.amount_spent AS total_amount_spent,
      ce.latest_purchase_at AS purchase_date,
      NULL::TEXT AS transaction_hash,
      c.is_instant_win,
      NULL::NUMERIC AS prize_value,
      c.end_time AS end_date
    FROM competition_entries ce
    LEFT JOIN competitions c ON ce.competition_id = c.id OR ce.competition_id = c.uid
    WHERE ce.canonical_user_id = v_canonical_user_id

    UNION ALL

    -- Source 2: user_transactions table
    SELECT DISTINCT
      ut.id,
      ut.competition_id,
      c.title,
      c.description,
      c.image_url AS image,
      c.status AS competition_status,
      'transaction' AS entry_type,
      false AS is_winner,
      ut.ticket_numbers,
      ut.ticket_count AS total_tickets,
      ut.amount AS total_amount_spent,
      ut.created_at AS purchase_date,
      ut.transaction_hash,
      c.is_instant_win,
      NULL::NUMERIC AS prize_value,
      c.end_time AS end_date
    FROM user_transactions ut
    LEFT JOIN competitions c ON ut.competition_id = c.id OR ut.competition_id = c.uid
    WHERE (ut.user_id = v_canonical_user_id OR ut.canonical_user_id = v_canonical_user_id)
      AND ut.payment_status IN ('completed', 'confirmed')
      AND ut.competition_id IS NOT NULL

    UNION ALL

    -- Source 3: joincompetition table (CRITICAL - where old data is!)
    SELECT DISTINCT
      jc.uid AS id,
      jc.competitionid AS competition_id,
      c.title,
      c.description,
      c.image_url AS image,
      c.status AS competition_status,
      'joincompetition' AS entry_type,
      false AS is_winner,
      jc.ticketnumbers AS ticket_numbers,
      jc.numberoftickets AS total_tickets,
      jc.amountspent AS total_amount_spent,
      jc.purchasedate AS purchase_date,
      jc.transactionhash AS transaction_hash,
      c.is_instant_win,
      NULL::NUMERIC AS prize_value,
      c.end_time AS end_date
    FROM joincompetition jc
    LEFT JOIN competitions c ON jc.competitionid = c.id::TEXT OR jc.competitionid = c.uid
    WHERE jc.canonical_user_id = v_canonical_user_id
       OR jc.userid = v_canonical_user_id
       OR jc.privy_user_id = v_canonical_user_id
       OR (search_wallet IS NOT NULL AND LOWER(jc.wallet_address) = search_wallet)
  )
  SELECT DISTINCT ON (ue.competition_id)
    ue.id,
    ue.competition_id,
    ue.title,
    ue.description,
    ue.image,
    CASE 
      WHEN ue.competition_status = 'sold_out' THEN 'sold_out'
      WHEN ue.competition_status = 'active' THEN 'live'
      ELSE ue.competition_status
    END AS status,
    ue.entry_type,
    ue.is_winner,
    ue.ticket_numbers,
    ue.total_tickets,
    ue.total_amount_spent,
    ue.purchase_date,
    ue.transaction_hash,
    ue.is_instant_win,
    ue.prize_value,
    ue.competition_status,
    ue.end_date
  FROM user_entries ue
  ORDER BY ue.competition_id, ue.purchase_date DESC;
END;
$$;

COMMIT;

-- Also fix get_user_competition_entries to include joincompetition
CREATE OR REPLACE FUNCTION get_user_competition_entries(p_user_identifier TEXT)
RETURNS TABLE (
  competition_id TEXT,
  competition_title TEXT,
  tickets_count INTEGER,
  amount_spent NUMERIC,
  is_winner BOOLEAN,
  latest_purchase_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_canonical_user_id TEXT;
  search_wallet TEXT;
BEGIN
  -- Extract wallet
  IF p_user_identifier LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(p_user_identifier FROM 11));
  ELSIF p_user_identifier LIKE '0x%' THEN
    search_wallet := LOWER(p_user_identifier);
  END IF;

  -- Resolve user
  SELECT canonical_user_id INTO v_canonical_user_id
  FROM canonical_users
  WHERE canonical_user_id = p_user_identifier
     OR uid = p_user_identifier
     OR (search_wallet IS NOT NULL AND LOWER(wallet_address) = search_wallet)
  LIMIT 1;

  -- Return entries from both competition_entries AND joincompetition
  RETURN QUERY
  WITH all_entries AS (
    -- From competition_entries
    SELECT 
      ce.competition_id,
      c.title AS competition_title,
      ce.tickets_count,
      ce.amount_spent,
      ce.is_winner,
      ce.latest_purchase_at
    FROM competition_entries ce
    LEFT JOIN competitions c ON ce.competition_id = c.id OR ce.competition_id = c.uid
    WHERE ce.canonical_user_id = v_canonical_user_id

    UNION ALL

    -- From joincompetition (where old data is!)
    SELECT
      jc.competitionid AS competition_id,
      c.title AS competition_title,
      jc.numberoftickets AS tickets_count,
      jc.amountspent AS amount_spent,
      false AS is_winner,
      jc.purchasedate AS latest_purchase_at
    FROM joincompetition jc
    LEFT JOIN competitions c ON jc.competitionid = c.id::TEXT OR jc.competitionid = c.uid
    WHERE jc.canonical_user_id = v_canonical_user_id
       OR jc.userid = v_canonical_user_id
       OR jc.privy_user_id = v_canonical_user_id
       OR (search_wallet IS NOT NULL AND LOWER(jc.wallet_address) = search_wallet)
  )
  SELECT DISTINCT ON (ae.competition_id)
    ae.competition_id,
    ae.competition_title,
    ae.tickets_count,
    ae.amount_spent,
    ae.is_winner,
    ae.latest_purchase_at
  FROM all_entries ae
  ORDER BY ae.competition_id, ae.latest_purchase_at DESC;
END;
$$;
