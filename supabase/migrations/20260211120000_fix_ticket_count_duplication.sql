-- =====================================================
-- FIX TICKET COUNT DUPLICATION IN DASHBOARD
-- =====================================================
-- This migration fixes ticket count duplication caused by UNION ALL
-- combining duplicate rows from multiple source tables.
--
-- PROBLEM: When a purchase exists in multiple tables (competition_entries,
-- user_transactions, joincompetition), UNION ALL keeps all copies, then
-- GROUP BY SUM() adds them together, causing multiplication:
-- Example: 250 tickets in 4 tables = 250+250+250+250 = 1000 shown
--
-- SOLUTION: Replace UNION ALL with UNION to deduplicate identical rows
-- before aggregation. This preserves correct behavior for multiple distinct
-- purchases while eliminating cross-table duplication.
--
-- Date: 2026-02-11
-- Issue: Ticket count showing doubled/quadrupled in user dashboard
-- =====================================================

BEGIN;

-- =====================================================
-- FIX: get_user_competition_entries
-- Replace UNION ALL with UNION to deduplicate rows
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
   transaction_hash text,
   ticket_numbers text
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

  -- Return AGGREGATED entries with UNION to deduplicate
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
      NULL::TEXT AS transaction_hash,
      ce.ticket_numbers_csv AS ticket_numbers
    FROM competition_entries ce
    LEFT JOIN competitions c ON ce.competition_id = c.id OR ce.competition_id = c.uid
    WHERE ce.canonical_user_id = v_canonical_user_id

    UNION  -- Changed from UNION ALL to deduplicate rows

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
      jc.transactionhash AS transaction_hash,
      jc.ticketnumbers AS ticket_numbers
    FROM joincompetition jc
    LEFT JOIN competitions c ON jc.competitionid = c.id OR jc.competitionid = c.uid
    WHERE jc.canonical_user_id = v_canonical_user_id
       OR jc.userid = v_canonical_user_id
       OR jc.privy_user_id = v_canonical_user_id
       OR (search_wallet IS NOT NULL AND LOWER(jc.wallet_address) = search_wallet)
  )
  -- GROUP BY and SUM to aggregate all purchases for each competition
  SELECT 
    ae.competition_id,
    MAX(ae.competition_title) AS competition_title,
    MAX(ae.competition_image_url) AS competition_image_url,
    SUM(ae.tickets_count)::integer AS tickets_count,  -- SUM all tickets (after deduplication)
    SUM(ae.amount_spent) AS amount_spent,              -- SUM all amounts (after deduplication)
    BOOL_OR(ae.is_winner) AS is_winner,                -- TRUE if any entry is winner
    MAX(ae.latest_purchase_at) AS latest_purchase_at,  -- Most recent purchase
    MAX(ae.competition_status) AS competition_status,
    MAX(ae.is_instant_win::int)::boolean AS is_instant_win,
    MAX(ae.prize_value) AS prize_value,
    MAX(ae.transaction_hash) AS transaction_hash,      -- Latest transaction hash
    STRING_AGG(DISTINCT ae.ticket_numbers, ',') AS ticket_numbers  -- Concatenate all ticket numbers
  FROM all_entries ae
  GROUP BY ae.competition_id
  -- ORDER BY most recent purchase first
  ORDER BY MAX(ae.latest_purchase_at) DESC NULLS LAST;
END;
$function$;

-- =====================================================
-- FIX: get_comprehensive_user_dashboard_entries
-- Replace UNION ALL with UNION to deduplicate rows
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

  -- Return AGGREGATED dashboard entries with UNION to deduplicate
  RETURN QUERY
  WITH user_entries AS (
    -- Source 1: competition_entries table
    SELECT
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

    UNION  -- Changed from UNION ALL to deduplicate rows

    -- Source 2: user_transactions table
    SELECT
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

    UNION  -- Changed from UNION ALL to deduplicate rows

    -- Source 3: joincompetition table (CRITICAL - where old data is!)
    SELECT
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
  -- GROUP BY and SUM to aggregate all entries for each competition (after deduplication)
  SELECT
    MAX(ue.id) AS id,  -- Use most recent ID
    ue.competition_id,
    MAX(ue.title) AS title,
    MAX(ue.description) AS description,
    MAX(ue.image) AS image,
    CASE 
      WHEN MAX(ue.competition_status) = 'sold_out' THEN 'sold_out'
      WHEN MAX(ue.competition_status) = 'active' THEN 'live'
      ELSE MAX(ue.competition_status)
    END AS status,
    MAX(ue.entry_type) AS entry_type,  -- Use most recent entry type
    BOOL_OR(ue.is_winner) AS is_winner,  -- TRUE if any entry is winner
    STRING_AGG(DISTINCT ue.ticket_numbers, ',') AS ticket_numbers,  -- Concatenate all ticket numbers
    SUM(ue.total_tickets)::integer AS total_tickets,  -- SUM all tickets (after deduplication)
    SUM(ue.total_amount_spent) AS total_amount_spent,  -- SUM all amounts (after deduplication)
    MAX(ue.purchase_date) AS purchase_date,  -- Most recent purchase
    MAX(ue.transaction_hash) AS transaction_hash,  -- Latest transaction hash
    MAX(ue.is_instant_win::int)::boolean AS is_instant_win,
    MAX(ue.prize_value) AS prize_value,
    MAX(ue.competition_status) AS competition_status,
    MAX(ue.end_date) AS end_date
  FROM user_entries ue
  GROUP BY ue.competition_id
  -- ORDER BY most recent purchase first
  ORDER BY MAX(ue.purchase_date) DESC NULLS LAST;
END;
$function$;

COMMIT;

-- Log completion
DO $$
BEGIN
  RAISE NOTICE 'Migration complete: Ticket count duplication fixed';
  RAISE NOTICE '- Replaced UNION ALL with UNION in get_user_competition_entries';
  RAISE NOTICE '- Replaced UNION ALL with UNION in get_comprehensive_user_dashboard_entries';
  RAISE NOTICE '- Duplicate rows from multiple tables now deduplicated before aggregation';
  RAISE NOTICE '- Ticket counts and amounts should now display correctly';
END $$;
