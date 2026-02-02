-- =====================================================
-- EMERGENCY FIX: All Database Column Errors
-- =====================================================
-- This migration fixes ALL the critical errors causing dashboard to fail:
-- 1. Remove ce.expires_at from get_user_competition_entries (column doesn't exist)
-- 2. Fix UUID = TEXT type casting in JOINs
-- 3. Ensure all functions use correct column names
-- Date: 2026-02-02
-- =====================================================

BEGIN;

-- =====================================================
-- DROP ALL VERSIONS OF PROBLEMATIC FUNCTIONS
-- =====================================================

-- Drop get_user_competition_entries (all versions)
DROP FUNCTION IF EXISTS public.get_user_competition_entries(p_user_identifier text) CASCADE;
DROP FUNCTION IF EXISTS public.get_user_competition_entries(user_identifier text) CASCADE;
DROP FUNCTION IF EXISTS public.get_user_competition_entries(TEXT) CASCADE;
DROP FUNCTION IF EXISTS get_user_competition_entries(p_user_identifier text) CASCADE;
DROP FUNCTION IF EXISTS get_user_competition_entries(user_identifier text) CASCADE;
DROP FUNCTION IF EXISTS get_user_competition_entries(TEXT) CASCADE;

-- Drop get_comprehensive_user_dashboard_entries (all versions)
DROP FUNCTION IF EXISTS public.get_comprehensive_user_dashboard_entries(p_user_identifier text) CASCADE;
DROP FUNCTION IF EXISTS public.get_comprehensive_user_dashboard_entries(user_identifier text) CASCADE;
DROP FUNCTION IF EXISTS public.get_comprehensive_user_dashboard_entries(TEXT) CASCADE;
DROP FUNCTION IF EXISTS get_comprehensive_user_dashboard_entries(p_user_identifier text) CASCADE;
DROP FUNCTION IF EXISTS get_comprehensive_user_dashboard_entries(user_identifier text) CASCADE;
DROP FUNCTION IF EXISTS get_comprehensive_user_dashboard_entries(TEXT) CASCADE;

-- =====================================================
-- FIX 1: get_comprehensive_user_dashboard_entries
-- Fix type casting and ensure all columns exist
-- =====================================================

CREATE OR REPLACE FUNCTION public.get_comprehensive_user_dashboard_entries(p_user_identifier text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_entries JSONB;
  v_canonical_user_id TEXT;
  search_wallet TEXT;
BEGIN
  -- Extract wallet from prize:pid: format
  IF p_user_identifier LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(p_user_identifier FROM 11));
  ELSIF p_user_identifier LIKE '0x%' THEN
    search_wallet := LOWER(p_user_identifier);
  END IF;

  -- Resolve canonical user ID
  SELECT cu.canonical_user_id INTO v_canonical_user_id FROM canonical_users cu
  WHERE cu.canonical_user_id = p_user_identifier
     OR cu.uid = p_user_identifier
     OR (search_wallet IS NOT NULL AND LOWER(cu.wallet_address) = search_wallet)
  LIMIT 1;

  -- Aggregate entries from all sources
  -- FIXED: Cast competition_id properly to avoid UUID = text errors
  WITH competition_entries_source AS (
    SELECT
      ce.id,
      ce.competition_id::TEXT AS competition_id,
      c.title AS competition_name,
      c.image_url AS competition_image_url,
      ce.tickets_count AS ticket_count,
      ce.amount_spent,
      ce.latest_purchase_at AS purchase_date,
      NULL::text AS transaction_hash,
      c.prize_value,
      c.status AS competition_status,
      c.is_instant_win,
      ce.is_winner,
      ce.created_at
    FROM competition_entries ce
    LEFT JOIN competitions c ON ce.competition_id = c.id
    WHERE ce.canonical_user_id = v_canonical_user_id
       OR (search_wallet IS NOT NULL AND LOWER(ce.wallet_address) = search_wallet)
  ),
  user_transactions_source AS (
    SELECT
      ut.id,
      ut.competition_id::TEXT AS competition_id,
      c.title AS competition_name,
      c.image_url AS competition_image_url,
      ut.ticket_count,
      ut.amount AS amount_spent,
      ut.created_at AS purchase_date,
      ut.tx_id AS transaction_hash,
      c.prize_value,
      c.status AS competition_status,
      c.is_instant_win,
      false AS is_winner,
      ut.created_at
    FROM user_transactions ut
    LEFT JOIN competitions c ON ut.competition_id = c.id
    WHERE (ut.canonical_user_id = v_canonical_user_id
       OR ut.user_id = v_canonical_user_id
       OR (search_wallet IS NOT NULL AND LOWER(ut.wallet_address) = search_wallet))
      AND ut.status = 'completed'
      AND ut.competition_id IS NOT NULL
  ),
  joincompetition_source AS (
    SELECT
      jc.id::TEXT AS id,
      jc.competitionid::TEXT AS competition_id,
      c.title AS competition_name,
      c.image_url AS competition_image_url,
      1 AS ticket_count,
      0 AS amount_spent,
      jc.created_at AS purchase_date,
      jc.transactionhash AS transaction_hash,
      c.prize_value,
      c.status AS competition_status,
      c.is_instant_win,
      false AS is_winner,
      jc.created_at
    FROM joincompetition jc
    LEFT JOIN competitions c ON jc.competitionid::TEXT = c.id::TEXT
    WHERE (search_wallet IS NOT NULL AND LOWER(jc.wallet_address) = search_wallet)
       OR jc.privy_user_id = v_canonical_user_id
       OR jc.userid = p_user_identifier
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', combined.id,
      'competition_id', combined.competition_id,
      'competition_name', combined.competition_name,
      'competition_image_url', combined.competition_image_url,
      'ticket_count', combined.ticket_count,
      'amount_spent', combined.amount_spent,
      'purchase_date', combined.purchase_date,
      'transaction_hash', combined.transaction_hash,
      'prize_value', combined.prize_value,
      'competition_status', combined.competition_status,
      'is_instant_win', combined.is_instant_win,
      'is_winner', combined.is_winner
    )
    ORDER BY combined.purchase_date DESC
  ) INTO v_entries
  FROM (
    SELECT * FROM competition_entries_source
    UNION ALL
    SELECT * FROM user_transactions_source
    UNION ALL
    SELECT * FROM joincompetition_source
  ) combined;

  RETURN COALESCE(v_entries, '[]'::jsonb);
END;
$function$;

COMMENT ON FUNCTION get_comprehensive_user_dashboard_entries IS 
'Returns unified entries from competition_entries, user_transactions, and joincompetition.
FIXED: Proper type casting to avoid UUID = text errors.
FIXED: Uses only columns that exist in production schema.';

-- =====================================================
-- FIX 2: get_user_competition_entries
-- Remove ce.expires_at reference (column doesn't exist)
-- Fix type casting issues
-- =====================================================

CREATE OR REPLACE FUNCTION public.get_user_competition_entries(p_user_identifier text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_entries JSONB;
  v_canonical_user_id TEXT;
  search_wallet TEXT;
BEGIN
  -- Extract wallet from prize:pid: format
  IF p_user_identifier LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(p_user_identifier FROM 11));
  ELSIF p_user_identifier LIKE '0x%' THEN
    search_wallet := LOWER(p_user_identifier);
  END IF;

  -- Resolve canonical user ID
  SELECT cu.canonical_user_id INTO v_canonical_user_id FROM canonical_users cu
  WHERE cu.canonical_user_id = p_user_identifier
     OR cu.uid = p_user_identifier
     OR (search_wallet IS NOT NULL AND LOWER(cu.wallet_address) = search_wallet)
  LIMIT 1;

  -- Aggregate entries from competition_entries and joincompetition
  -- FIXED: Removed ce.expires_at (column doesn't exist)
  -- FIXED: Proper type casting to avoid UUID = text errors
  WITH competition_entries_source AS (
    SELECT
      ce.id::TEXT AS id,
      ce.competition_id::TEXT AS competition_id,
      c.title AS competition_name,
      c.image_url AS competition_image_url,
      ce.tickets_count AS ticket_count,
      ce.amount_spent,
      ce.latest_purchase_at AS purchase_date,
      NULL::text AS transaction_hash,
      c.prize_value,
      c.status AS competition_status,
      c.is_instant_win,
      ce.is_winner,
      ce.created_at,
      c.draw_date AS expires_at
    FROM competition_entries ce
    LEFT JOIN competitions c ON ce.competition_id = c.id
    WHERE ce.canonical_user_id = v_canonical_user_id
       OR (search_wallet IS NOT NULL AND LOWER(ce.wallet_address) = search_wallet)
  ),
  joincompetition_source AS (
    SELECT
      jc.id::TEXT AS id,
      jc.competitionid::TEXT AS competition_id,
      c.title AS competition_name,
      c.image_url AS competition_image_url,
      1 AS ticket_count,
      0 AS amount_spent,
      jc.created_at AS purchase_date,
      jc.transactionhash AS transaction_hash,
      c.prize_value,
      c.status AS competition_status,
      c.is_instant_win,
      false AS is_winner,
      jc.created_at,
      c.draw_date AS expires_at
    FROM joincompetition jc
    LEFT JOIN competitions c ON jc.competitionid::TEXT = c.id::TEXT
    WHERE (search_wallet IS NOT NULL AND LOWER(jc.wallet_address) = search_wallet)
       OR jc.privy_user_id = v_canonical_user_id
       OR jc.userid = p_user_identifier
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', combined.id,
      'competition_id', combined.competition_id,
      'competition_name', combined.competition_name,
      'competition_image_url', combined.competition_image_url,
      'ticket_count', combined.ticket_count,
      'amount_spent', combined.amount_spent,
      'purchase_date', combined.purchase_date,
      'transaction_hash', combined.transaction_hash,
      'prize_value', combined.prize_value,
      'competition_status', combined.competition_status,
      'is_instant_win', combined.is_instant_win,
      'is_winner', combined.is_winner,
      'expires_at', combined.expires_at
    )
    ORDER BY combined.purchase_date DESC
  ) INTO v_entries
  FROM (
    SELECT * FROM competition_entries_source
    UNION ALL
    SELECT * FROM joincompetition_source
  ) combined;

  RETURN COALESCE(v_entries, '[]'::jsonb);
END;
$function$;

COMMENT ON FUNCTION get_user_competition_entries IS 
'Returns user competition entries from competition_entries and joincompetition tables.
FIXED: Removed ce.expires_at reference (column does not exist in competition_entries).
FIXED: Uses c.draw_date as expires_at instead.
FIXED: Proper type casting to avoid UUID = text errors.';

COMMIT;

-- Log completion
DO $$
BEGIN
  RAISE NOTICE '==============================================';
  RAISE NOTICE 'Emergency fix complete - All column errors fixed';
  RAISE NOTICE '==============================================';
  RAISE NOTICE 'Fixed functions:';
  RAISE NOTICE '  - get_comprehensive_user_dashboard_entries: Fixed type casting';
  RAISE NOTICE '  - get_user_competition_entries: Removed ce.expires_at, use c.draw_date';
  RAISE NOTICE '';
  RAISE NOTICE 'All column references now match production schema.';
  RAISE NOTICE '==============================================';
END $$;
