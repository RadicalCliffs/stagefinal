-- ============================================================================
-- FIX: Dashboard Entries Showing $0 for Ticket Prices
-- ============================================================================
-- ISSUE: https://stage.theprize.io/dashboard/entries shows $0 for recent entries
--
-- ROOT CAUSES:
-- 1. get_user_competition_entries RPC has SQL error: column c.imageurl does not exist
-- 2. get_user_competition_entries is missing amount_spent field in SELECT
-- 3. competition_entries table has amount_spent = 0 for some entries
--
-- FIXES:
-- 1. Fix RPC function to use c.image_url (not c.imageurl)
-- 2. Add all missing fields including amount_spent, individual_purchases
-- 3. Backfill competition_entries.amount_spent from tickets table
-- ============================================================================

BEGIN;

-- ============================================================================
-- FIX 1: Recreate get_user_competition_entries with all required fields
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_user_competition_entries(TEXT) CASCADE;

CREATE OR REPLACE FUNCTION public.get_user_competition_entries(p_user_identifier TEXT)
RETURNS TABLE (
  -- Entry identifiers
  id UUID,
  competition_id UUID,
  
  -- Competition information
  competition_title TEXT,
  competition_description TEXT,
  competition_image_url TEXT,
  competition_status TEXT,
  competition_end_date TIMESTAMPTZ,
  competition_prize_value NUMERIC,
  competition_is_instant_win BOOLEAN,
  competition_ticket_price NUMERIC,
  
  -- Draw information
  draw_date TIMESTAMPTZ,
  vrf_tx_hash TEXT,
  vrf_status TEXT,
  vrf_draw_completed_at TIMESTAMPTZ,
  
  -- User entry data (aggregated)
  tickets_count INTEGER,
  ticket_numbers_csv TEXT,
  amount_spent NUMERIC,
  amount_paid NUMERIC,
  is_winner BOOLEAN,
  wallet_address TEXT,
  
  -- Purchase timestamps
  latest_purchase_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  
  -- Entry status
  entry_status TEXT,
  
  -- Individual purchases (JSONB array)
  individual_purchases JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  lower_identifier TEXT := LOWER(TRIM(p_user_identifier));
  search_wallet TEXT;
BEGIN
  -- Extract wallet from prize:pid: format
  IF p_user_identifier LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(p_user_identifier FROM 11));
  ELSIF p_user_identifier LIKE '0x%' THEN
    search_wallet := lower_identifier;
  ELSE
    search_wallet := NULL;
  END IF;

  RETURN QUERY
  SELECT
    -- Entry identifiers
    ce.id,
    ce.competition_id,
    
    -- Competition information (FIXED: use c.image_url not c.imageurl)
    c.title,
    c.description,
    c.image_url,  -- FIXED: was c.imageurl
    c.status,
    c.end_date AS competition_end_date,
    c.prize_value,
    COALESCE(c.is_instant_win, FALSE),
    c.ticket_price,
    
    -- Draw information
    c.draw_date,
    c.vrf_tx_hash,
    c.vrf_status,
    c.vrf_draw_completed_at,
    
    -- User entry data - FIXED: Include amount_spent
    ce.tickets_count,
    ce.ticket_numbers_csv,
    ce.amount_spent,  -- CRITICAL: This was missing!
    ce.amount_spent AS amount_paid,  -- Alias for compatibility
    ce.is_winner,
    cu.wallet_address,
    
    -- Purchase timestamps
    ce.latest_purchase_at,
    ce.created_at,
    
    -- Entry status
    'confirmed' AS entry_status,
    
    -- Individual purchases - build from tickets table
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', t.id::TEXT,
            'purchase_key', t.purchase_key,
            'tickets_count', 1,
            'amount_spent', COALESCE(t.purchase_price, c.ticket_price, 0),
            'ticket_numbers', t.ticket_number::TEXT,
            'purchased_at', t.purchased_at,
            'created_at', t.created_at,
            'transaction_hash', t.payment_id
          )
          ORDER BY t.purchased_at DESC
        )
        FROM tickets t
        WHERE t.competition_id = ce.competition_id
          AND t.canonical_user_id = ce.canonical_user_id
      ),
      '[]'::JSONB
    ) AS individual_purchases
    
  FROM competition_entries ce
  LEFT JOIN competitions c ON ce.competition_id = c.id
  LEFT JOIN canonical_users cu ON ce.canonical_user_id = cu.canonical_user_id
  WHERE (
    -- Match by canonical_user_id
    ce.canonical_user_id = p_user_identifier
    -- Match by wallet address
    OR (search_wallet IS NOT NULL AND LOWER(cu.wallet_address) = search_wallet)
    OR (search_wallet IS NOT NULL AND LOWER(cu.base_wallet_address) = search_wallet)
    OR (search_wallet IS NOT NULL AND LOWER(cu.eth_wallet_address) = search_wallet)
    -- Match by other identifiers
    OR cu.privy_user_id = p_user_identifier
    OR cu.uid = p_user_identifier
  )
  ORDER BY ce.latest_purchase_at DESC NULLS LAST, ce.created_at DESC;
END;
$$;

COMMENT ON FUNCTION public.get_user_competition_entries IS
'Returns user competition entries with amount_spent and individual_purchases from competition_entries table';

GRANT EXECUTE ON FUNCTION public.get_user_competition_entries(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_competition_entries(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_user_competition_entries(TEXT) TO service_role;

-- ============================================================================
-- FIX 2: Backfill missing amount_spent in competition_entries
-- ============================================================================
-- For entries where amount_spent = 0, calculate from tickets table

DO $$
DECLARE
  v_updated_count INTEGER;
  v_zero_count_before INTEGER;
  v_zero_count_after INTEGER;
BEGIN
  -- Count entries with $0 before fix
  SELECT COUNT(*) INTO v_zero_count_before
  FROM competition_entries
  WHERE amount_spent = 0 OR amount_spent IS NULL;

  RAISE NOTICE '========================================================';
  RAISE NOTICE 'Backfilling amount_spent in competition_entries';
  RAISE NOTICE '========================================================';
  RAISE NOTICE 'Entries with $0 before fix: %', v_zero_count_before;

  -- Update amount_spent from tickets table
  WITH ticket_sums AS (
    SELECT
      t.competition_id,
      t.canonical_user_id,
      SUM(COALESCE(t.purchase_price, 0)) AS total_amount
    FROM tickets t
    GROUP BY t.competition_id, t.canonical_user_id
  )
  UPDATE competition_entries ce
  SET 
    amount_spent = COALESCE(ts.total_amount, ce.tickets_count * c.ticket_price, 0),
    updated_at = NOW()
  FROM ticket_sums ts, competitions c
  WHERE ce.competition_id = ts.competition_id
    AND ce.canonical_user_id = ts.canonical_user_id
    AND ce.competition_id = c.id
    AND (ce.amount_spent = 0 OR ce.amount_spent IS NULL);

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  -- Count entries with $0 after fix
  SELECT COUNT(*) INTO v_zero_count_after
  FROM competition_entries
  WHERE amount_spent = 0 OR amount_spent IS NULL;

  RAISE NOTICE '';
  RAISE NOTICE 'Updated % entries', v_updated_count;
  RAISE NOTICE 'Entries still with $0 after fix: %', v_zero_count_after;
  RAISE NOTICE '';

  IF v_zero_count_after = 0 THEN
    RAISE NOTICE '✅ SUCCESS: All entries now have amount_spent!';
  ELSIF v_zero_count_after < v_zero_count_before THEN
    RAISE NOTICE '⚠️  PARTIAL: Reduced from % to % entries with $0', v_zero_count_before, v_zero_count_after;
  ELSE
    RAISE NOTICE '❌ WARNING: Still have % entries with $0', v_zero_count_after;
  END IF;
  
  RAISE NOTICE '========================================================';
END $$;

-- ============================================================================
-- FIX 3: Update tickets table purchase_price where NULL or 0
-- ============================================================================
-- Ensure all tickets have purchase_price set from competition ticket_price

DO $$
DECLARE
  v_null_count_before INTEGER;
  v_null_count_after INTEGER;
  v_updated_count INTEGER;
BEGIN
  -- Count tickets with NULL/0 before fix
  SELECT COUNT(*) INTO v_null_count_before
  FROM tickets t
  WHERE t.purchase_price IS NULL OR t.purchase_price = 0;

  RAISE NOTICE '========================================================';
  RAISE NOTICE 'Fixing tickets.purchase_price';
  RAISE NOTICE '========================================================';
  RAISE NOTICE 'Tickets with NULL/$0 before fix: %', v_null_count_before;

  -- Update tickets with NULL or 0 purchase_price
  UPDATE tickets t
  SET purchase_price = c.ticket_price
  FROM competitions c
  WHERE t.competition_id = c.id
    AND (t.purchase_price IS NULL OR t.purchase_price = 0)
    AND c.ticket_price IS NOT NULL
    AND c.ticket_price > 0;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  -- Count tickets with NULL/0 after fix
  SELECT COUNT(*) INTO v_null_count_after
  FROM tickets t
  WHERE t.purchase_price IS NULL OR t.purchase_price = 0;

  RAISE NOTICE '';
  RAISE NOTICE 'Updated % tickets', v_updated_count;
  RAISE NOTICE 'Tickets still with NULL/$0 after fix: %', v_null_count_after;
  RAISE NOTICE '';

  IF v_null_count_after = 0 THEN
    RAISE NOTICE '✅ SUCCESS: All tickets now have purchase_price!';
  ELSIF v_null_count_after < v_null_count_before THEN
    RAISE NOTICE '⚠️  PARTIAL: Reduced from % to % tickets with NULL/$0', v_null_count_before, v_null_count_after;
  ELSE
    RAISE NOTICE '❌ WARNING: Still have % tickets with NULL/$0', v_null_count_after;
  END IF;
  
  RAISE NOTICE '========================================================';
END $$;

-- Force PostgREST schema reload
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

DO $$
DECLARE
  v_test_result RECORD;
  v_error_message TEXT;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '========================================================';
  RAISE NOTICE 'VERIFICATION TESTS';
  RAISE NOTICE '========================================================';

  -- Test 1: RPC function should work without errors
  BEGIN
    SELECT COUNT(*) as entry_count 
    INTO v_test_result
    FROM get_user_competition_entries('prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363');
    
    RAISE NOTICE '✅ Test 1 PASSED: RPC returns % entries without error', v_test_result.entry_count;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error_message = MESSAGE_TEXT;
    RAISE NOTICE '❌ Test 1 FAILED: %', v_error_message;
  END;

  -- Test 2: All entries should have amount_spent > 0 or NULL
  SELECT COUNT(*) as zero_count
  INTO v_test_result
  FROM competition_entries
  WHERE amount_spent = 0;
  
  IF v_test_result.zero_count = 0 THEN
    RAISE NOTICE '✅ Test 2 PASSED: No entries with $0 amount_spent';
  ELSE
    RAISE NOTICE '⚠️  Test 2: % entries still have $0 amount_spent', v_test_result.zero_count;
  END IF;

  -- Test 3: RPC should return amount_spent field
  BEGIN
    SELECT amount_spent 
    INTO v_test_result
    FROM get_user_competition_entries('prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363')
    LIMIT 1;
    
    RAISE NOTICE '✅ Test 3 PASSED: RPC returns amount_spent field';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error_message = MESSAGE_TEXT;
    RAISE NOTICE '❌ Test 3 FAILED: amount_spent field missing - %', v_error_message;
  END;

  RAISE NOTICE '========================================================';
  RAISE NOTICE 'FIX COMPLETE';
  RAISE NOTICE '';
  RAISE NOTICE 'Dashboard entries should now show correct ticket prices!';
  RAISE NOTICE '========================================================';
END $$;
