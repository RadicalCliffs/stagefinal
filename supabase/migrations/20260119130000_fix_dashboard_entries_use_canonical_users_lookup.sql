-- ============================================================================
-- FIX: Dashboard Entries RPC to Look Up User from canonical_users Table
-- ============================================================================
-- This migration fixes the get_comprehensive_user_dashboard_entries RPC to
-- resolve the user from the canonical_users table first, ensuring consistency
-- with all other user-related lookups in the system.
--
-- ISSUE: The previous implementation only matched by user identifiers directly
-- on entry tables. It should first resolve the user from canonical_users to
-- get ALL their associated identifiers (canonical_user_id, wallet_address,
-- privy_user_id, email, etc.) and then use those to query entries.
--
-- This ensures that if a user changes their identifier format or if there's
-- any mismatch, the function will still find all their entries correctly.
--
-- Date: 2026-01-19
-- ============================================================================

BEGIN;

-- Drop existing function to recreate with updated logic
DROP FUNCTION IF EXISTS public.get_comprehensive_user_dashboard_entries(TEXT) CASCADE;

-- Recreate the function with canonical_users lookup
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
SET search_path = public
AS $$
DECLARE
  lower_identifier TEXT;
  search_wallet TEXT;
  -- User identity fields resolved from canonical_users
  resolved_canonical_user_id TEXT := NULL;
  resolved_wallet_address TEXT := NULL;
  resolved_base_wallet_address TEXT := NULL;
  resolved_eth_wallet_address TEXT := NULL;
  resolved_privy_user_id TEXT := NULL;
  resolved_uid TEXT := NULL;
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

  -- ============================================================================
  -- STEP 1: Resolve user from canonical_users table
  -- ============================================================================
  -- This is the critical fix: look up the user in canonical_users FIRST
  -- to get all their associated identifiers. This ensures we find all entries
  -- regardless of which identifier was used when the entry was created.

  SELECT
    cu.canonical_user_id,
    LOWER(cu.wallet_address),
    LOWER(cu.base_wallet_address),
    LOWER(cu.eth_wallet_address),
    cu.privy_user_id,
    cu.uid::TEXT
  INTO
    resolved_canonical_user_id,
    resolved_wallet_address,
    resolved_base_wallet_address,
    resolved_eth_wallet_address,
    resolved_privy_user_id,
    resolved_uid
  FROM canonical_users cu
  WHERE
    -- Match by canonical_user_id
    cu.canonical_user_id = user_identifier
    -- Match by any wallet address field (case-insensitive)
    OR LOWER(cu.wallet_address) = lower_identifier
    OR LOWER(cu.base_wallet_address) = lower_identifier
    OR LOWER(cu.eth_wallet_address) = lower_identifier
    -- Match by privy_user_id
    OR cu.privy_user_id = user_identifier
    -- Match by uid
    OR cu.uid::TEXT = user_identifier
    -- Match by search_wallet if it's a wallet address
    OR (search_wallet IS NOT NULL AND (
      LOWER(cu.wallet_address) = search_wallet
      OR LOWER(cu.base_wallet_address) = search_wallet
      OR LOWER(cu.eth_wallet_address) = search_wallet
    ))
  LIMIT 1;

  -- Log resolution result for debugging
  IF resolved_canonical_user_id IS NOT NULL THEN
    RAISE DEBUG 'Resolved user from canonical_users: canonical_user_id=%, wallet=%',
                resolved_canonical_user_id, resolved_wallet_address;
  ELSE
    RAISE DEBUG 'User not found in canonical_users, using direct identifier matching';
  END IF;

  -- ============================================================================
  -- STEP 2: Query entries using resolved identifiers (or fallback to direct match)
  -- ============================================================================

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
    -- Match using resolved identifiers from canonical_users
    (resolved_canonical_user_id IS NOT NULL AND jc.canonical_user_id = resolved_canonical_user_id)
    OR (resolved_wallet_address IS NOT NULL AND LOWER(jc.wallet_address) = resolved_wallet_address)
    OR (resolved_base_wallet_address IS NOT NULL AND LOWER(jc.wallet_address) = resolved_base_wallet_address)
    OR (resolved_eth_wallet_address IS NOT NULL AND LOWER(jc.wallet_address) = resolved_eth_wallet_address)
    OR (resolved_privy_user_id IS NOT NULL AND jc.privy_user_id = resolved_privy_user_id)
    OR (resolved_uid IS NOT NULL AND jc.userid = resolved_uid)
    -- Fallback: Direct matching if user not found in canonical_users
    OR (resolved_canonical_user_id IS NULL AND (
      jc.canonical_user_id = user_identifier
      OR LOWER(jc.wallet_address) = lower_identifier
      OR jc.userid = user_identifier
      OR (search_wallet IS NOT NULL AND LOWER(jc.wallet_address) = search_wallet)
    ))
  )
  AND jc.competitionid IS NOT NULL

  UNION ALL

  -- Part 2: Entries from tickets table
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
    -- Match using resolved identifiers from canonical_users
    (resolved_canonical_user_id IS NOT NULL AND t.canonical_user_id = resolved_canonical_user_id)
    OR (resolved_wallet_address IS NOT NULL AND LOWER(t.user_id) = resolved_wallet_address)
    OR (resolved_base_wallet_address IS NOT NULL AND LOWER(t.user_id) = resolved_base_wallet_address)
    OR (resolved_eth_wallet_address IS NOT NULL AND LOWER(t.user_id) = resolved_eth_wallet_address)
    -- Fallback: Direct matching if user not found in canonical_users
    OR (resolved_canonical_user_id IS NULL AND (
      t.canonical_user_id = user_identifier
      OR LOWER(t.user_id) = lower_identifier
      OR (search_wallet IS NOT NULL AND LOWER(t.user_id) = search_wallet)
    ))
  )
  AND t.competition_id IS NOT NULL
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
    -- Match using resolved identifiers from canonical_users
    (resolved_canonical_user_id IS NOT NULL AND ut.canonical_user_id = resolved_canonical_user_id)
    OR (resolved_wallet_address IS NOT NULL AND LOWER(ut.wallet_address) = resolved_wallet_address)
    OR (resolved_base_wallet_address IS NOT NULL AND LOWER(ut.wallet_address) = resolved_base_wallet_address)
    OR (resolved_eth_wallet_address IS NOT NULL AND LOWER(ut.wallet_address) = resolved_eth_wallet_address)
    OR (resolved_privy_user_id IS NOT NULL AND (ut.user_privy_id = resolved_privy_user_id OR ut.privy_user_id = resolved_privy_user_id))
    OR (resolved_uid IS NOT NULL AND ut.user_id = resolved_uid)
    -- Fallback: Direct matching if user not found in canonical_users
    OR (resolved_canonical_user_id IS NULL AND (
      ut.canonical_user_id = user_identifier
      OR ut.user_id = user_identifier
      OR ut.user_privy_id = user_identifier
      OR LOWER(ut.wallet_address) = lower_identifier
      OR (search_wallet IS NOT NULL AND LOWER(ut.wallet_address) = search_wallet)
    ))
  )
  AND ut.competition_id IS NOT NULL
  AND ut.payment_status != 'failed'

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
    -- Match using resolved identifiers from canonical_users
    (resolved_canonical_user_id IS NOT NULL AND pt.canonical_user_id = resolved_canonical_user_id)
    OR (resolved_wallet_address IS NOT NULL AND (LOWER(pt.user_id) = resolved_wallet_address OR LOWER(pt.wallet_address) = resolved_wallet_address))
    OR (resolved_base_wallet_address IS NOT NULL AND (LOWER(pt.user_id) = resolved_base_wallet_address OR LOWER(pt.wallet_address) = resolved_base_wallet_address))
    OR (resolved_eth_wallet_address IS NOT NULL AND (LOWER(pt.user_id) = resolved_eth_wallet_address OR LOWER(pt.wallet_address) = resolved_eth_wallet_address))
    -- Fallback: Direct matching if user not found in canonical_users
    OR (resolved_canonical_user_id IS NULL AND (
      pt.canonical_user_id = user_identifier
      OR pt.user_id = user_identifier
      OR LOWER(pt.user_id) = lower_identifier
      OR LOWER(pt.wallet_address) = lower_identifier
      OR (search_wallet IS NOT NULL AND (LOWER(pt.user_id) = search_wallet OR LOWER(pt.wallet_address) = search_wallet))
    ))
  )
  AND pt.status IN ('pending', 'confirmed')
  AND pt.expires_at > NOW()

  ORDER BY purchase_date DESC NULLS LAST;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.get_comprehensive_user_dashboard_entries(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_comprehensive_user_dashboard_entries(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_comprehensive_user_dashboard_entries(TEXT) TO service_role;

COMMENT ON FUNCTION public.get_comprehensive_user_dashboard_entries IS
'Gets all user entries from joincompetition, tickets, user_transactions, and pending_tickets.
NOW CORRECTLY RESOLVES USER FROM canonical_users TABLE FIRST to get all associated identifiers,
ensuring entries are found regardless of which identifier was used when they were created.';

-- ============================================================================
-- Validation
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
    AND p.proname = 'get_comprehensive_user_dashboard_entries'
  ) THEN
    RAISE NOTICE '=====================================================';
    RAISE NOTICE 'FIX APPLIED: Dashboard Entries RPC';
    RAISE NOTICE '=====================================================';
    RAISE NOTICE '✓ get_comprehensive_user_dashboard_entries now looks up';
    RAISE NOTICE '  user from canonical_users table FIRST';
    RAISE NOTICE '✓ All user identifiers are resolved before querying entries';
    RAISE NOTICE '✓ Fallback to direct matching if user not in canonical_users';
    RAISE NOTICE '=====================================================';
  ELSE
    RAISE WARNING 'Function not created - check for errors above';
  END IF;
END $$;

COMMIT;
