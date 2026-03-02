-- ============================================================================
-- FIX: Dashboard Entries Showing $0.00 Instead of $62.70
-- ============================================================================
-- ROOT CAUSE ANALYSIS:
--
-- 1. TICKETS TABLE ISSUE (PRIMARY ISSUE):
--    - User has 627 tickets in the tickets table for competition 799a8e12-...
--    - 626 tickets have purchase_price = $0 or NULL
--    - Only 1 ticket (ticket #267) has correct purchase_price = $0.10
--    - Expected total: 627 × $0.10 = $62.70
--    - Actual total: $0.10
--    - Missing amount: $62.60
--
-- 2. RPC FUNCTION ISSUE (SECONDARY ISSUE):
--    - get_comprehensive_user_dashboard_entries() references non-existent columns:
--      * cu.wallet_base
--      * cu.wallet_eth
--    - This causes RPC to fail with error: "column cu.wallet_base does not exist"
--    - FIX_DASHBOARD_AND_TX_HASH.sql was applied but canonical_users table 
--      doesn't have these columns
--
-- 3. DATA MISMATCH:
--    - joincompetition table: 1 entry with 420 tickets, $42 spent (CORRECT)
--    - tickets table: 627 tickets, $0.10 total (INCORRECT)
--    - The 627 tickets are newer and missing purchase_price values
--
-- USER IMPACT:
--    - Dashboard shows $0.00 for 627-ticket entry
--    - The recent 10¢ purchase (1 ticket) shows correctly
--    - Total should be $62.70 but shows $0.00
--
-- ============================================================================

BEGIN;

-- ============================================================================
-- FIX 1: Update Missing purchase_price Values in tickets Table
-- ============================================================================

-- First, let's check current state across ALL users and competitions
DO $$
DECLARE
  v_null_count INTEGER;
  v_zero_count INTEGER;
  v_correct_count INTEGER;
  v_total_count INTEGER;
BEGIN
  SELECT 
    COUNT(*) FILTER (WHERE purchase_price IS NULL),
    COUNT(*) FILTER (WHERE purchase_price = 0),
    COUNT(*) FILTER (WHERE purchase_price > 0),
    COUNT(*)
  INTO v_null_count, v_zero_count, v_correct_count, v_total_count
  FROM tickets;
  
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Current ticket purchase_price status (ALL users, ALL competitions):';
  RAISE NOTICE '  - Total tickets: %', v_total_count;
  RAISE NOTICE '  - NULL: % tickets', v_null_count;
  RAISE NOTICE '  - $0: % tickets', v_zero_count;
  RAISE NOTICE '  - >$0 (correct): % tickets', v_correct_count;
  RAISE NOTICE '=================================================================';
END $$;

-- Update tickets with missing/incorrect purchase_price for ALL competitions
UPDATE tickets t
SET 
  purchase_price = c.ticket_price
FROM competitions c
WHERE t.competition_id = c.id
  AND (t.canonical_user_id = 'prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363'
       OR LOWER(t.wallet_address) = '0x0ff51ec0ecc9ae1e5e6048976ba307c849781363')
  AND (t.purchase across ALL competitions
DO $$
DECLARE
  v_comp_record RECORD;
  v_total_amount NUMERIC := 0;
BEGIN
  RAISE NOTICE '=================================================================';
  RAISE NOTICE '✅ FIX 1 COMPLETE: Updated tickets.purchase_price (ALL competitions)';
  RAISE NOTICE '';
  
  FOR v_comp_record IN
    SELECT 
      c.title,
      t.competition_id,
      COUNT(*) as ticket_count,
      SUM(COALESCE(t.purchase_price, 0)) as total_spent,
      MAX(c.ticket_price) as unit_price
    FROM tickets t
    LEFT JOIN competitions c ON t.competition_id = c.id
    WHERE (t.canonical_user_id = 'prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363'
           OR LOWER(t.wallet_address) = '0x0ff51ec0ecc9ae1e5e6048976ba307c849781363')
    GROUP BY c.title, t.competition_id
    ORDER BY total_spent DESC
  LOOP
    v_total_amount := v_total_amount + v_comp_record.total_spent;
    RAISE NOTICE '  % (%)', v_comp_record.title, v_comp_record.competition_id;
    RAISE NOTICE '    Tickets: % | Total: $% | Expected: $%', 
      v_comp_record.ticket_count, 
      v_comp_record.total_spent,
      v_comp_record.ticket_count * v_comp_record.unit_price;
  END LOOP;
  
  RAISE NOTICE '';
  RAISE NOTICE '  Grand Total: $%', v_total_amount
    RAISE NOTICE '  ⚠️  WARNING: Amounts do not match (diff: $%)', ABS(v_total_amount - v_expected_amount);
  END IF;
  RAISE NOTICE '=================================================================';
END $$;

-- ============================================================================
-- FIX 2: Fix get_comprehensive_user_dashboard_entries RPC
-- ============================================================================
-- Remove references to non-existent wallet_base and wallet_eth columns

DROP FUNCTION IF EXISTS get_comprehensive_user_dashboard_entries(TEXT);

CREATE OR REPLACE FUNCTION get_comprehensive_user_dashboard_entries(user_identifier TEXT)
RETURNS TABLE (
  id UUID, competition_id UUID, title TEXT, image_url TEXT, ticket_numbers INTEGER[],
  total_tickets INTEGER, total_amount_spent NUMERIC, entry_type TEXT, status TEXT,
  purchase_date TIMESTAMPTZ, transaction_hash TEXT, is_instant_win BOOLEAN,
  prize_value NUMERIC, competition_status TEXT, end_date TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uuid_regex TEXT := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  resolved_canonical_user_id TEXT;
  resolved_wallet_address TEXT;
BEGIN
  -- Resolve user identifier
  IF user_identifier LIKE 'prize:pid:0x%' THEN
    resolved_canonical_user_id := user_identifier;
    resolved_wallet_address := SUBSTRING(user_identifier FROM 11);
  ELSIF user_identifier LIKE '0x%' THEN
    resolved_canonical_user_id := 'prize:pid:' || LOWER(user_identifier);
    resolved_wallet_address := LOWER(user_identifier);
  ELSE
    resolved_canonical_user_id := user_identifier;
    resolved_wallet_address := NULL;
  END IF;

  RETURN QUERY
  -- joincompetition entries (oldest competition entry system)
  SELECT
    gen_random_uuid() AS id,
    COALESCE(c.id, NULL::UUID) AS competition_id,
    COALESCE(c.title, '') AS title,
    COALESCE(c.image_url, c.imageurl, '') AS image_url,
    CASE
      WHEN jc.ticketnumbers IS NOT NULL AND jc.ticketnumbers != '' THEN
        string_to_array(jc.ticketnumbers, ',')::INTEGER[]
      WHEN jc.ticket_numbers IS NOT NULL THEN
        jc.ticket_numbers::INTEGER[]
      ELSE ARRAY[]::INTEGER[]
    END AS ticket_numbers,
    COALESCE(jc.numberoftickets, jc.ticket_count, 0)::INTEGER AS total_tickets,
    COALESCE(
      jc.amount_spent, 
      jc.numberoftickets * c.ticket_price,
      jc.ticket_count * c.ticket_price,
      0
    )::NUMERIC AS total_amount_spent,
    'confirmed'::TEXT AS entry_type,
    'completed'::TEXT AS status,
    COALESCE(jc.purchasedate, jc.purchase_date, jc.created_at) AS purchase_date,
    COALESCE(jc.transactionhash, jc.transaction_hash) AS transaction_hash,
    COALESCE(c.is_instant_win, FALSE) AS is_instant_win,
    c.prize_value AS prize_value,
    COALESCE(c.status, 'completed') AS competition_status,
    c.end_date AS end_date
  FROM public.joincompetition jc
  LEFT JOIN public.competitions c ON (
    jc.competitionid = c.id::TEXT
    OR jc.competitionid = c.uid
    OR jc.competition_id = c.id
  )
  WHERE (
    (resolved_canonical_user_id IS NOT NULL AND jc.canonical_user_id = resolved_canonical_user_id)
    OR (resolved_wallet_address IS NOT NULL AND LOWER(jc.wallet_address) = resolved_wallet_address)
    OR (resolved_canonical_user_id IS NULL AND (
      jc.canonical_user_id = user_identifier
      OR LOWER(jc.wallet_address) = LOWER(user_identifier)
    ))
  )

  UNION ALL

  -- tickets entries (confirmed tickets) - Group by competition
  SELECT
    gen_random_uuid() AS id,
    t.competition_id AS competition_id,
    COALESCE(c.title, '') AS title,
    COALESCE(c.image_url, c.imageurl, '') AS image_url,
    array_agg(t.ticket_number ORDER BY t.ticket_number)::INTEGER[] AS ticket_numbers,
    COUNT(*)::INTEGER AS total_tickets,
    SUM(COALESCE(t.purchase_price, c.ticket_price, 0))::NUMERIC AS total_amount_spent,
    'confirmed'::TEXT AS entry_type,
    'completed'::TEXT AS status,
    MIN(t.purchase_date) AS purchase_date,
    MIN(t.payment_id) AS transaction_hash,
    COALESCE(c.is_instant_win, FALSE) AS is_instant_win,
    c.prize_value AS prize_value,
    COALESCE(c.status, 'completed') AS competition_status,
    c.end_date AS end_date
  FROM public.tickets t
  LEFT JOIN public.competitions c ON t.competition_id = c.id
  WHERE (
    t.user_id = resolved_canonical_user_id
    OR t.canonical_user_id = resolved_canonical_user_id
    OR (resolved_wallet_address IS NOT NULL AND LOWER(t.wallet_address) = resolved_wallet_address)
    OR t.user_id = user_identifier
    OR t.canonical_user_id = user_identifier
    OR (resolved_wallet_address IS NULL AND LOWER(t.wallet_address) = LOWER(user_identifier))
  )
  GROUP BY t.competition_id, c.title, c.image_url, c.imageurl, c.is_instant_win, 
           c.prize_value, c.status, c.end_date
  ORDER BY purchase_date DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_comprehensive_user_dashboard_entries(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_comprehensive_user_dashboard_entries(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_comprehensive_user_dashboard_entries(TEXT) TO service_role;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

DO $$
DECLARE
  v_test_result RECORD;
  v_error_message TEXT;
BEGIN
  -- Test the RPC function
  BEGIN
    SELECT COUNT(*) as entry_count, SUM(total_amount_spent) as total_spent
    INTO v_test_result
    FROM get_comprehensive_user_dashboard_entries('prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363');
    
    RAISE NOTICE '=================================================================';
    RAISE NOTICE '✅ FIX 2 COMPLETE: RPC function fixed';
    RAISE NOTICE '  - Entries returned: %', v_test_result.entry_count;
    RAISE NOTICE '  - Total amount spent: $%', v_test_result.total_spent;
    
    -- Check for the specific competition
    SELECT total_tickets, total_amount_spent, competition_id
    INTO v_test_result
    FROM get_comprehensive_user_dashboard_entries('prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363')
    WHERE competition_id::TEXT = '799a8e12-38f2-4989-ad24-15c995d673a6'
    LIMIT 1;
    
    IF v_test_result.competition_id IS NOT NULL THEN
      RAISE NOTICE '  ✅ Competition 799a8e12-... found:';
      RAISE NOTICE '     Total tickets: %', v_test_result.total_tickets;
      RAISE NOTICE '     Amount spent: $%', v_test_result.total_amount_spent;
      
      IF v_test_result.total_amount_spent >= 62.70 THEN
        RAISE NOTICE '     ✅ Amount is correct ($62.70+)';
      ELSE
        RAISE NOTICE '     ⚠️  Amount still showing as $%', v_test_result.total_amount_spent;
      END IF;
    ELSE
      RAISE NOTICE '  ⚠️  Competition 799a8e12-... not found in results';
    END IF;
    
    RAISE NOTICE '=================================================================';
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_error_message = MESSAGE_TEXT;
      RAISE NOTICE '❌ RPC TEST FAILED: %', v_error_message;
  END;
END $$;

COMMIT;

-- ============================================================================
-- SUMMARY
-- ============================================================================
-- This fix addresses two issues:
--
-- 1. Updated 626 tickets.purchase_price from $0 to $0.10
--    - Now 627 tickets × $0.10 = $62.70 (correct)
--
-- 2. Fixed get_comprehensive_user_dashboard_entries() RPC function
--    - Removed references to non-existent cu.wallet_base and cu.wallet_eth
--    - Simplified user resolution logic
--    - Added grouping for tickets table entries by competition
--    - Now properly sums purchase_price values
--
-- The dashboard should now show $62.70 for the 627-ticket entry.
-- ============================================================================
