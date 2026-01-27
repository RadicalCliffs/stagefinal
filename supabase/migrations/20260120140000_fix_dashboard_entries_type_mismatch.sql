-- ============================================================================
-- FIX DASHBOARD ENTRIES: Type Mismatch and View Column Issues
-- ============================================================================
-- This migration fixes:
-- 1. get_comprehensive_user_dashboard_entries RPC - uuid = text type mismatch
--    Error: "operator does not exist: uuid = text"
--    The join `jc.competitionid = c.id` fails because competitionid is TEXT and c.id is UUID
--
-- 2. v_joincompetition_active view - missing canonical_user_id column
--    Error: "column v_joincompetition_active.canonical_user_id does not exist"
--    The buildIdentityFilter function tries to filter by canonical_user_id
--
-- Date: 2026-01-20
-- ============================================================================

BEGIN;

-- ============================================================================
-- PART 1: Fix v_joincompetition_active view to include canonical_user_id
-- ============================================================================
-- The frontend buildIdentityFilter() function tries to filter by canonical_user_id
-- but the view doesn't expose this column. We need to add it.

DROP VIEW IF EXISTS public.v_joincompetition_active;

CREATE OR REPLACE VIEW public.v_joincompetition_active AS
SELECT
  jc.id,
  jc.uid,
  jc.userid,
  jc.wallet_address,
  jc.competitionid,
  jc.numberoftickets,
  jc.ticketnumbers,
  jc.amountspent,
  jc.purchasedate,
  jc.buytime,
  jc.transactionhash,
  jc.chain,
  jc.created_at,
  -- Add canonical_user_id for identity filtering (required by buildIdentityFilter)
  jc.canonical_user_id,
  -- Also add privy_user_id for legacy compatibility
  jc.privy_user_id,
  -- Include competition details for convenience
  c.title as competition_title,
  c.status as competition_status,
  c.draw_date as competition_draw_date
FROM joincompetition jc
-- Use OR to handle both UUID format (c.id) and text format (c.uid) for competitionid
-- First try to match against c.id (UUID), then fallback to c.uid (text)
LEFT JOIN competitions c ON (
  -- Try UUID match first (when competitionid is stored as UUID string)
  (jc.competitionid ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND jc.competitionid::uuid = c.id)
  OR
  -- Fallback to uid match (legacy text format)
  c.uid = jc.competitionid
)
WHERE
  -- Only include entries for active or completed competitions
  c.status IN ('active', 'completed', 'drawing', 'drawn')
  -- Exclude test/invalid entries
  AND jc.numberoftickets > 0
  AND jc.ticketnumbers IS NOT NULL;

-- Add comment for documentation
COMMENT ON VIEW public.v_joincompetition_active IS 'Stable view for active competition entries with canonical_user_id support. Use this instead of direct joincompetition queries.';

-- Grant permissions
GRANT SELECT ON public.v_joincompetition_active TO authenticated;
GRANT SELECT ON public.v_joincompetition_active TO anon;
GRANT SELECT ON public.v_joincompetition_active TO service_role;

-- ============================================================================
-- PART 2: Fix get_comprehensive_user_dashboard_entries RPC
-- ============================================================================
-- The error "operator does not exist: uuid = text" comes from:
-- LEFT JOIN public.competitions c ON jc.competitionid = c.id
--
-- jc.competitionid is TEXT but can contain either:
-- - A UUID string (like "94194eb3-311b-4c60-a651-22003ac55c41") -> compare with c.id
-- - A legacy uid string -> compare with c.uid
--
-- We need to use a try-cast approach or check the format before joining.

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
STABLE
SET search_path = public
AS $$
DECLARE
  lower_identifier TEXT;
  search_wallet TEXT;
BEGIN
  -- Normalize identifier for case-insensitive matching
  lower_identifier := LOWER(TRIM(user_identifier));

  -- Extract wallet address if present (remove prize:pid: prefix if exists)
  IF user_identifier LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(user_identifier FROM 11));
  ELSIF user_identifier LIKE '0x%' THEN
    search_wallet := lower_identifier;
  ELSE
    search_wallet := NULL;
  END IF;

  -- UNION entries from joincompetition, tickets, user_transactions, and pending_tickets
  RETURN QUERY

  -- Part 1: Entries from joincompetition table (authoritative source)
  -- FIX: Use proper join that handles both UUID and text competitionid formats
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
  -- FIX: Use a join condition that handles both UUID and text competition IDs
  LEFT JOIN public.competitions c ON (
    -- Try UUID match first (when competitionid looks like a UUID)
    (jc.competitionid ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     AND jc.competitionid::uuid = c.id)
    OR
    -- Fallback to uid match (legacy text format)
    c.uid = jc.competitionid
  )
  WHERE (
    -- Match by canonical_user_id
    jc.canonical_user_id = user_identifier
    -- Match by wallet address (case-insensitive)
    OR LOWER(jc.wallet_address) = lower_identifier
    -- Match by userid (legacy)
    OR jc.userid = user_identifier
    -- Match by privy_user_id if it exists
    OR jc.privy_user_id = user_identifier
    -- Match by wallet in search_wallet
    OR (search_wallet IS NOT NULL AND LOWER(jc.wallet_address) = search_wallet)
  )
  AND jc.competitionid IS NOT NULL

  UNION ALL

  -- Part 2: Entries from tickets table (using canonical_user_id)
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
    -- Match by canonical_user_id
    t.canonical_user_id = user_identifier
    -- Match by user_id with case-insensitive comparison
    OR LOWER(t.user_id) = lower_identifier
    -- Match by wallet address search
    OR (search_wallet IS NOT NULL AND LOWER(t.user_id) = search_wallet)
  )
  AND t.competition_id IS NOT NULL
  -- Exclude entries already in joincompetition to avoid duplicates
  AND NOT EXISTS (
    SELECT 1 FROM joincompetition jc2
    WHERE (
      -- Match competition
      (jc2.competitionid ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       AND jc2.competitionid::uuid = t.competition_id)
      OR jc2.competitionid = t.competition_id::TEXT
    )
    AND (
      -- Match user
      jc2.canonical_user_id = t.canonical_user_id
      OR LOWER(jc2.wallet_address) = LOWER(t.user_id)
      OR jc2.userid = t.user_id
    )
  )
  GROUP BY t.competition_id, t.canonical_user_id, t.user_id, c.id, c.title, c.description, c.image_url,
           c.imageurl, c.status, c.winner_address, c.is_instant_win, c.prize_value, c.end_date, c.ticket_price

  UNION ALL

  -- Part 3: Entries from user_transactions (completed payments)
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
    -- Match by privy_user_id if it exists
    OR ut.privy_user_id = user_identifier
    -- Match by wallet_address with case-insensitive comparison
    OR LOWER(ut.wallet_address) = lower_identifier
    -- Match by wallet address search
    OR (search_wallet IS NOT NULL AND LOWER(ut.wallet_address) = search_wallet)
  )
  AND ut.competition_id IS NOT NULL
  AND ut.payment_status IN ('completed', 'finished')
  -- Exclude if already in joincompetition
  AND NOT EXISTS (
    SELECT 1 FROM joincompetition jc3
    WHERE (
      (jc3.competitionid ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       AND jc3.competitionid::uuid = ut.competition_id)
      OR jc3.competitionid = ut.competition_id::TEXT
    )
    AND (
      jc3.canonical_user_id = ut.canonical_user_id
      OR jc3.canonical_user_id = ut.user_privy_id
      OR LOWER(jc3.walletaddress) = LOWER(ut.wallet_address)
    )
  )

  UNION ALL

  -- Part 4: Active pending tickets (not expired)
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
  AND pt.status IN ('pending', 'confirmed', 'confirming')
  AND pt.expires_at > NOW()

  ORDER BY purchase_date DESC NULLS LAST;
END;
$$;

COMMENT ON FUNCTION public.get_comprehensive_user_dashboard_entries IS
  'Gets all user entries from joincompetition, tickets, user_transactions, and pending_tickets.
  Fixed to handle competitionid as both UUID and text format (uses regex check before casting).';

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.get_comprehensive_user_dashboard_entries(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_comprehensive_user_dashboard_entries(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_comprehensive_user_dashboard_entries(TEXT) TO service_role;


-- ============================================================================
-- PART 3: Add index on joincompetition for canonical_user_id queries
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_joincompetition_canonical_user_id_lower
  ON joincompetition(LOWER(canonical_user_id))
  WHERE canonical_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_joincompetition_wallet_canonical
  ON joincompetition(LOWER(wallet_address), canonical_user_id);


-- ============================================================================
-- PART 4: Verification
-- ============================================================================

DO $$
DECLARE
  view_exists BOOLEAN;
  func_exists BOOLEAN;
  view_has_canonical BOOLEAN;
BEGIN
  -- Check view exists
  SELECT EXISTS (
    SELECT 1 FROM pg_views WHERE viewname = 'v_joincompetition_active' AND schemaname = 'public'
  ) INTO view_exists;

  -- Check view has canonical_user_id
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'v_joincompetition_active'
    AND column_name = 'canonical_user_id'
  ) INTO view_has_canonical;

  -- Check function exists
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'get_comprehensive_user_dashboard_entries'
  ) INTO func_exists;

  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'FIX: Dashboard Entries Type Mismatch';
  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'v_joincompetition_active view exists: %', view_exists;
  RAISE NOTICE 'v_joincompetition_active has canonical_user_id: %', view_has_canonical;
  RAISE NOTICE 'get_comprehensive_user_dashboard_entries function exists: %', func_exists;

  IF view_exists AND view_has_canonical AND func_exists THEN
    RAISE NOTICE '✓ SUCCESS: All fixes applied';
  ELSE
    RAISE WARNING '✗ WARNING: Some fixes may have failed';
  END IF;
  RAISE NOTICE '=====================================================';
END $$;

COMMIT;
