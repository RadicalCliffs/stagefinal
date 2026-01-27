-- Migration: Enrich competition_entries amount_paid from balance_ledger when it's 0
-- This ensures entries purchased with balance show the correct cost even if competition_entries.amount_paid is 0

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

  -- CRITICAL FIX: ALWAYS return data from ALL sources (competition_entries, user_transactions, orders, AND balance_ledger)
  -- This ensures balance_ledger entries show up even when competition_entries has other data
  RETURN QUERY
  
  -- Source 1: competition_entries (if any exist)
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

  UNION ALL

  -- Source 2: user_transactions with ALL valid completed statuses
    SELECT
      ut.id::UUID AS id,
      ut.competition_id::UUID AS competition_id,
      ut.user_id AS user_id,
      ut.canonical_user_id AS canonical_user_id,
      ut.wallet_address AS wallet_address,
      -- REVERSE ENGINEER ticket_numbers from tickets table
      COALESCE(
        (
          SELECT ARRAY_AGG(t.ticket_number ORDER BY t.ticket_number)
          FROM tickets t
          WHERE t.competition_id = ut.competition_id::UUID
            AND (
              (resolved_user_uuid IS NOT NULL AND t.user_id = resolved_user_uuid)
              OR (t.privy_user_id = ut.user_id)
              OR (t.privy_user_id = ut.canonical_user_id)
              OR (resolved_canonical_user_id IS NOT NULL AND t.privy_user_id = resolved_canonical_user_id)
            )
            AND ABS(EXTRACT(EPOCH FROM (t.created_at - ut.created_at))) < 30
        ),
        -- Fallback to competition_entries
        (
          SELECT ce.ticket_numbers
          FROM competition_entries ce
          WHERE ce.competition_id = ut.competition_id::UUID
            AND (
              (ut.canonical_user_id IS NOT NULL AND ce.canonical_user_id = ut.canonical_user_id)
              OR (ut.wallet_address IS NOT NULL AND LOWER(ce.wallet_address) = LOWER(ut.wallet_address))
            )
            AND ABS(EXTRACT(EPOCH FROM (ce.created_at - ut.created_at))) < 30
          ORDER BY ce.created_at DESC
          LIMIT 1
        ),
        ARRAY[]::INTEGER[]
      ) AS ticket_numbers,
      COALESCE(
        ut.ticket_count,
        -- Reverse engineer count from tickets table
        (
          SELECT COUNT(*)::INTEGER
          FROM tickets t
          WHERE t.competition_id = ut.competition_id::UUID
            AND (
              (resolved_user_uuid IS NOT NULL AND t.user_id = resolved_user_uuid)
              OR (t.privy_user_id = ut.user_id)
              OR (t.privy_user_id = ut.canonical_user_id)
              OR (resolved_canonical_user_id IS NOT NULL AND t.privy_user_id = resolved_canonical_user_id)
            )
            AND ABS(EXTRACT(EPOCH FROM (t.created_at - ut.created_at))) < 30
        ),
        0
      ) AS ticket_count,
      COALESCE(ut.amount, 0) AS amount_paid,
      COALESCE(ut.currency, 'USD') AS currency,
      COALESCE(ut.tx_id, ut.charge_id, ut.charge_code) AS transaction_hash,
      COALESCE(ut.payment_provider, ut.primary_provider) AS payment_provider,
      CASE
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
    AND LOWER(ut.status) IN ('completed', 'complete', 'finished', 'confirmed', 'success', 'paid')
  
  UNION ALL

  -- Source 3: orders table
    SELECT
      o.id::UUID AS id,
      o.competition_id::UUID AS competition_id,
      o.user_id AS user_id,
      NULL::TEXT AS canonical_user_id,
      NULL::TEXT AS wallet_address,
      -- REVERSE ENGINEER ticket_numbers from tickets or competition_entries
      COALESCE(
        (
          SELECT ARRAY_AGG(t.ticket_number ORDER BY t.ticket_number)
          FROM tickets t
          WHERE t.competition_id = o.competition_id::UUID
            AND (
              (resolved_user_uuid IS NOT NULL AND t.user_id = resolved_user_uuid)
              OR (t.privy_user_id = o.user_id)
            )
            AND ABS(EXTRACT(EPOCH FROM (t.created_at - COALESCE(o.completed_at, o.created_at)))) < 30
        ),
        (
          SELECT ce.ticket_numbers
          FROM competition_entries ce
          WHERE ce.competition_id = o.competition_id::UUID
            AND ce.user_id = o.user_id
            AND ABS(EXTRACT(EPOCH FROM (ce.created_at - COALESCE(o.completed_at, o.created_at)))) < 30
          ORDER BY ce.created_at DESC
          LIMIT 1
        ),
        ARRAY[]::INTEGER[]
      ) AS ticket_numbers,
      COALESCE(
        o.ticket_count,
        -- Reverse engineer count
        (
          SELECT COUNT(*)::INTEGER
          FROM tickets t
          WHERE t.competition_id = o.competition_id::UUID
            AND (
              (resolved_user_uuid IS NOT NULL AND t.user_id = resolved_user_uuid)
              OR (t.privy_user_id = o.user_id)
            )
            AND ABS(EXTRACT(EPOCH FROM (t.created_at - COALESCE(o.completed_at, o.created_at)))) < 30
        ),
        0
      ) AS ticket_count,
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

  -- Source 4: balance_ledger (CRITICAL - for balance-based purchases)
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
      -- REVERSE ENGINEER ticket_numbers: Try multiple strategies in order of preference
      COALESCE(
        -- Strategy 1: Extract from metadata if available (fastest)
        (
          CASE
            WHEN bl.metadata->>'ticket_numbers' IS NOT NULL THEN
              (SELECT ARRAY_AGG((value::text)::INTEGER) 
               FROM jsonb_array_elements_text((bl.metadata->>'ticket_numbers')::jsonb))
            ELSE NULL
          END
        ),
        -- Strategy 2: Query tickets table to reverse engineer (match by competition, user, timestamp within 30 seconds)
        (
          SELECT ARRAY_AGG(t.ticket_number ORDER BY t.ticket_number)
          FROM tickets t
          WHERE t.competition_id = (bl.metadata->>'competition_id')::UUID
            AND (
              (resolved_user_uuid IS NOT NULL AND t.user_id = resolved_user_uuid)
              OR (t.privy_user_id = p_user_identifier)
              OR (resolved_canonical_user_id IS NOT NULL AND t.privy_user_id = resolved_canonical_user_id)
            )
            AND ABS(EXTRACT(EPOCH FROM (t.created_at - bl.created_at))) < 30
        ),
        -- Strategy 3: Query competition_entries table (match by competition, user, timestamp within 30 seconds)
        (
          SELECT ce.ticket_numbers
          FROM competition_entries ce
          WHERE ce.competition_id = (bl.metadata->>'competition_id')::UUID
            AND (
              (resolved_canonical_user_id IS NOT NULL AND ce.canonical_user_id = resolved_canonical_user_id)
              OR (resolved_wallet_address IS NOT NULL AND LOWER(ce.wallet_address) = resolved_wallet_address)
            )
            AND ABS(EXTRACT(EPOCH FROM (ce.created_at - bl.created_at))) < 30
          ORDER BY ce.created_at DESC
          LIMIT 1
        ),
        -- Fallback: empty array
        ARRAY[]::INTEGER[]
      ) AS ticket_numbers,
      -- Also reverse engineer ticket_count if not in metadata
      COALESCE(
        (bl.metadata->>'ticket_count')::INTEGER,
        -- Count from tickets table
        (
          SELECT COUNT(*)::INTEGER
          FROM tickets t
          WHERE t.competition_id = (bl.metadata->>'competition_id')::UUID
            AND (
              (resolved_user_uuid IS NOT NULL AND t.user_id = resolved_user_uuid)
              OR (t.privy_user_id = p_user_identifier)
              OR (resolved_canonical_user_id IS NOT NULL AND t.privy_user_id = resolved_canonical_user_id)
            )
            AND ABS(EXTRACT(EPOCH FROM (t.created_at - bl.created_at))) < 30
        ),
        1
      ) AS ticket_count,
      ABS(bl.amount) AS amount_paid,
      'USD' AS currency,
      COALESCE(
        bl.transaction_id::TEXT,
        bl.metadata->>'transaction_id',
        bl.metadata->>'transaction_hash',
        bl.metadata->>'order_id',
        bl.reference_id
      ) AS transaction_hash,
      COALESCE(bl.metadata->>'payment_provider', 'balance') AS payment_provider,
      'confirmed' AS entry_status,
      FALSE AS is_winner,
      FALSE AS prize_claimed,
      bl.created_at::TIMESTAMPTZ AS created_at,
      bl.created_at::TIMESTAMPTZ AS updated_at,
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
      (resolved_user_uuid IS NOT NULL AND bl.user_id = resolved_user_uuid)
      OR (resolved_canonical_user_id IS NOT NULL AND bl.metadata->>'canonical_user_id' = resolved_canonical_user_id)
      OR (resolved_wallet_address IS NOT NULL AND LOWER(bl.metadata->>'wallet_address') = resolved_wallet_address)
      OR (resolved_base_wallet_address IS NOT NULL AND LOWER(bl.metadata->>'wallet_address') = resolved_base_wallet_address)
    )
    AND bl.source IN ('purchase', 'ticket_purchase')
    AND bl.amount < 0
    AND bl.metadata->>'competition_id' IS NOT NULL

  ORDER BY created_at DESC;
END;
$$;

-- Add helpful comment explaining the fix
COMMENT ON FUNCTION get_user_competition_entries(TEXT) IS
'Returns user competition entries from ALL sources: competition_entries, user_transactions, orders, AND balance_ledger.
CRITICAL FIX: Now ALWAYS queries balance_ledger (not just as fallback), ensuring balance purchases show up even when other entries exist in competition_entries.
REVERSE ENGINEERING: For balance_ledger, user_transactions, and orders entries that lack ticket_numbers, the function queries the tickets table and competition_entries table to reverse engineer the actual ticket numbers purchased. Matches by competition_id, user, and timestamp (within 30 seconds).
All sources are UNIONed together to ensure complete visibility of all user entries.
Deduplication happens on the frontend.';

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION get_user_competition_entries(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_competition_entries(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_user_competition_entries(TEXT) TO service_role;
