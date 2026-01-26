-- ============================================================================
-- FIX: Live Competitions - Pull from user_transactions and balance_ledger
-- ============================================================================
-- ISSUE: Live Competitions entries are not showing entries from:
--   1. user_transactions table (with proper status filters)
--   2. balance_ledger table (for balance-based payments)
--
-- ROOT CAUSE:
--   - RPC functions were filtering for limited status values
--   - balance_ledger was not being queried for purchase records
--   - Status filter missing: 'complete', 'success', 'paid'
--
-- SOLUTION:
--   - Update status filter to include all valid completed statuses
--   - Add balance_ledger query for purchase entries (source = 'purchase')
--
-- Date: 2026-01-26
-- ============================================================================

BEGIN;

-- ============================================================================
-- PART 1: Update get_user_competition_entries to include all status values
-- and add balance_ledger fallback
-- ============================================================================

DROP FUNCTION IF EXISTS get_user_competition_entries(TEXT) CASCADE;

CREATE OR REPLACE FUNCTION get_user_competition_entries(p_user_identifier TEXT)
RETURNS TABLE (
  id UUID,
  competition_id UUID,
  user_id TEXT,
  canonical_user_id TEXT,
  wallet_address TEXT,
  ticket_numbers INTEGER[],
  ticket_count INTEGER,
  amount_paid NUMERIC,
  currency TEXT,
  transaction_hash TEXT,
  payment_provider TEXT,
  entry_status TEXT,
  is_winner BOOLEAN,
  prize_claimed BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  -- Competition details joined
  competition_title TEXT,
  competition_description TEXT,
  competition_image_url TEXT,
  competition_status TEXT,
  competition_end_date TIMESTAMPTZ,
  competition_prize_value NUMERIC,
  competition_is_instant_win BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  lower_identifier TEXT;
  search_wallet TEXT;
  resolved_canonical_user_id TEXT := NULL;
  resolved_wallet_address TEXT := NULL;
  resolved_base_wallet_address TEXT := NULL;
  resolved_user_uuid UUID := NULL;
  has_competition_entries BOOLEAN := FALSE;
BEGIN
  -- Normalize identifier for case-insensitive matching
  lower_identifier := LOWER(TRIM(p_user_identifier));

  -- Extract wallet address if present (remove prize:pid: prefix if exists)
  IF p_user_identifier LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(p_user_identifier FROM 11));
  ELSIF p_user_identifier LIKE '0x%' THEN
    search_wallet := lower_identifier;
  ELSE
    search_wallet := NULL;
  END IF;

  -- Resolve user from canonical_users table
  SELECT
    cu.canonical_user_id,
    LOWER(cu.wallet_address),
    LOWER(cu.base_wallet_address),
    cu.id::UUID
  INTO
    resolved_canonical_user_id,
    resolved_wallet_address,
    resolved_base_wallet_address,
    resolved_user_uuid
  FROM canonical_users cu
  WHERE
    cu.canonical_user_id = p_user_identifier
    OR LOWER(cu.wallet_address) = lower_identifier
    OR LOWER(cu.base_wallet_address) = lower_identifier
    OR cu.privy_user_id = p_user_identifier
    OR (search_wallet IS NOT NULL AND (
      LOWER(cu.wallet_address) = search_wallet
      OR LOWER(cu.base_wallet_address) = search_wallet
    ))
  LIMIT 1;

  -- Check if there are any entries in competition_entries for this user
  SELECT EXISTS (
    SELECT 1 FROM competition_entries ce
    WHERE (
      (resolved_canonical_user_id IS NOT NULL AND ce.canonical_user_id = resolved_canonical_user_id)
      OR (resolved_wallet_address IS NOT NULL AND LOWER(ce.wallet_address) = resolved_wallet_address)
      OR (resolved_base_wallet_address IS NOT NULL AND LOWER(ce.wallet_address) = resolved_base_wallet_address)
      OR (resolved_canonical_user_id IS NULL AND (
        ce.canonical_user_id = p_user_identifier
        OR LOWER(ce.wallet_address) = lower_identifier
        OR ce.user_id = p_user_identifier
        OR (search_wallet IS NOT NULL AND LOWER(ce.wallet_address) = search_wallet)
      ))
    )
    AND ce.entry_status != 'cancelled'
    LIMIT 1
  ) INTO has_competition_entries;

  -- If competition_entries has data, return from it
  IF has_competition_entries THEN
    RETURN QUERY
    SELECT
      ce.id,
      ce.competition_id,
      ce.user_id,
      ce.canonical_user_id,
      ce.wallet_address,
      ce.ticket_numbers,
      ce.ticket_count,
      ce.amount_paid,
      ce.currency,
      ce.transaction_hash,
      ce.payment_provider,
      ce.entry_status,
      ce.is_winner,
      ce.prize_claimed,
      ce.created_at,
      ce.updated_at,
      COALESCE(c.title, '') AS competition_title,
      COALESCE(c.description, '') AS competition_description,
      COALESCE(c.image_url, '') AS competition_image_url,
      COALESCE(c.status, 'active') AS competition_status,
      c.end_date AS competition_end_date,
      c.prize_value AS competition_prize_value,
      COALESCE(c.is_instant_win, FALSE) AS competition_is_instant_win
    FROM competition_entries ce
    LEFT JOIN competitions c ON ce.competition_id = c.id
    WHERE (
      (resolved_canonical_user_id IS NOT NULL AND ce.canonical_user_id = resolved_canonical_user_id)
      OR (resolved_wallet_address IS NOT NULL AND LOWER(ce.wallet_address) = resolved_wallet_address)
      OR (resolved_base_wallet_address IS NOT NULL AND LOWER(ce.wallet_address) = resolved_base_wallet_address)
      OR (resolved_canonical_user_id IS NULL AND (
        ce.canonical_user_id = p_user_identifier
        OR LOWER(ce.wallet_address) = lower_identifier
        OR ce.user_id = p_user_identifier
        OR (search_wallet IS NOT NULL AND LOWER(ce.wallet_address) = search_wallet)
      ))
    )
    AND ce.entry_status != 'cancelled'
    ORDER BY ce.created_at DESC;
  ELSE
    -- Fallback: Return entries from user_transactions, orders, AND balance_ledger
    -- This ensures entries are visible even when competition_entries is not populated
    RETURN QUERY

    -- Source 1: user_transactions with ALL valid completed statuses
    SELECT
      ut.id::UUID AS id,
      ut.competition_id::UUID AS competition_id,
      ut.user_id AS user_id,
      ut.canonical_user_id AS canonical_user_id,
      ut.wallet_address AS wallet_address,
      ARRAY[]::INTEGER[] AS ticket_numbers,
      COALESCE(ut.ticket_count, 0) AS ticket_count,
      COALESCE(ut.amount, 0) AS amount_paid,
      COALESCE(ut.currency, 'USD') AS currency,
      COALESCE(ut.tx_id, ut.charge_id, ut.charge_code) AS transaction_hash,
      COALESCE(ut.payment_provider, ut.primary_provider) AS payment_provider,
      CASE
        -- Include ALL valid completed status values (case-insensitive)
        WHEN LOWER(ut.status) IN ('completed', 'complete', 'finished', 'confirmed', 'success', 'paid') THEN 'confirmed'
        WHEN LOWER(ut.status) = 'pending' THEN 'pending'
        ELSE 'pending'
      END AS entry_status,
      FALSE AS is_winner,
      FALSE AS prize_claimed,
      ut.created_at AS created_at,
      ut.updated_at AS updated_at,
      COALESCE(c.title, '') AS competition_title,
      COALESCE(c.description, '') AS competition_description,
      COALESCE(c.image_url, '') AS competition_image_url,
      COALESCE(c.status, 'active') AS competition_status,
      c.end_date AS competition_end_date,
      c.prize_value AS competition_prize_value,
      COALESCE(c.is_instant_win, FALSE) AS competition_is_instant_win
    FROM user_transactions ut
    LEFT JOIN competitions c ON ut.competition_id::UUID = c.id
    WHERE (
      (resolved_canonical_user_id IS NOT NULL AND ut.canonical_user_id = resolved_canonical_user_id)
      OR (resolved_wallet_address IS NOT NULL AND LOWER(ut.wallet_address) = resolved_wallet_address)
      OR (resolved_base_wallet_address IS NOT NULL AND LOWER(ut.wallet_address) = resolved_base_wallet_address)
      OR (resolved_canonical_user_id IS NULL AND (
        ut.canonical_user_id = p_user_identifier
        OR ut.user_id = p_user_identifier
        OR LOWER(ut.wallet_address) = lower_identifier
        OR (search_wallet IS NOT NULL AND LOWER(ut.wallet_address) = search_wallet)
      ))
    )
    AND ut.competition_id IS NOT NULL
    -- Include all valid completed statuses (case-insensitive matching)
    AND LOWER(ut.status) IN ('completed', 'complete', 'finished', 'confirmed', 'success', 'paid')

    UNION ALL

    -- Source 2: orders table
    SELECT
      o.id::UUID AS id,
      o.competition_id::UUID AS competition_id,
      o.user_id AS user_id,
      NULL::TEXT AS canonical_user_id,
      NULL::TEXT AS wallet_address,
      ARRAY[]::INTEGER[] AS ticket_numbers,
      COALESCE(o.ticket_count, 0) AS ticket_count,
      COALESCE(o.amount, 0) AS amount_paid,
      COALESCE(o.currency, 'USD') AS currency,
      o.payment_tx_hash AS transaction_hash,
      COALESCE(o.payment_provider, o.payment_method) AS payment_provider,
      CASE
        WHEN LOWER(o.status) IN ('completed', 'confirmed', 'paid', 'success') THEN 'confirmed'
        WHEN LOWER(o.status) = 'pending' THEN 'pending'
        ELSE 'pending'
      END AS entry_status,
      FALSE AS is_winner,
      FALSE AS prize_claimed,
      COALESCE(o.completed_at, o.created_at) AS created_at,
      o.updated_at AS updated_at,
      COALESCE(c.title, '') AS competition_title,
      COALESCE(c.description, '') AS competition_description,
      COALESCE(c.image_url, '') AS competition_image_url,
      COALESCE(c.status, 'active') AS competition_status,
      c.end_date AS competition_end_date,
      c.prize_value AS competition_prize_value,
      COALESCE(c.is_instant_win, FALSE) AS competition_is_instant_win
    FROM orders o
    LEFT JOIN competitions c ON o.competition_id::UUID = c.id
    WHERE (
      o.user_id = p_user_identifier
      OR LOWER(o.user_id) = lower_identifier
      OR (search_wallet IS NOT NULL AND LOWER(o.user_id) = search_wallet)
      OR (resolved_wallet_address IS NOT NULL AND LOWER(o.user_id) = resolved_wallet_address)
      OR (resolved_base_wallet_address IS NOT NULL AND LOWER(o.user_id) = resolved_base_wallet_address)
    )
    AND o.competition_id IS NOT NULL
    AND LOWER(o.status) IN ('completed', 'confirmed', 'paid', 'success')

    UNION ALL

    -- Source 3: balance_ledger (for balance-based purchases)
    -- balance_ledger records purchases with source = 'purchase' and negative amount
    SELECT
      bl.id AS id,
      (bl.metadata->>'competition_id')::UUID AS competition_id,
      NULL::TEXT AS user_id,
      COALESCE(
        bl.metadata->>'canonical_user_id',
        (SELECT cu2.canonical_user_id FROM canonical_users cu2 WHERE cu2.id = bl.user_id LIMIT 1)
      ) AS canonical_user_id,
      COALESCE(
        bl.metadata->>'wallet_address',
        (SELECT cu3.wallet_address FROM canonical_users cu3 WHERE cu3.id = bl.user_id LIMIT 1)
      ) AS wallet_address,
      ARRAY[]::INTEGER[] AS ticket_numbers,
      COALESCE((bl.metadata->>'ticket_count')::INTEGER, 1) AS ticket_count,
      ABS(bl.amount) AS amount_paid,
      'USD' AS currency,
      COALESCE(
        bl.transaction_id::TEXT,
        bl.metadata->>'transaction_hash',
        bl.metadata->>'order_id'
      ) AS transaction_hash,
      COALESCE(bl.metadata->>'payment_provider', 'balance') AS payment_provider,
      'confirmed' AS entry_status,
      FALSE AS is_winner,
      FALSE AS prize_claimed,
      bl.created_at AS created_at,
      bl.created_at AS updated_at,
      COALESCE(c.title, '') AS competition_title,
      COALESCE(c.description, '') AS competition_description,
      COALESCE(c.image_url, '') AS competition_image_url,
      COALESCE(c.status, 'active') AS competition_status,
      c.end_date AS competition_end_date,
      c.prize_value AS competition_prize_value,
      COALESCE(c.is_instant_win, FALSE) AS competition_is_instant_win
    FROM balance_ledger bl
    LEFT JOIN competitions c ON (bl.metadata->>'competition_id')::UUID = c.id
    WHERE (
      -- Match by user_id (UUID) from resolved canonical_users
      (resolved_user_uuid IS NOT NULL AND bl.user_id = resolved_user_uuid)
      -- Or match via metadata canonical_user_id
      OR (resolved_canonical_user_id IS NOT NULL AND bl.metadata->>'canonical_user_id' = resolved_canonical_user_id)
      -- Or match via metadata wallet_address
      OR (resolved_wallet_address IS NOT NULL AND LOWER(bl.metadata->>'wallet_address') = resolved_wallet_address)
      OR (resolved_base_wallet_address IS NOT NULL AND LOWER(bl.metadata->>'wallet_address') = resolved_base_wallet_address)
    )
    -- Only purchase entries (negative amounts = debits for purchases)
    AND bl.source = 'purchase'
    AND bl.amount < 0
    AND bl.metadata->>'competition_id' IS NOT NULL

    ORDER BY created_at DESC;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_user_competition_entries(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_competition_entries(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_user_competition_entries(TEXT) TO service_role;

COMMENT ON FUNCTION get_user_competition_entries IS
'Returns all competition entries for a user.
First tries competition_entries table, then falls back to:
- user_transactions (with all completed statuses: completed, complete, finished, confirmed, success, paid)
- orders table
- balance_ledger (for balance-based purchases with source=purchase)';

-- ============================================================================
-- PART 2: Update get_comprehensive_user_dashboard_entries to include
-- balance_ledger and all valid status values
-- ============================================================================

DROP FUNCTION IF EXISTS get_comprehensive_user_dashboard_entries(TEXT) CASCADE;
DROP FUNCTION IF EXISTS get_comprehensive_user_dashboard_entries(jsonb) CASCADE;

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
  resolved_canonical_user_id TEXT := NULL;
  resolved_wallet_address TEXT := NULL;
  resolved_base_wallet_address TEXT := NULL;
  resolved_eth_wallet_address TEXT := NULL;
  resolved_privy_user_id TEXT := NULL;
  resolved_uid TEXT := NULL;
  resolved_user_uuid UUID := NULL;
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

  -- Resolve user from canonical_users table
  SELECT
    cu.canonical_user_id,
    LOWER(cu.wallet_address),
    LOWER(cu.base_wallet_address),
    LOWER(cu.eth_wallet_address),
    cu.privy_user_id,
    cu.uid,
    cu.id::UUID
  INTO
    resolved_canonical_user_id,
    resolved_wallet_address,
    resolved_base_wallet_address,
    resolved_eth_wallet_address,
    resolved_privy_user_id,
    resolved_uid,
    resolved_user_uuid
  FROM canonical_users cu
  WHERE
    cu.canonical_user_id = user_identifier
    OR LOWER(cu.wallet_address) = lower_identifier
    OR LOWER(cu.base_wallet_address) = lower_identifier
    OR LOWER(cu.eth_wallet_address) = lower_identifier
    OR cu.privy_user_id = user_identifier
    OR cu.uid = user_identifier
    OR (search_wallet IS NOT NULL AND (
      LOWER(cu.wallet_address) = search_wallet
      OR LOWER(cu.base_wallet_address) = search_wallet
      OR LOWER(cu.eth_wallet_address) = search_wallet
    ))
  LIMIT 1;

  RETURN QUERY

  -- Part 1: Entries from joincompetition table (authoritative source)
  SELECT
    COALESCE(jc.uid, 'jc-' || COALESCE(jc.competitionid, '') || '-' || COALESCE(jc.walletaddress, '') || '-' || COALESCE(jc.created_at::TEXT, '')) AS id,
    COALESCE(jc.competitionid, c.id::TEXT, c.uid) AS competition_id,
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
      LOWER(c.winner_address) = LOWER(jc.walletaddress),
      FALSE
    ) AS is_winner,
    COALESCE(jc.ticketnumbers, '') AS ticket_numbers,
    COALESCE(jc.numberoftickets, 0)::INTEGER AS total_tickets,
    COALESCE(jc.numberoftickets * c.ticket_price, jc.amountspent, 0) AS total_amount_spent,
    COALESCE(jc.purchasedate, jc.created_at) AS purchase_date,
    jc.transactionhash AS transaction_hash,
    COALESCE(c.is_instant_win, FALSE) AS is_instant_win,
    c.prize_value AS prize_value,
    COALESCE(c.status, 'completed') AS competition_status,
    c.end_date AS end_date
  FROM public.joincompetition jc
  LEFT JOIN public.competitions c ON (
    (jc.competitionid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     AND jc.competitionid::uuid = c.id)
    OR c.uid = jc.competitionid
  )
  WHERE (
    (resolved_canonical_user_id IS NOT NULL AND jc.canonical_user_id = resolved_canonical_user_id)
    OR (resolved_wallet_address IS NOT NULL AND LOWER(jc.walletaddress) = resolved_wallet_address)
    OR (resolved_base_wallet_address IS NOT NULL AND LOWER(jc.walletaddress) = resolved_base_wallet_address)
    OR (resolved_eth_wallet_address IS NOT NULL AND LOWER(jc.walletaddress) = resolved_eth_wallet_address)
    OR (resolved_privy_user_id IS NOT NULL AND jc.privy_user_id = resolved_privy_user_id)
    OR (resolved_uid IS NOT NULL AND jc.userid::TEXT = resolved_uid)
    OR (resolved_canonical_user_id IS NULL AND (
      jc.canonical_user_id = user_identifier
      OR LOWER(jc.walletaddress) = lower_identifier
      OR jc.userid::TEXT = user_identifier
      OR (search_wallet IS NOT NULL AND LOWER(jc.walletaddress) = search_wallet)
    ))
  )
  AND jc.competitionid IS NOT NULL
  AND jc.competitionid != ''
  AND (c.id IS NOT NULL OR jc.competitionid IS NOT NULL)

  UNION ALL

  -- Part 2: Entries from tickets table
  SELECT
    ('tickets-' || COALESCE(t.canonical_user_id, t.user_id, 'anon-' || t.competition_id::TEXT) || '-' || t.competition_id::TEXT)::TEXT AS id,
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
    (resolved_canonical_user_id IS NOT NULL AND t.canonical_user_id = resolved_canonical_user_id)
    OR (resolved_wallet_address IS NOT NULL AND LOWER(t.user_id) = resolved_wallet_address)
    OR (resolved_base_wallet_address IS NOT NULL AND LOWER(t.user_id) = resolved_base_wallet_address)
    OR (resolved_eth_wallet_address IS NOT NULL AND LOWER(t.user_id) = resolved_eth_wallet_address)
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

  -- Part 3: Entries from user_transactions with ALL valid completed statuses
  SELECT
    ut.id::TEXT AS id,
    ut.competition_id::TEXT AS competition_id,
    COALESCE(c.title, '') AS title,
    COALESCE(c.description, '') AS description,
    COALESCE(c.image_url, c.imageurl, '') AS image,
    CASE
      -- Include ALL valid completed status values (case-insensitive)
      WHEN LOWER(ut.status) IN ('completed', 'complete', 'finished', 'confirmed', 'success', 'paid') AND c.winner_address IS NOT NULL THEN 'completed'
      WHEN LOWER(ut.status) = 'pending' THEN 'pending'
      WHEN LOWER(ut.status) = 'failed' THEN 'failed'
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
    COALESCE(ut.tx_id, ut.charge_id, ut.charge_code, ut.tx_ref, ut.order_id) AS transaction_hash,
    COALESCE(c.is_instant_win, FALSE) AS is_instant_win,
    c.prize_value AS prize_value,
    COALESCE(c.status, 'completed') AS competition_status,
    c.end_date AS end_date
  FROM public.user_transactions ut
  LEFT JOIN public.competitions c ON ut.competition_id::UUID = c.id
  WHERE (
    (resolved_canonical_user_id IS NOT NULL AND ut.canonical_user_id = resolved_canonical_user_id)
    OR (resolved_wallet_address IS NOT NULL AND LOWER(ut.wallet_address) = resolved_wallet_address)
    OR (resolved_base_wallet_address IS NOT NULL AND LOWER(ut.wallet_address) = resolved_base_wallet_address)
    OR (resolved_eth_wallet_address IS NOT NULL AND LOWER(ut.wallet_address) = resolved_eth_wallet_address)
    OR (resolved_privy_user_id IS NOT NULL AND (ut.user_privy_id = resolved_privy_user_id OR ut.privy_user_id = resolved_privy_user_id))
    OR (resolved_uid IS NOT NULL AND ut.user_id = resolved_uid)
    OR (resolved_canonical_user_id IS NULL AND (
      ut.canonical_user_id = user_identifier
      OR ut.user_id = user_identifier
      OR ut.user_privy_id = user_identifier
      OR LOWER(ut.wallet_address) = lower_identifier
      OR (search_wallet IS NOT NULL AND LOWER(ut.wallet_address) = search_wallet)
    ))
  )
  AND ut.competition_id IS NOT NULL
  -- Include ALL valid completed statuses (case-insensitive)
  AND LOWER(ut.status) IN ('completed', 'complete', 'finished', 'confirmed', 'success', 'paid')

  UNION ALL

  -- Part 4: Entries from pending_tickets (if the table exists)
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
    (resolved_canonical_user_id IS NOT NULL AND pt.canonical_user_id = resolved_canonical_user_id)
    OR (resolved_wallet_address IS NOT NULL AND (LOWER(pt.user_id) = resolved_wallet_address OR LOWER(pt.wallet_address) = resolved_wallet_address))
    OR (resolved_base_wallet_address IS NOT NULL AND (LOWER(pt.user_id) = resolved_base_wallet_address OR LOWER(pt.wallet_address) = resolved_base_wallet_address))
    OR (resolved_eth_wallet_address IS NOT NULL AND (LOWER(pt.user_id) = resolved_eth_wallet_address OR LOWER(pt.wallet_address) = resolved_eth_wallet_address))
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
  AND pt.competition_id IS NOT NULL

  UNION ALL

  -- Part 5: Entries from balance_ledger (for balance-based purchases)
  SELECT
    bl.id::TEXT AS id,
    (bl.metadata->>'competition_id')::TEXT AS competition_id,
    COALESCE(c.title, '') AS title,
    COALESCE(c.description, '') AS description,
    COALESCE(c.image_url, c.imageurl, '') AS image,
    CASE
      WHEN c.winner_address IS NOT NULL THEN 'completed'
      WHEN c.status = 'active' THEN 'live'
      WHEN c.status IN ('drawn', 'completed') THEN 'completed'
      ELSE COALESCE(c.status, 'live')
    END AS status,
    'balance_purchase' AS entry_type,
    FALSE AS is_winner,
    COALESCE(bl.metadata->>'ticket_numbers', '') AS ticket_numbers,
    COALESCE((bl.metadata->>'ticket_count')::INTEGER, 1)::INTEGER AS total_tickets,
    ABS(bl.amount) AS total_amount_spent,
    bl.created_at AS purchase_date,
    COALESCE(bl.transaction_id::TEXT, bl.metadata->>'transaction_hash', bl.metadata->>'order_id') AS transaction_hash,
    COALESCE(c.is_instant_win, FALSE) AS is_instant_win,
    c.prize_value AS prize_value,
    COALESCE(c.status, 'active') AS competition_status,
    c.end_date AS end_date
  FROM public.balance_ledger bl
  LEFT JOIN public.competitions c ON (bl.metadata->>'competition_id')::UUID = c.id
  WHERE (
    -- Match by user_id (UUID) from resolved canonical_users
    (resolved_user_uuid IS NOT NULL AND bl.user_id = resolved_user_uuid)
    -- Or match via metadata canonical_user_id
    OR (resolved_canonical_user_id IS NOT NULL AND bl.metadata->>'canonical_user_id' = resolved_canonical_user_id)
    -- Or match via metadata wallet_address
    OR (resolved_wallet_address IS NOT NULL AND LOWER(bl.metadata->>'wallet_address') = resolved_wallet_address)
    OR (resolved_base_wallet_address IS NOT NULL AND LOWER(bl.metadata->>'wallet_address') = resolved_base_wallet_address)
    OR (resolved_eth_wallet_address IS NOT NULL AND LOWER(bl.metadata->>'wallet_address') = resolved_eth_wallet_address)
  )
  -- Only purchase entries (negative amounts = debits for purchases)
  AND bl.source = 'purchase'
  AND bl.amount < 0
  AND bl.metadata->>'competition_id' IS NOT NULL

  ORDER BY purchase_date DESC NULLS LAST;
END;
$$;

-- Also create the jsonb parameter variant for backwards compatibility
CREATE OR REPLACE FUNCTION public.get_comprehensive_user_dashboard_entries(params jsonb)
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
  user_id_param TEXT;
BEGIN
  -- Extract user identifier from params
  user_id_param := COALESCE(params->>'user_identifier', params->>'userId', params->>'user_id');

  IF user_id_param IS NULL OR user_id_param = '' THEN
    RAISE EXCEPTION 'Missing required parameter: user_identifier, userId, or user_id';
  END IF;

  -- Delegate to the TEXT version
  RETURN QUERY SELECT * FROM public.get_comprehensive_user_dashboard_entries(user_id_param);
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.get_comprehensive_user_dashboard_entries(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_comprehensive_user_dashboard_entries(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_comprehensive_user_dashboard_entries(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_comprehensive_user_dashboard_entries(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_comprehensive_user_dashboard_entries(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.get_comprehensive_user_dashboard_entries(jsonb) TO service_role;

COMMENT ON FUNCTION public.get_comprehensive_user_dashboard_entries(TEXT) IS
'Gets all user entries from joincompetition, tickets, user_transactions, pending_tickets, AND balance_ledger.
Resolves user from canonical_users table FIRST to get all associated identifiers.
Includes ALL valid completed status values: completed, complete, finished, confirmed, success, paid.
Includes balance_ledger entries where source=purchase for balance-based payments.';

-- ============================================================================
-- Validation
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'FIX: Live Competitions - Pull from user_transactions';
  RAISE NOTICE 'and balance_ledger';
  RAISE NOTICE '=====================================================';
  RAISE NOTICE '* Updated get_user_competition_entries RPC:';
  RAISE NOTICE '  - Added ALL valid completed statuses (completed, complete, finished, confirmed, success, paid)';
  RAISE NOTICE '  - Added balance_ledger query for balance-based purchases';
  RAISE NOTICE '=====================================================';
  RAISE NOTICE '* Updated get_comprehensive_user_dashboard_entries RPC:';
  RAISE NOTICE '  - Added ALL valid completed statuses (completed, complete, finished, confirmed, success, paid)';
  RAISE NOTICE '  - Added balance_ledger query (Part 5) for balance-based purchases';
  RAISE NOTICE '  - Added jsonb parameter variant for backwards compatibility';
  RAISE NOTICE '=====================================================';
END $$;

COMMIT;
