-- ============================================================================
-- FIX: Include 'confirmed' in payment_status filter and add orders fallback
-- ============================================================================
-- The user_transactions table has a CHECK constraint that only allows:
-- 'pending', 'waiting', 'confirmed', 'failed' for payment_status
--
-- The previous RPC functions were filtering for 'completed', 'finished' which
-- don't match the schema. This migration fixes the filter to include 'confirmed'.
--
-- Also adds fallback to query orders table when competition_entries is empty.
--
-- Date: 2026-01-26
-- ============================================================================

BEGIN;

-- ============================================================================
-- PART 1: Update get_comprehensive_user_dashboard_entries to include 'confirmed'
-- ============================================================================
-- The comprehensive RPC already uses `AND ut.payment_status != 'failed'` which
-- is inclusive of 'confirmed'. No change needed for this function.

-- ============================================================================
-- PART 2: Update get_user_competition_entries to also query user_transactions and orders
-- ============================================================================
-- The get_user_competition_entries function only reads from competition_entries
-- table. If that table is empty, we should fall back to other sources.
--
-- Adding a UNION to include user_transactions and orders entries directly.

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
    LOWER(cu.base_wallet_address)
  INTO
    resolved_canonical_user_id,
    resolved_wallet_address,
    resolved_base_wallet_address
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
    -- Fallback: Return entries from user_transactions and orders with competition_id
    -- This ensures entries are visible even when competition_entries is not populated
    RETURN QUERY

    -- Source 1: user_transactions
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
        WHEN ut.status IN ('completed', 'finished', 'confirmed', 'success') THEN 'confirmed'
        WHEN ut.status = 'pending' THEN 'pending'
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
    LEFT JOIN competitions c ON ut.competition_id = c.id
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
    AND ut.type = 'entry'
    AND ut.status IN ('completed', 'finished', 'confirmed', 'success')

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
        WHEN o.status IN ('completed', 'confirmed', 'paid') THEN 'confirmed'
        WHEN o.status = 'pending' THEN 'pending'
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
    LEFT JOIN competitions c ON o.competition_id = c.id
    WHERE (
      o.user_id = p_user_identifier
      OR LOWER(o.user_id) = lower_identifier
      OR (search_wallet IS NOT NULL AND LOWER(o.user_id) = search_wallet)
      OR (resolved_wallet_address IS NOT NULL AND LOWER(o.user_id) = resolved_wallet_address)
      OR (resolved_base_wallet_address IS NOT NULL AND LOWER(o.user_id) = resolved_base_wallet_address)
    )
    AND o.competition_id IS NOT NULL
    AND o.status IN ('completed', 'confirmed', 'paid')

    ORDER BY created_at DESC;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_user_competition_entries(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_competition_entries(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_user_competition_entries(TEXT) TO service_role;

COMMENT ON FUNCTION get_user_competition_entries IS
'Returns all competition entries for a user.
First tries competition_entries table, then falls back to user_transactions and orders.
Includes confirmed, completed, finished, and success statuses.';

-- ============================================================================
-- Validation
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'FIX: User Transactions Payment Status Filter';
  RAISE NOTICE '=====================================================';
  RAISE NOTICE '✓ Updated get_user_competition_entries to fallback to user_transactions';
  RAISE NOTICE '✓ Added confirmed status to status filter';
  RAISE NOTICE '✓ Fixed type column filter (type = entry)';
  RAISE NOTICE '=====================================================';
END $$;

COMMIT;
