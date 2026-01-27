-- ============================================================================
-- FIX TICKETS TABLE QUERIES TO USE CANONICAL_USER_ID
-- ============================================================================
-- This migration fixes all RPC functions that query the tickets table to use
-- canonical_user_id instead of the non-existent t.privy_user_id column.
--
-- The tickets table has:
-- - user_id (TEXT) - contains wallet addresses
-- - canonical_user_id (TEXT) - added in previous migration
-- But NOT privy_user_id!
--
-- This fixes queries in:
-- - get_comprehensive_user_dashboard_entries
-- - get_user_tickets
-- - And any other functions referencing t.privy_user_id
-- ============================================================================

-- Fix get_comprehensive_user_dashboard_entries to use canonical_user_id
-- This function is used by the user dashboard to show all entries
CREATE OR REPLACE FUNCTION public.get_comprehensive_user_dashboard_entries(user_identifier TEXT)
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
AS $$
DECLARE
  lower_identifier TEXT;
  search_wallet TEXT;
  seen_competition_user_pairs TEXT[] := ARRAY[]::TEXT[];
BEGIN
  -- Normalize identifier for case-insensitive matching
  lower_identifier := LOWER(user_identifier);
  
  -- Extract wallet address if present (remove prize:pid: prefix if exists)
  IF user_identifier LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(user_identifier FROM 11));
  ELSIF user_identifier LIKE '0x%' THEN
    search_wallet := lower_identifier;
  ELSE
    search_wallet := NULL;
  END IF;

  -- UNION entries from joincompetition, tickets, user_transactions, and pending_tickets
  -- Order: joincompetition first (authoritative), then tickets, then user_transactions, then pending_tickets
  
  RETURN QUERY
  
  -- Part 1: Entries from joincompetition table (authoritative source)
  SELECT
    jc.uid::TEXT AS id,
    jc.competitionid::TEXT AS competition_id,
    COALESCE(c.title, '') AS title,
    COALESCE(c.description, '') AS description,
    COALESCE(c.image_url, c.imageurl, '') AS image,
    CASE 
      WHEN c.winner_address IS NOT NULL THEN 'completed'
      WHEN c.status = 'active' THEN 'live'
      WHEN c.status IN ('drawn', 'completed') THEN 'completed'
      ELSE COALESCE(c.status, 'live')
    END AS status,
    'competition_entry' AS entry_type,
    COALESCE(
      LOWER(c.winner_address) = LOWER(jc.wallet_address),
      FALSE
    ) AS is_winner,
    COALESCE(jc.ticketnumbers, '') AS ticket_numbers,
    COALESCE(jc.numberoftickets, 0)::INTEGER AS total_tickets,
    COALESCE(jc.numberoftickets * c.ticket_price, 0) AS total_amount_spent,
    jc.purchasedate AS purchase_date,
    jc.transactionhash AS transaction_hash,
    COALESCE(c.is_instant_win, FALSE) AS is_instant_win,
    c.prize_value AS prize_value,
    COALESCE(c.status, 'completed') AS competition_status,
    c.end_date AS end_date
  FROM public.joincompetition jc
  LEFT JOIN public.competitions c ON jc.competitionid = c.id
  WHERE (
    -- Match by canonical_user_id
    jc.canonical_user_id = user_identifier
    -- Match by wallet address (case-insensitive)
    OR LOWER(jc.wallet_address) = lower_identifier
    -- Match by privy_user_id (legacy)
    OR jc.privy_user_id = user_identifier
    OR LOWER(jc.privy_user_id) = lower_identifier
    -- Match by userid (legacy)
    OR jc.userid = user_identifier
  )
  AND jc.competitionid IS NOT NULL

  UNION ALL

  -- Part 2: Entries from tickets table (using canonical_user_id NOT privy_user_id)
  SELECT
    ('tickets-' || COALESCE(t.canonical_user_id, t.user_id, 'unknown') || '-' || t.competition_id::TEXT)::TEXT AS id,
    t.competition_id::TEXT AS competition_id,
    COALESCE(c.title, '') AS title,
    COALESCE(c.description, '') AS description,
    COALESCE(c.image_url, c.imageurl, '') AS image,
    CASE 
      WHEN c.winner_address IS NOT NULL THEN 'completed'
      WHEN c.status = 'active' THEN 'live'
      WHEN c.status IN ('drawn', 'completed') THEN 'completed'
      ELSE COALESCE(c.status, 'live')
    END AS status,
    'ticket' AS entry_type,
    COALESCE(t.is_winner, FALSE) AS is_winner,
    STRING_AGG(t.ticket_number::TEXT, ',' ORDER BY t.ticket_number) AS ticket_numbers,
    COUNT(t.id)::INTEGER AS total_tickets,
    SUM(COALESCE(t.purchase_price, c.ticket_price, 0)) AS total_amount_spent,
    MIN(t.purchased_at) AS purchase_date,
    NULL::TEXT AS transaction_hash,
    COALESCE(c.is_instant_win, FALSE) AS is_instant_win,
    c.prize_value AS prize_value,
    COALESCE(c.status, 'completed') AS competition_status,
    c.end_date AS end_date
  FROM public.tickets t
  LEFT JOIN public.competitions c ON t.competition_id = c.id
  WHERE (
    -- Match by canonical_user_id (CORRECT!)
    t.canonical_user_id = user_identifier
    -- Match by user_id with case-insensitive comparison
    OR LOWER(t.user_id) = lower_identifier
    -- Match by wallet address search
    OR (search_wallet IS NOT NULL AND LOWER(t.user_id) = search_wallet)
  )
  AND t.competition_id IS NOT NULL
  -- Exclude if already in joincompetition (dedupe check)
  AND NOT ((t.competition_id::TEXT || '|' || COALESCE(t.canonical_user_id, t.user_id, '')) = ANY(seen_competition_user_pairs))
  GROUP BY t.competition_id, t.canonical_user_id, t.user_id, c.id, c.title, c.description, c.image_url,
           c.imageurl, c.status, c.winner_address, c.is_instant_win, c.prize_value, c.end_date, c.ticket_price

  UNION ALL

  -- Part 3: Entries from user_transactions
  SELECT
    ut.id::TEXT AS id,
    ut.competition_id::TEXT AS competition_id,
    COALESCE(c.title, '') AS title,
    COALESCE(c.description, '') AS description,
    COALESCE(c.image_url, c.imageurl, '') AS image,
    CASE
      WHEN ut.payment_status = 'completed' AND c.winner_address IS NOT NULL THEN 'completed'
      WHEN ut.payment_status = 'pending' THEN 'pending'
      WHEN ut.payment_status = 'failed' THEN 'failed'
      WHEN c.status = 'active' THEN 'live'
      WHEN c.status IN ('drawn', 'completed') THEN 'completed'
      ELSE COALESCE(c.status, 'live')
    END AS status,
    'transaction' AS entry_type,
    FALSE AS is_winner,
    '' AS ticket_numbers,
    COALESCE(ut.ticket_count, 0)::INTEGER AS total_tickets,
    COALESCE(ut.amount, 0) AS total_amount_spent,
    ut.created_at AS purchase_date,
    ut.tx_id AS transaction_hash,
    COALESCE(c.is_instant_win, FALSE) AS is_instant_win,
    c.prize_value AS prize_value,
    COALESCE(c.status, 'completed') AS competition_status,
    c.end_date AS end_date
  FROM public.user_transactions ut
  LEFT JOIN public.competitions c ON ut.competition_id = c.id
  WHERE (
    -- Match by canonical_user_id
    ut.canonical_user_id = user_identifier
    -- Match by user_id
    OR ut.user_id = user_identifier
    -- Match by user_privy_id (column name in user_transactions)
    OR ut.user_privy_id = user_identifier
    -- Match by wallet_address with case-insensitive comparison
    OR LOWER(ut.wallet_address) = lower_identifier
    -- Match by wallet address search
    OR (search_wallet IS NOT NULL AND LOWER(ut.wallet_address) = search_wallet)
  )
  AND ut.competition_id IS NOT NULL
  AND ut.payment_status != 'failed'
  -- Exclude if already in joincompetition or tickets (dedupe check)
  AND NOT ((ut.competition_id::TEXT || '|' || COALESCE(ut.canonical_user_id, ut.user_privy_id, ut.user_id, LOWER(ut.wallet_address), '')) = ANY(seen_competition_user_pairs))

  UNION ALL

  -- Part 4: Entries from pending_tickets
  SELECT
    pt.id::TEXT AS id,
    pt.competition_id::TEXT AS competition_id,
    COALESCE(c.title, '') AS title,
    COALESCE(c.description, '') AS description,
    COALESCE(c.image_url, c.imageurl, '') AS image,
    CASE
      WHEN pt.status = 'confirmed' THEN 'completed'
      WHEN pt.status = 'pending' THEN 'pending'
      WHEN pt.status = 'expired' THEN 'expired'
      ELSE pt.status
    END AS status,
    'pending_ticket' AS entry_type,
    FALSE AS is_winner,
    ARRAY_TO_STRING(pt.ticket_numbers, ',') AS ticket_numbers,
    pt.ticket_count::INTEGER AS total_tickets,
    pt.total_amount AS total_amount_spent,
    pt.created_at AS purchase_date,
    pt.transaction_hash AS transaction_hash,
    COALESCE(c.is_instant_win, FALSE) AS is_instant_win,
    c.prize_value AS prize_value,
    COALESCE(c.status, 'active') AS competition_status,
    c.end_date AS end_date
  FROM public.pending_tickets pt
  LEFT JOIN public.competitions c ON pt.competition_id = c.id
  WHERE (
    -- Match by canonical_user_id
    pt.canonical_user_id = user_identifier
    -- Match by user_id with case-insensitive comparison
    OR pt.user_id = user_identifier
    OR LOWER(pt.user_id) = lower_identifier
    -- Match by wallet_address with case-insensitive comparison
    OR LOWER(pt.wallet_address) = lower_identifier
    -- Match by wallet address search
    OR (search_wallet IS NOT NULL AND (LOWER(pt.user_id) = search_wallet OR LOWER(pt.wallet_address) = search_wallet))
  )
  AND pt.status IN ('pending', 'confirmed')
  AND pt.expires_at > NOW()

  ORDER BY purchase_date DESC NULLS LAST;
END;
$$;

COMMENT ON FUNCTION public.get_comprehensive_user_dashboard_entries IS
  'Gets all user entries from joincompetition, tickets (using canonical_user_id), user_transactions, and pending_tickets with deduplication';

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.get_comprehensive_user_dashboard_entries TO authenticated, anon;
