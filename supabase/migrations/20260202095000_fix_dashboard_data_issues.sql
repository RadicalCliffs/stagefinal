-- =====================================================
-- FIX DASHBOARD DATA ISSUES
-- =====================================================
-- This migration fixes the remaining dashboard issues:
-- 1. Missing competition images in entries
-- 2. Missing payment info (amount spent)
-- 3. Wrong sort order (not most recent first)
-- 4. Empty orders tab
--
-- Date: 2026-02-02
-- =====================================================

BEGIN;

-- =====================================================
-- FIX 1: get_user_competition_entries
-- Add missing fields and fix ORDER BY
-- =====================================================

DROP FUNCTION IF EXISTS get_user_competition_entries(TEXT) CASCADE;

CREATE OR REPLACE FUNCTION public.get_user_competition_entries(p_user_identifier text)
 RETURNS TABLE(
   competition_id text, 
   competition_title text, 
   competition_image_url text,
   tickets_count integer, 
   amount_spent numeric, 
   is_winner boolean, 
   latest_purchase_at timestamp with time zone,
   competition_status text,
   is_instant_win boolean,
   prize_value numeric,
   transaction_hash text
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_canonical_user_id TEXT;
  search_wallet TEXT;
BEGIN
  -- Extract wallet
  IF p_user_identifier LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(p_user_identifier FROM 11));
  ELSIF p_user_identifier LIKE '0x%' THEN
    search_wallet := LOWER(p_user_identifier);
  END IF;

  -- Resolve user
  SELECT canonical_user_id INTO v_canonical_user_id
  FROM canonical_users
  WHERE canonical_user_id = p_user_identifier
     OR uid = p_user_identifier
     OR (search_wallet IS NOT NULL AND LOWER(wallet_address) = search_wallet)
  LIMIT 1;

  -- Return entries from both competition_entries AND joincompetition
  RETURN QUERY
  WITH all_entries AS (
    -- From competition_entries
    SELECT 
      ce.competition_id::TEXT as competition_id,
      c.title AS competition_title,
      c.image_url AS competition_image_url,
      ce.tickets_count,
      ce.amount_spent,
      ce.is_winner,
      ce.latest_purchase_at,
      c.status AS competition_status,
      c.is_instant_win,
      c.prize_value,
      NULL::TEXT AS transaction_hash
    FROM competition_entries ce
    LEFT JOIN competitions c ON ce.competition_id = c.id OR ce.competition_id = c.uid
    WHERE ce.canonical_user_id = v_canonical_user_id

    UNION ALL

    -- From joincompetition (where old data is!)
    SELECT
      jc.competitionid::TEXT AS competition_id,
      c.title AS competition_title,
      c.image_url AS competition_image_url,
      jc.numberoftickets AS tickets_count,
      jc.amountspent AS amount_spent,
      false AS is_winner,
      jc.purchasedate AS latest_purchase_at,
      c.status AS competition_status,
      c.is_instant_win,
      c.prize_value,
      jc.transactionhash AS transaction_hash
    FROM joincompetition jc
    LEFT JOIN competitions c ON jc.competitionid = c.id OR jc.competitionid = c.uid
    WHERE jc.canonical_user_id = v_canonical_user_id
       OR jc.userid = v_canonical_user_id
       OR jc.privy_user_id = v_canonical_user_id
       OR (search_wallet IS NOT NULL AND LOWER(jc.wallet_address) = search_wallet)
  )
  SELECT DISTINCT ON (ae.competition_id)
    ae.competition_id,
    ae.competition_title,
    ae.competition_image_url,
    ae.tickets_count,
    ae.amount_spent,
    ae.is_winner,
    ae.latest_purchase_at,
    ae.competition_status,
    ae.is_instant_win,
    ae.prize_value,
    ae.transaction_hash
  FROM all_entries ae
  -- FIX: ORDER BY latest_purchase_at DESC to show most recent first
  ORDER BY ae.competition_id, ae.latest_purchase_at DESC NULLS LAST;
END;
$function$;

-- =====================================================
-- FIX 2: get_comprehensive_user_dashboard_entries
-- Add missing fields and fix ORDER BY
-- =====================================================

DROP FUNCTION IF EXISTS get_comprehensive_user_dashboard_entries(TEXT) CASCADE;

CREATE OR REPLACE FUNCTION public.get_comprehensive_user_dashboard_entries(p_user_identifier text)
 RETURNS TABLE(
   id text, 
   competition_id text, 
   title text, 
   description text, 
   image text, 
   status text, 
   entry_type text, 
   is_winner boolean, 
   ticket_numbers text, 
   total_tickets integer, 
   total_amount_spent numeric, 
   purchase_date timestamp with time zone, 
   transaction_hash text, 
   is_instant_win boolean, 
   prize_value numeric, 
   competition_status text, 
   end_date timestamp with time zone
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
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
  SELECT canonical_user_id INTO v_canonical_user_id
  FROM canonical_users
  WHERE canonical_user_id = p_user_identifier
     OR uid = p_user_identifier
     OR (search_wallet IS NOT NULL AND LOWER(wallet_address) = search_wallet)
     OR (search_wallet IS NOT NULL AND LOWER(base_wallet_address) = search_wallet)
  LIMIT 1;

  IF v_canonical_user_id IS NULL THEN
    RETURN;
  END IF;

  -- Return dashboard entries from multiple sources INCLUDING joincompetition
  RETURN QUERY
  WITH user_entries AS (
    -- Source 1: competition_entries table
    SELECT DISTINCT
      ce.id::TEXT as id,
      ce.competition_id::TEXT as competition_id,
      c.title,
      c.description,
      c.image_url AS image,
      c.status AS competition_status,
      'competition_entry' AS entry_type,
      ce.is_winner,
      ce.ticket_numbers_csv AS ticket_numbers,
      ce.tickets_count AS total_tickets,
      ce.amount_spent AS total_amount_spent,
      ce.latest_purchase_at AS purchase_date,
      NULL::TEXT AS transaction_hash,
      c.is_instant_win,
      c.prize_value AS prize_value,
      c.end_time AS end_date
    FROM competition_entries ce
    LEFT JOIN competitions c ON ce.competition_id = c.id OR ce.competition_id = c.uid
    WHERE ce.canonical_user_id = v_canonical_user_id

    UNION ALL

    -- Source 2: user_transactions table
    SELECT DISTINCT
      ut.id::TEXT as id,
      ut.competition_id::TEXT as competition_id,
      c.title,
      c.description,
      c.image_url AS image,
      c.status AS competition_status,
      'transaction' AS entry_type,
      false AS is_winner,
      ut.ticket_count::TEXT as ticket_numbers,
      ut.ticket_count AS total_tickets,
      ut.amount AS total_amount_spent,
      ut.created_at AS purchase_date,
      COALESCE(ut.tx_id, ut.transaction_hash) AS transaction_hash,
      c.is_instant_win,
      c.prize_value AS prize_value,
      c.end_time AS end_date
    FROM user_transactions ut
    LEFT JOIN competitions c ON ut.competition_id = c.id OR ut.competition_id = c.uid
    WHERE (ut.user_id = v_canonical_user_id OR ut.canonical_user_id = v_canonical_user_id)
      AND ut.payment_status IN ('completed', 'confirmed')
      AND ut.competition_id IS NOT NULL

    UNION ALL

    -- Source 3: joincompetition table (CRITICAL - where old data is!)
    SELECT DISTINCT
      jc.uid AS id,
      jc.competitionid::TEXT AS competition_id,
      c.title,
      c.description,
      c.image_url AS image,
      c.status AS competition_status,
      'joincompetition' AS entry_type,
      false AS is_winner,
      jc.ticketnumbers AS ticket_numbers,
      jc.numberoftickets AS total_tickets,
      jc.amountspent AS total_amount_spent,
      jc.purchasedate AS purchase_date,
      jc.transactionhash AS transaction_hash,
      c.is_instant_win,
      c.prize_value AS prize_value,
      c.end_time AS end_date
    FROM joincompetition jc
    LEFT JOIN competitions c ON jc.competitionid = c.id OR jc.competitionid = c.uid
    WHERE jc.canonical_user_id = v_canonical_user_id
       OR jc.userid = v_canonical_user_id
       OR jc.privy_user_id = v_canonical_user_id
       OR (search_wallet IS NOT NULL AND LOWER(jc.wallet_address) = search_wallet)
  )
  SELECT DISTINCT ON (ue.competition_id)
    ue.id,
    ue.competition_id,
    ue.title,
    ue.description,
    ue.image,
    CASE 
      WHEN ue.competition_status = 'sold_out' THEN 'sold_out'
      WHEN ue.competition_status = 'active' THEN 'live'
      ELSE ue.competition_status
    END AS status,
    ue.entry_type,
    ue.is_winner,
    ue.ticket_numbers,
    ue.total_tickets,
    ue.total_amount_spent,
    ue.purchase_date,
    ue.transaction_hash,
    ue.is_instant_win,
    ue.prize_value,
    ue.competition_status,
    ue.end_date
  FROM user_entries ue
  -- FIX: ORDER BY purchase_date DESC to show most recent first (moved from CTE)
  ORDER BY ue.competition_id, ue.purchase_date DESC NULLS LAST;
END;
$function$;

-- =====================================================
-- FIX 3: get_user_transactions
-- Return proper fields and JOIN to competitions table
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
      'ticket_numbers', ut.ticket_numbers,
      'created_at', ut.created_at,
      'completed_at', ut.completed_at,
      'payment_method', ut.method,
      'payment_provider', ut.payment_provider,
      'tx_id', ut.tx_id,
      'transaction_hash', ut.transaction_hash,
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

COMMIT;

-- Log completion
DO $$
BEGIN
  RAISE NOTICE 'Migration complete: Dashboard data fixes applied';
  RAISE NOTICE '- Added competition images to entries';
  RAISE NOTICE '- Added payment info fields';
  RAISE NOTICE '- Fixed sort order (most recent first)';
  RAISE NOTICE '- Fixed orders tab to return proper data with competition enrichment';
END $$;
