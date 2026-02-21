-- ============================================================
-- HOTFIX V2: Fix get_comprehensive_user_dashboard_entries
-- Simpler version that avoids the UUID/regex type issue
-- ============================================================

-- First diagnose - check your tickets
SELECT 
  t.ticket_number,
  t.competition_id,
  t.canonical_user_id,
  t.wallet_address,
  t.user_id,
  t.purchased_at,
  c.title as competition_title
FROM tickets t
LEFT JOIN competitions c ON t.competition_id = c.id
WHERE t.canonical_user_id LIKE 'prize:pid:0x0ff51ec0%'
   OR LOWER(t.wallet_address) = '0x0ff51ec0ecc9ae1e5e6048976ba307c849781363'
ORDER BY t.purchased_at DESC
LIMIT 20;

-- STEP 1: Run this DROP first
DROP FUNCTION IF EXISTS public.get_comprehensive_user_dashboard_entries(TEXT);
DROP FUNCTION IF EXISTS public.get_comprehensive_user_dashboard_entries(p_user_identifier TEXT);

-- STEP 2: Then run the CREATE (run separately after the DROP succeeds)
CREATE OR REPLACE FUNCTION public.get_comprehensive_user_dashboard_entries(p_user_identifier TEXT)
RETURNS TABLE (
  id TEXT,
  competition_id UUID,
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
BEGIN
  -- Normalize identifier
  lower_identifier := LOWER(TRIM(p_user_identifier));

  -- Extract wallet address if present
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
    LOWER(cu.eth_wallet_address),
    cu.privy_user_id,
    cu.uid
  INTO
    resolved_canonical_user_id,
    resolved_wallet_address,
    resolved_base_wallet_address,
    resolved_eth_wallet_address,
    resolved_privy_user_id,
    resolved_uid
  FROM canonical_users cu
  WHERE
    cu.canonical_user_id = p_user_identifier
    OR LOWER(cu.wallet_address) = lower_identifier
    OR LOWER(cu.base_wallet_address) = lower_identifier
    OR LOWER(cu.eth_wallet_address) = lower_identifier
    OR cu.privy_user_id = p_user_identifier
    OR cu.uid = p_user_identifier
    OR (search_wallet IS NOT NULL AND (
      LOWER(cu.wallet_address) = search_wallet
      OR LOWER(cu.base_wallet_address) = search_wallet
      OR LOWER(cu.eth_wallet_address) = search_wallet
    ))
  LIMIT 1;

  RETURN QUERY

  -- Part 1: Entries from joincompetition table (simplified join)
  SELECT
    jc.id::TEXT AS id,
    jc.competition_id::UUID AS competition_id,
    COALESCE(c.title, '') AS title,
    COALESCE(c.description, '') AS description,
    COALESCE(c.image_url, '') AS image,
    CASE
      WHEN c.winner_address IS NOT NULL THEN 'completed'
      WHEN c.status = 'active' THEN 'live'
      WHEN c.status IN ('drawn', 'completed') THEN 'completed'
      ELSE COALESCE(c.status, 'live')
    END AS status,
    'joincompetition' AS entry_type,
    COALESCE(jc.is_winner, LOWER(c.winner_address) = LOWER(jc.wallet_address), FALSE) AS is_winner,
    COALESCE(jc.ticket_numbers, '') AS ticket_numbers,
    COALESCE(jc.ticket_count, 0)::INTEGER AS total_tickets,
    COALESCE(jc.ticket_count * c.ticket_price, jc.amount_spent, 0) AS total_amount_spent,
    COALESCE(jc.purchase_date, jc.created_at) AS purchase_date,
    COALESCE(jc.transaction_hash, jc.transactionhash) AS transaction_hash,
    COALESCE(c.is_instant_win, FALSE) AS is_instant_win,
    c.prize_value AS prize_value,
    COALESCE(c.status, 'active') AS competition_status,
    c.end_date AS end_date
  FROM public.joincompetition jc
  LEFT JOIN public.competitions c ON jc.competition_id = c.id
  WHERE (
    (resolved_canonical_user_id IS NOT NULL AND jc.canonical_user_id = resolved_canonical_user_id)
    OR (resolved_wallet_address IS NOT NULL AND LOWER(jc.wallet_address) = resolved_wallet_address)
    OR (resolved_base_wallet_address IS NOT NULL AND LOWER(jc.wallet_address) = resolved_base_wallet_address)
    OR (resolved_eth_wallet_address IS NOT NULL AND LOWER(jc.wallet_address) = resolved_eth_wallet_address)
    OR (resolved_privy_user_id IS NOT NULL AND (jc.privy_user_id = resolved_privy_user_id OR jc.user_privy_id = resolved_privy_user_id))
    OR (resolved_uid IS NOT NULL AND jc.user_id = resolved_uid)
    OR (resolved_canonical_user_id IS NULL AND (
      jc.canonical_user_id = p_user_identifier
      OR LOWER(jc.wallet_address) = lower_identifier
      OR jc.user_id = p_user_identifier
      OR (search_wallet IS NOT NULL AND LOWER(jc.wallet_address) = search_wallet)
    ))
  )
  AND jc.competition_id IS NOT NULL

  UNION ALL

  -- Part 2: Entries from tickets table
  -- FIXED: Now checks BOTH t.user_id AND t.wallet_address
  SELECT
    ('tickets-' || t.competition_id::TEXT || '-' || COALESCE(t.canonical_user_id, t.wallet_address, 'anon'))::TEXT AS id,
    t.competition_id::UUID AS competition_id,
    COALESCE(c.title, '') AS title,
    COALESCE(c.description, '') AS description,
    COALESCE(c.image_url, '') AS image,
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
    COALESCE(c.status, 'active') AS competition_status,
    c.end_date AS end_date
  FROM public.tickets t
  LEFT JOIN public.competitions c ON t.competition_id = c.id
  WHERE (
    -- Check canonical_user_id (primary)
    (resolved_canonical_user_id IS NOT NULL AND t.canonical_user_id = resolved_canonical_user_id)
    -- Check user_id column
    OR (resolved_wallet_address IS NOT NULL AND LOWER(t.user_id) = resolved_wallet_address)
    OR (resolved_base_wallet_address IS NOT NULL AND LOWER(t.user_id) = resolved_base_wallet_address)
    OR (resolved_eth_wallet_address IS NOT NULL AND LOWER(t.user_id) = resolved_eth_wallet_address)
    -- FIX: Also check wallet_address column (this was missing!)
    OR (resolved_wallet_address IS NOT NULL AND LOWER(t.wallet_address) = resolved_wallet_address)
    OR (resolved_base_wallet_address IS NOT NULL AND LOWER(t.wallet_address) = resolved_base_wallet_address)
    OR (resolved_eth_wallet_address IS NOT NULL AND LOWER(t.wallet_address) = resolved_eth_wallet_address)
    -- Fallback direct matching
    OR (resolved_canonical_user_id IS NULL AND (
      t.canonical_user_id = p_user_identifier
      OR LOWER(t.user_id) = lower_identifier
      OR LOWER(t.wallet_address) = lower_identifier
      OR (search_wallet IS NOT NULL AND (LOWER(t.user_id) = search_wallet OR LOWER(t.wallet_address) = search_wallet))
    ))
  )
  AND t.competition_id IS NOT NULL
  GROUP BY t.competition_id, t.canonical_user_id, t.wallet_address, t.is_winner, c.id, c.title, c.description, c.image_url,
           c.status, c.winner_address, c.is_instant_win, c.prize_value, c.end_date, c.ticket_price

  UNION ALL

  -- Part 3: Entries from user_transactions
  SELECT
    ut.id::TEXT AS id,
    ut.competition_id::UUID AS competition_id,
    COALESCE(c.title, '') AS title,
    COALESCE(c.description, '') AS description,
    COALESCE(c.image_url, '') AS image,
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
    COALESCE(ut.tx_id, ut.charge_id, ut.charge_code, ut.tx_ref, ut.order_id::TEXT) AS transaction_hash,
    COALESCE(c.is_instant_win, FALSE) AS is_instant_win,
    c.prize_value AS prize_value,
    COALESCE(c.status, 'active') AS competition_status,
    c.end_date AS end_date
  FROM public.user_transactions ut
  LEFT JOIN public.competitions c ON ut.competition_id = c.id
  WHERE (
    (resolved_canonical_user_id IS NOT NULL AND ut.canonical_user_id = resolved_canonical_user_id)
    OR (resolved_wallet_address IS NOT NULL AND LOWER(ut.wallet_address) = resolved_wallet_address)
    OR (resolved_base_wallet_address IS NOT NULL AND LOWER(ut.wallet_address) = resolved_base_wallet_address)
    OR (resolved_eth_wallet_address IS NOT NULL AND LOWER(ut.wallet_address) = resolved_eth_wallet_address)
    OR (resolved_privy_user_id IS NOT NULL AND ut.user_privy_id = resolved_privy_user_id)
    OR (resolved_uid IS NOT NULL AND ut.user_id = resolved_uid)
    OR (resolved_canonical_user_id IS NULL AND (
      ut.canonical_user_id = p_user_identifier
      OR ut.user_id = p_user_identifier
      OR ut.user_privy_id = p_user_identifier
      OR LOWER(ut.wallet_address) = lower_identifier
      OR (search_wallet IS NOT NULL AND LOWER(ut.wallet_address) = search_wallet)
    ))
  )
  AND ut.competition_id IS NOT NULL
  AND ut.payment_status != 'failed'

  UNION ALL

  -- Part 4: Entries from pending_tickets (only pending ones)
  SELECT
    pt.id::TEXT AS id,
    pt.competition_id::UUID AS competition_id,
    COALESCE(c.title, '') AS title,
    COALESCE(c.description, '') AS description,
    COALESCE(c.image_url, '') AS image,
    CASE
      WHEN pt.status = 'confirmed' THEN 'live'
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
      pt.canonical_user_id = p_user_identifier
      OR pt.user_id = p_user_identifier
      OR LOWER(pt.user_id) = lower_identifier
      OR LOWER(pt.wallet_address) = lower_identifier
      OR (search_wallet IS NOT NULL AND (LOWER(pt.user_id) = search_wallet OR LOWER(pt.wallet_address) = search_wallet))
    ))
  )
  AND pt.competition_id IS NOT NULL
  AND pt.status = 'pending';

END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.get_comprehensive_user_dashboard_entries(TEXT) TO anon, authenticated, service_role;

-- Test the fix
SELECT * FROM get_comprehensive_user_dashboard_entries('prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363') LIMIT 10;
