-- =====================================================
-- COMPREHENSIVE FIX: ALL Column Reference Errors
-- =====================================================
-- This migration fixes ALL column reference errors across ALL RPC functions
-- Based on production schema analysis showing:
-- - ticket_numbers column DOES NOT EXIST
-- - transaction_hash column DOES NOT EXIST (should use tx_id)
--
-- Date: 2026-02-02
-- =====================================================

BEGIN;

-- =====================================================
-- FIX 1: get_user_transactions
-- Remove ALL non-existent column references
-- =====================================================

DROP FUNCTION IF EXISTS get_user_transactions(TEXT) CASCADE;

CREATE OR REPLACE FUNCTION public.get_user_transactions(user_identifier text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE 
  v_transactions JSONB; 
  v_canonical_user_id TEXT; 
  search_wallet TEXT;
BEGIN
  -- Extract wallet from prize:pid: format
  IF user_identifier LIKE 'prize:pid:0x%' THEN 
    search_wallet := LOWER(SUBSTRING(user_identifier FROM 11));
  ELSIF user_identifier LIKE '0x%' THEN 
    search_wallet := LOWER(user_identifier); 
  END IF;

  -- Resolve canonical user ID
  SELECT cu.canonical_user_id INTO v_canonical_user_id FROM canonical_users cu
  WHERE cu.canonical_user_id = user_identifier 
     OR cu.uid = user_identifier
     OR (search_wallet IS NOT NULL AND LOWER(cu.wallet_address) = search_wallet) 
  LIMIT 1;

  -- Build transactions with competition data enrichment
  -- FIXED: Removed ticket_numbers (doesn't exist)
  -- FIXED: Changed transaction_hash to tx_id (correct column name)
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', ut.id,
      'type', ut.type,
      'amount', ut.amount,
      'currency', ut.currency,
      'status', ut.status,
      'payment_status', ut.payment_status,
      'competition_id', ut.competition_id,
      'competition_name', COALESCE(c.title, 'Unknown Competition'),
      'competition_image', c.image_url,
      'ticket_count', ut.ticket_count,
      'created_at', ut.created_at,
      'completed_at', ut.completed_at,
      'payment_method', ut.method,
      'payment_provider', ut.payment_provider,
      'tx_id', ut.tx_id,
      'transaction_hash', ut.tx_id,  -- Map to tx_id for backward compatibility
      'order_id', ut.order_id,
      'webhook_ref', ut.webhook_ref,
      'metadata', ut.metadata,
      'balance_before', ut.balance_before,
      'balance_after', ut.balance_after,
      'is_topup', (ut.competition_id IS NULL OR (ut.webhook_ref IS NOT NULL AND ut.webhook_ref LIKE 'TOPUP_%'))
    ) 
    ORDER BY ut.created_at DESC
  ) INTO v_transactions
  FROM user_transactions ut
  LEFT JOIN competitions c ON ut.competition_id = c.id
  WHERE ut.user_id = user_identifier 
     OR ut.canonical_user_id = v_canonical_user_id 
     OR ut.user_id = v_canonical_user_id
     OR (search_wallet IS NOT NULL AND LOWER(ut.wallet_address) = search_wallet)
  LIMIT 100;

  -- Return array directly
  RETURN COALESCE(v_transactions, '[]'::jsonb);
END;
$function$;

COMMENT ON FUNCTION get_user_transactions IS 
'Returns user transactions with competition data. 
Note: transaction_hash is mapped to tx_id for backward compatibility.
ticket_numbers column does not exist and is not included.';

-- =====================================================
-- FIX 2: get_comprehensive_user_dashboard_entries
-- Remove ALL non-existent column references
-- =====================================================

DROP FUNCTION IF EXISTS get_comprehensive_user_dashboard_entries(TEXT) CASCADE;

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
  -- FIXED: Removed ticket_numbers references (doesn't exist)
  -- FIXED: Changed transaction_hash to tx_id (correct column name)
  WITH competition_entries_source AS (
    SELECT
      ce.id,
      ce.competition_id,
      c.title AS competition_name,
      c.image_url AS competition_image_url,
      ce.tickets_count AS ticket_count,
      ce.amount_spent,
      ce.latest_purchase_at AS purchase_date,
      NULL::text AS transaction_hash,  -- Not available in competition_entries
      c.prize_value,
      c.status AS competition_status,
      c.is_instant_win,
      ce.is_winner,
      ce.created_at
    FROM competition_entries ce
    LEFT JOIN competitions c ON ce.competition_id = c.id::TEXT
    WHERE ce.canonical_user_id = v_canonical_user_id
       OR (search_wallet IS NOT NULL AND LOWER(ce.wallet_address) = search_wallet)
  ),
  user_transactions_source AS (
    SELECT
      ut.id,
      ut.competition_id,
      c.title AS competition_name,
      c.image_url AS competition_image_url,
      ut.ticket_count,
      ut.amount AS amount_spent,
      ut.created_at AS purchase_date,
      ut.tx_id AS transaction_hash,  -- Use tx_id (correct column)
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
      jc.competitionid AS competition_id,
      c.title AS competition_name,
      c.image_url AS competition_image_url,
      1 AS ticket_count,
      0 AS amount_spent,
      jc.createdat AS purchase_date,
      jc.transactionhash AS transaction_hash,
      c.prize_value,
      c.status AS competition_status,
      c.is_instant_win,
      false AS is_winner,
      jc.createdat AS created_at
    FROM joincompetition jc
    LEFT JOIN competitions c ON jc.competitionid = c.id
    WHERE jc.wallet_address = search_wallet
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
Note: transaction_hash uses tx_id from user_transactions (correct column).
ticket_numbers column does not exist and is not included.';

-- =====================================================
-- FIX 3: get_user_competition_entries
-- Remove ALL non-existent column references
-- =====================================================

DROP FUNCTION IF EXISTS get_user_competition_entries(TEXT) CASCADE;

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
  -- FIXED: Removed ticket_numbers references (doesn't exist)
  -- FIXED: Changed transaction_hash to tx_id where applicable
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
      ce.expires_at
    FROM competition_entries ce
    LEFT JOIN competitions c ON ce.competition_id::TEXT = c.id::TEXT
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
      jc.createdat AS purchase_date,
      jc.transactionhash AS transaction_hash,
      c.prize_value,
      c.status AS competition_status,
      c.is_instant_win,
      false AS is_winner,
      jc.createdat AS created_at,
      c.draw_date AS expires_at
    FROM joincompetition jc
    LEFT JOIN competitions c ON jc.competitionid = c.id
    WHERE LOWER(jc.wallet_address) = search_wallet
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
Note: ticket_numbers column does not exist and is not included.
transaction_hash uses tx_id where available.';

COMMIT;

-- Log completion
DO $$
BEGIN
  RAISE NOTICE 'Comprehensive fix complete - ALL column reference errors fixed:';
  RAISE NOTICE '- Removed all references to ticket_numbers (column does not exist)';
  RAISE NOTICE '- Changed all transaction_hash references to tx_id (correct column name)';
  RAISE NOTICE '- Fixed get_user_transactions';
  RAISE NOTICE '- Fixed get_comprehensive_user_dashboard_entries';
  RAISE NOTICE '- Fixed get_user_competition_entries';
  RAISE NOTICE '';
  RAISE NOTICE 'All RPC functions now reference only columns that exist in production.';
END $$;
