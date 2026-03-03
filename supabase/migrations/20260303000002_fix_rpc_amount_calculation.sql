-- Migration: Fix RPC to use actual amount_spent instead of calculating it
-- Problem: get_comprehensive_user_dashboard_entries calculates amount_spent as
--          numberoftickets * ticket_price instead of using actual amount_spent field
-- Solution: Use jc.amount_spent directly for joincompetition entries
-- Date: 2026-03-03

-- ============================================================================
-- FIX: Update get_comprehensive_user_dashboard_entries RPC
-- ============================================================================

DROP FUNCTION IF EXISTS get_comprehensive_user_dashboard_entries(TEXT) CASCADE;

CREATE OR REPLACE FUNCTION public.get_comprehensive_user_dashboard_entries(user_identifier TEXT)
RETURNS TABLE (
  id TEXT, competition_id TEXT, title TEXT, description TEXT,
  image TEXT, status TEXT, entry_type TEXT, is_winner BOOLEAN,
  ticket_numbers TEXT, total_tickets INTEGER, total_amount_spent NUMERIC,
  purchase_date TIMESTAMPTZ, transaction_hash TEXT, is_instant_win BOOLEAN,
  prize_value NUMERIC, competition_status TEXT, end_date TIMESTAMPTZ
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
  v_uuid_regex TEXT := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
  lower_identifier := LOWER(TRIM(user_identifier));

  IF user_identifier LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(user_identifier FROM 11));
  ELSIF user_identifier LIKE '0x%' THEN
    search_wallet := lower_identifier;
  ELSE
    search_wallet := NULL;
  END IF;

  SELECT cu.canonical_user_id, LOWER(cu.wallet_address), LOWER(cu.base_wallet_address),
         LOWER(cu.eth_wallet_address), cu.privy_user_id, cu.uid
  INTO resolved_canonical_user_id, resolved_wallet_address, resolved_base_wallet_address,
       resolved_eth_wallet_address, resolved_privy_user_id, resolved_uid
  FROM canonical_users cu
  WHERE cu.canonical_user_id = user_identifier
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

  -- Part 1: joincompetition entries
  SELECT
    COALESCE(jc.uid, 'jc-' || COALESCE(jc.competitionid, '') || '-' || COALESCE(jc.wallet_address, '') || '-' || COALESCE(jc.created_at::TEXT, '')),
    COALESCE(jc.competitionid, c.id::TEXT, c.uid),
    COALESCE(c.title, ''), COALESCE(c.description, ''),
    COALESCE(c.image_url, c.imageurl, ''),
    CASE
      WHEN c.winner_address IS NOT NULL THEN 'completed'
      WHEN c.status = 'active' THEN 'live'
      WHEN c.status IN ('drawn', 'completed') THEN 'completed'
      ELSE COALESCE(c.status, 'live')
    END,
    'competition_entry',
    COALESCE(LOWER(c.winner_address) = LOWER(jc.wallet_address), FALSE),
    COALESCE(jc.ticketnumbers, ''),
    COALESCE(jc.numberoftickets, 0)::INTEGER,
    -- FIX: Use actual amount_spent from joincompetition, not calculated value
    COALESCE(jc.amount_spent, 0),
    COALESCE(jc.purchasedate, jc.created_at),
    jc.transactionhash,
    COALESCE(c.is_instant_win, FALSE),
    c.prize_value,
    COALESCE(c.status, 'completed'),
    c.end_date
  FROM public.joincompetition jc
  LEFT JOIN public.competitions c ON (
    -- FIX: competitionid is TEXT, c.id is UUID - use regex check then cast
    (jc.competitionid ~* v_uuid_regex AND jc.competitionid::UUID = c.id)
    OR c.uid = jc.competitionid
  )
  WHERE (
    (resolved_canonical_user_id IS NOT NULL AND jc.canonical_user_id = resolved_canonical_user_id)
    OR (resolved_wallet_address IS NOT NULL AND LOWER(jc.wallet_address) = resolved_wallet_address)
    OR (resolved_base_wallet_address IS NOT NULL AND LOWER(jc.wallet_address) = resolved_base_wallet_address)
    OR (resolved_eth_wallet_address IS NOT NULL AND LOWER(jc.wallet_address) = resolved_eth_wallet_address)
    OR (resolved_privy_user_id IS NOT NULL AND jc.privy_user_id = resolved_privy_user_id)
    OR (resolved_uid IS NOT NULL AND jc.userid::TEXT = resolved_uid)
    OR (resolved_canonical_user_id IS NULL AND (
      jc.canonical_user_id = user_identifier
      OR LOWER(jc.wallet_address) = lower_identifier
      OR jc.userid::TEXT = user_identifier
      OR (search_wallet IS NOT NULL AND LOWER(jc.wallet_address) = search_wallet)
    ))
  )
  AND jc.competitionid IS NOT NULL AND jc.competitionid != ''
  AND (c.id IS NOT NULL OR jc.competitionid IS NOT NULL)

  UNION ALL

  -- Part 2: tickets table entries (grouped by user+competition)
  SELECT
    ('tickets-' || COALESCE(t.canonical_user_id, t.user_id, 'anon-' || t.competition_id::TEXT) || '-' || t.competition_id::TEXT)::TEXT,
    t.competition_id::TEXT,
    COALESCE(c.title, ''), COALESCE(c.description, ''),
    COALESCE(c.image_url, c.imageurl, ''),
    CASE
      WHEN c.winner_address IS NOT NULL THEN 'completed'
      WHEN c.status = 'active' THEN 'live'
      WHEN c.status IN ('drawn', 'completed') THEN 'completed'
      ELSE COALESCE(c.status, 'live')
    END,
    'ticket',
    COALESCE(BOOL_OR(t.is_winner), FALSE),
    STRING_AGG(t.ticket_number::TEXT, ',' ORDER BY t.ticket_number),
    COUNT(t.id)::INTEGER,
    -- FIX: Use actual purchase_price from tickets, not ticket_price from competition
    SUM(COALESCE(t.purchase_price, 0)),
    MIN(t.purchased_at),
    NULL::TEXT,
    COALESCE(c.is_instant_win, FALSE),
    c.prize_value,
    COALESCE(c.status, 'completed'),
    c.end_date
  FROM public.tickets t
  LEFT JOIN public.competitions c ON t.competition_id = c.id  -- UUID = UUID
  WHERE (
    (resolved_canonical_user_id IS NOT NULL AND t.canonical_user_id = resolved_canonical_user_id)
    OR (resolved_wallet_address IS NOT NULL AND LOWER(t.user_id) = resolved_wallet_address)
    OR (resolved_base_wallet_address IS NOT NULL AND LOWER(t.user_id) = resolved_base_wallet_address)
    OR (resolved_eth_wallet_address IS NOT NULL AND LOWER(t.user_id) = resolved_eth_wallet_address)
    OR (resolved_privy_user_id IS NOT NULL AND t.privy_user_id = resolved_privy_user_id)
    OR (resolved_uid IS NOT NULL AND t.user_id = resolved_uid)
    OR (resolved_canonical_user_id IS NULL AND (
      t.canonical_user_id = user_identifier
      OR LOWER(t.user_id) = lower_identifier
      OR t.privy_user_id = user_identifier
      OR (search_wallet IS NOT NULL AND LOWER(t.user_id) = search_wallet)
    ))
  )
  AND t.competition_id IS NOT NULL
  GROUP BY t.canonical_user_id, t.user_id, t.competition_id, c.id, c.uid, c.title, c.description,
           c.image_url, c.imageurl, c.status, c.winner_address, c.is_instant_win, c.prize_value, c.end_date

  UNION ALL

  -- Part 3: pending_tickets entries (still awaiting payment)
  SELECT
    ('pending-' || COALESCE(pt.canonical_user_id, pt.user_id, 'anon') || '-' || COALESCE(pt.competition_id::TEXT, 'unknown'))::TEXT,
    COALESCE(pt.competition_id::TEXT, 'unknown'),
    COALESCE(c.title, ''), COALESCE(c.description, ''),
    COALESCE(c.image_url, c.imageurl, ''),
    'pending',
    'pending',
    FALSE,
    STRING_AGG(pt.ticket_number::TEXT, ',' ORDER BY pt.ticket_number),
    COUNT(pt.id)::INTEGER,
    -- FIX: Use actual purchase_price from pending_tickets
    SUM(COALESCE(pt.purchase_price, 0)),
    MIN(pt.created_at),
    NULL::TEXT,
    COALESCE(c.is_instant_win, FALSE),
    c.prize_value,
    COALESCE(c.status, 'active'),
    c.end_date
  FROM public.pending_tickets pt
  LEFT JOIN public.competitions c ON pt.competition_id = c.id  -- UUID = UUID
  WHERE (
    (resolved_canonical_user_id IS NOT NULL AND pt.canonical_user_id = resolved_canonical_user_id)
    OR (resolved_wallet_address IS NOT NULL AND LOWER(pt.user_id) = resolved_wallet_address)
    OR (resolved_base_wallet_address IS NOT NULL AND LOWER(pt.user_id) = resolved_base_wallet_address)
    OR (resolved_eth_wallet_address IS NOT NULL AND LOWER(pt.user_id) = resolved_eth_wallet_address)
    OR (resolved_privy_user_id IS NOT NULL AND pt.privy_user_id = resolved_privy_user_id)
    OR (resolved_uid IS NOT NULL AND pt.user_id = resolved_uid)
    OR (resolved_canonical_user_id IS NULL AND (
      pt.canonical_user_id = user_identifier
      OR LOWER(pt.user_id) = lower_identifier
      OR pt.privy_user_id = user_identifier
      OR (search_wallet IS NOT NULL AND LOWER(pt.user_id) = search_wallet)
    ))
  )
  AND pt.competition_id IS NOT NULL
  AND pt.expires_at > NOW() -- Only return pending tickets that haven't expired
  GROUP BY pt.canonical_user_id, pt.user_id, pt.competition_id, c.id, c.uid, c.title, c.description,
           c.image_url, c.imageurl, c.status, c.is_instant_win, c.prize_value, c.end_date;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.get_comprehensive_user_dashboard_entries(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_comprehensive_user_dashboard_entries(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_comprehensive_user_dashboard_entries(TEXT) TO service_role;

-- ============================================================================
-- SUMMARY
-- ============================================================================
-- This migration fixes amount calculation in get_comprehensive_user_dashboard_entries:
-- 1. joincompetition: Use actual amount_spent field, not numberoftickets * ticket_price
-- 2. tickets: Use actual purchase_price, not ticket_price from competition
-- 3. pending_tickets: Use actual purchase_price
-- 
-- This ensures displayed amounts match what was actually paid, not recalculated values
-- that may differ due to discounts, bonuses, or pricing changes.
-- ============================================================================
