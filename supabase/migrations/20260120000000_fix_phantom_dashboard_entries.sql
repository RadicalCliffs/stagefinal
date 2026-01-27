-- ============================================================================
-- FIX: Phantom Dashboard Entries with Missing Competition ID
-- ============================================================================
-- This migration fixes an issue where the get_comprehensive_user_dashboard_entries
-- RPC was returning entries with NULL competition_id, causing phantom entries
-- to appear on every user's dashboard with "Unknown" title and $0.0 cost.
--
-- Problem:
-- - The RPC uses LEFT JOINs to competitions table
-- - When a joincompetition/tickets record references a deleted competition,
--   the LEFT JOIN returns NULL for all competition columns
-- - The frontend creates a synthetic "legacy-unknown" ID for these entries
-- - This results in phantom entries appearing for every user
--
-- Solution:
-- - Use INNER JOINs instead of LEFT JOINs to ensure only valid entries are returned
-- - Add explicit NULL checks for competition_id in WHERE clauses
-- - Filter out entries where the competition no longer exists
-- ============================================================================

BEGIN;

-- Recreate the get_comprehensive_user_dashboard_entries function with INNER JOINs
-- to ensure we only return entries that have valid competitions
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
BEGIN
  -- Validate input early
  IF user_identifier IS NULL OR TRIM(user_identifier) = '' THEN
    RETURN;
  END IF;

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
  -- Using INNER JOINs to ensure we only return entries with valid competitions
  RETURN QUERY

  -- Part 1: Entries from joincompetition table (authoritative source)
  -- Use INNER JOIN to exclude entries for deleted competitions
  SELECT
    COALESCE(jc.uid, jc.id::TEXT, gen_random_uuid()::TEXT) AS id,
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
    COALESCE(jc.numberoftickets * c.ticket_price, jc.amountspent, 0) AS total_amount_spent,
    jc.purchasedate AS purchase_date,
    jc.transactionhash AS transaction_hash,
    COALESCE(c.is_instant_win, FALSE) AS is_instant_win,
    c.prize_value AS prize_value,
    COALESCE(c.status, 'completed') AS competition_status,
    c.end_date AS end_date
  FROM public.joincompetition jc
  INNER JOIN public.competitions c ON (
    jc.competitionid = c.id::TEXT
    OR jc.competitionid = c.uid
  )
  WHERE (
    -- Match by canonical_user_id
    jc.canonical_user_id = user_identifier
    -- Match by wallet address (case-insensitive)
    OR LOWER(jc.wallet_address) = lower_identifier
    -- Match by userid (legacy)
    OR jc.userid = user_identifier
    -- Match by wallet in search_wallet
    OR (search_wallet IS NOT NULL AND LOWER(jc.wallet_address) = search_wallet)
  )
  AND jc.competitionid IS NOT NULL
  AND jc.competitionid != ''

  UNION ALL

  -- Part 2: Entries from tickets table (using canonical_user_id)
  -- Use INNER JOIN to exclude entries for deleted competitions
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
  INNER JOIN public.competitions c ON t.competition_id = c.id
  WHERE (
    -- Match by canonical_user_id
    t.canonical_user_id = user_identifier
    -- Match by user_id with case-insensitive comparison
    OR LOWER(t.user_id) = lower_identifier
    -- Match by wallet address search
    OR (search_wallet IS NOT NULL AND LOWER(t.user_id) = search_wallet)
  )
  AND t.competition_id IS NOT NULL
  GROUP BY t.competition_id, t.canonical_user_id, t.user_id, c.id, c.title, c.description, c.image_url,
           c.imageurl, c.status, c.winner_address, c.is_instant_win, c.prize_value, c.end_date, c.ticket_price

  UNION ALL

  -- Part 3: Entries from user_transactions
  -- Use INNER JOIN to exclude entries for deleted competitions
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
  INNER JOIN public.competitions c ON ut.competition_id = c.id
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

  UNION ALL

  -- Part 4: Entries from pending_tickets
  -- Use INNER JOIN to exclude entries for deleted competitions
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
  INNER JOIN public.competitions c ON pt.competition_id = c.id
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
  'Gets all user entries from joincompetition, tickets, user_transactions, and pending_tickets.
  Uses INNER JOINs to ensure only entries with valid competitions are returned.
  Fixed to prevent phantom entries with missing competition_id.';

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.get_comprehensive_user_dashboard_entries TO authenticated, anon;

-- ============================================================================
-- Validation
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'FIX: Phantom Dashboard Entries';
  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'Updated get_comprehensive_user_dashboard_entries RPC to:';
  RAISE NOTICE '  - Use INNER JOINs instead of LEFT JOINs';
  RAISE NOTICE '  - Filter out entries with missing competition_id';
  RAISE NOTICE '  - Only return entries for existing competitions';
  RAISE NOTICE '=====================================================';
END $$;

COMMIT;
