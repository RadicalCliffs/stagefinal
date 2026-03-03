-- Migration: Add missing fields to get_user_competition_entries RPC
-- Problem: RPC doesn't return ticket_price or amount_spent, causing:
--          1. ticket_price defaults to $1, giving wrong totals (should be $0.50 etc)
--          2. amount_spent unavailable for detailed breakdowns
-- Solution:  Add c.ticket_price and jc.amount_spent to RPC output
-- Date: 2026-03-03

DROP FUNCTION IF EXISTS get_user_competition_entries(TEXT) CASCADE;

CREATE OR REPLACE FUNCTION get_user_competition_entries(p_user_identifier TEXT)
RETURNS TABLE (
  entry_id TEXT,
  competition_id TEXT,
  competition_title TEXT,
  competition_image TEXT,
  ticket_count INTEGER,
  ticket_numbers TEXT,
  entry_status TEXT,
  competition_status TEXT,
  competition_end_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  ticket_price NUMERIC,
  amount_spent NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  lower_identifier TEXT;
  search_wallet TEXT;
  v_uuid_regex TEXT := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
  lower_identifier := LOWER(TRIM(p_user_identifier));

  IF p_user_identifier LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(p_user_identifier FROM 11));
  ELSIF p_user_identifier LIKE '0x%' THEN
    search_wallet := lower_identifier;
  ELSE
    search_wallet := NULL;
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(jc.uid, jc.id::TEXT, gen_random_uuid()::TEXT),
    COALESCE(jc.competitionid, c.id::TEXT),
    COALESCE(c.title, ''),
    COALESCE(c.image_url, c.imageurl, ''),
    COALESCE(jc.numberoftickets, 0)::INTEGER,
    COALESCE(jc.ticketnumbers, ''),
    'confirmed',
    COALESCE(c.status, 'active'),
    c.end_date,
    COALESCE(jc.created_at, NOW()),
    COALESCE(c.ticket_price, 1.00),  -- Add ticket_price from competition
    COALESCE(jc.amount_spent, jc.numberoftickets * c.ticket_price, 0)  -- Add actual amount_spent
  FROM joincompetition jc
  LEFT JOIN competitions c ON (
    -- FIX: competitionid is TEXT, use regex check before casting to UUID
    (jc.competitionid ~* v_uuid_regex AND jc.competitionid::UUID = c.id)
    OR c.uid = jc.competitionid
  )
  WHERE
    LOWER(jc.wallet_address) = lower_identifier
    OR jc.canonical_user_id = p_user_identifier
    OR jc.privy_user_id = p_user_identifier
    OR jc.userid::TEXT = p_user_identifier
    OR (search_wallet IS NOT NULL AND LOWER(jc.wallet_address) = search_wallet)
  ORDER BY jc.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_user_competition_entries(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_competition_entries(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_user_competition_entries(TEXT) TO service_role;

-- ============================================================================
-- SUMMARY
-- ============================================================================
-- This migration adds missing fields to get_user_competition_entries:
-- 1. ticket_price: From competitions table, defaults to $1.00 if null
-- 2. amount_spent: From joincompetition.amount_spent, with fallback calculation
--
-- This allows frontend to:
-- - Display correct summary totals: ticket_count × ACTUAL ticket_price
-- - Show actual amounts paid when available
-- - Calculate totals correctly for competitions with prices other than $1
-- ============================================================================
