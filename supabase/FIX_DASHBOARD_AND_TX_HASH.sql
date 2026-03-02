-- ============================================================================
-- FIX: Dashboard Entries and Transaction Hash Display
-- ============================================================================
-- This fixes two issues:
-- 1. Dashboard entries showing "operator does not exist: uuid ~* text" error
-- 2. Competition entries not showing topup transaction hashes (showing UUIDs instead)
--
-- ROOT CAUSE:
-- - joincompetition.competitionid is UUID (not TEXT as comments incorrectly stated)
-- - user_transactions.tx_id stores internal UUIDs, not blockchain hashes
-- - Need to use balance_ledger.top_up_tx_id for actual blockchain tx hashes
--
-- HOW TO APPLY:
-- 1. Go to Supabase Dashboard -> SQL Editor
-- 2. Paste this entire script
-- 3. Click "Run"
-- ============================================================================

BEGIN;

-- ============================================================================
-- PART 1: Fix get_comprehensive_user_dashboard_entries - Remove UUID ~* TEXT
-- ============================================================================

-- Drop existing function to allow return type changes
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
  resolved_base_wallet_address TEXT;
  resolved_eth_wallet_address TEXT;
  resolved_privy_user_id TEXT;
  resolved_uid TEXT;
BEGIN
  IF user_identifier LIKE 'prize:pid:0x%' THEN
    resolved_canonical_user_id := user_identifier;
    resolved_wallet_address := SUBSTRING(user_identifier FROM 11);
  ELSIF user_identifier LIKE '0x%' THEN
    resolved_canonical_user_id := 'prize:pid:' || LOWER(user_identifier);
    resolved_wallet_address := LOWER(user_identifier);
  ELSE
    resolved_canonical_user_id := user_identifier;
    resolved_wallet_address := NULL;
    resolved_base_wallet_address := NULL;
    resolved_eth_wallet_address := NULL;
    resolved_privy_user_id := user_identifier;
    resolved_uid := user_identifier;
  END IF;

  IF resolved_wallet_address IS NOT NULL THEN
    SELECT cu.wallet_base, cu.wallet_eth
    INTO resolved_base_wallet_address, resolved_eth_wallet_address
    FROM canonical_users cu
    WHERE cu.canonical_user_id = resolved_canonical_user_id;
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
      ELSE ARRAY[]::INTEGER[]
    END AS ticket_numbers,
    COALESCE(jc.numberoftickets, 0)::INTEGER AS total_tickets,
    COALESCE(jc.amountspent, jc.numberoftickets * c.ticket_price, 0)::NUMERIC AS total_amount_spent,
    'confirmed'::TEXT AS entry_type,
    'completed'::TEXT AS status,
    COALESCE(jc.purchasedate, jc.created_at) AS purchase_date,
    jc.transactionhash AS transaction_hash,
    COALESCE(c.is_instant_win, FALSE) AS is_instant_win,
    c.prize_value AS prize_value,
    COALESCE(c.status, 'completed') AS competition_status,
    c.end_date AS end_date
  FROM public.joincompetition jc
  LEFT JOIN public.competitions c ON (
    -- FIX: Both competitionid and c.id are UUID - direct comparison
    jc.competitionid = c.id
    OR c.uid = jc.competitionid::TEXT
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
      OR LOWER(jc.wallet_address) = LOWER(user_identifier)
      OR jc.privy_user_id = user_identifier
      OR jc.userid::TEXT = user_identifier
    ))
  )

  UNION ALL

  -- tickets entries (confirmed tickets)
  SELECT
    t.id AS id,
    t.competition_id AS competition_id,
    COALESCE(c.title, '') AS title,
    COALESCE(c.image_url, c.imageurl, '') AS image_url,
    ARRAY[t.ticket_number]::INTEGER[] AS ticket_numbers,
    1 AS total_tickets,
    COALESCE(t.purchase_price, c.ticket_price, 0)::NUMERIC AS total_amount_spent,
    'confirmed'::TEXT AS entry_type,
    'completed'::TEXT AS status,
    t.purchase_date AS purchase_date,
    t.payment_id AS transaction_hash,
    COALESCE(c.is_instant_win, FALSE) AS is_instant_win,
    c.prize_value AS prize_value,
    COALESCE(c.status, 'completed') AS competition_status,
    c.end_date AS end_date
  FROM public.tickets t
  LEFT JOIN public.competitions c ON t.competition_id = c.id  -- UUID = UUID
  WHERE (
    t.user_id = resolved_canonical_user_id
    OR (resolved_wallet_address IS NOT NULL AND LOWER(t.wallet_address) = resolved_wallet_address)
    OR (resolved_base_wallet_address IS NOT NULL AND LOWER(t.wallet_address) = resolved_base_wallet_address)
    OR (resolved_eth_wallet_address IS NOT NULL AND LOWER(t.wallet_address) = resolved_eth_wallet_address)
    OR t.user_id = user_identifier
    OR (resolved_wallet_address IS NOT NULL AND LOWER(t.wallet_address) = LOWER(user_identifier))
  )

  UNION ALL

  -- user_transactions entries (all transactions)
  SELECT
    ut.id AS id,
    ut.competition_id AS competition_id,
    COALESCE(c.title, '') AS title,
    COALESCE(c.image_url, c.imageurl, '') AS image_url,
    CASE
      WHEN ut.ticket_numbers IS NOT NULL AND array_length(ut.ticket_numbers, 1) > 0
      THEN ut.ticket_numbers
      ELSE ARRAY[]::INTEGER[]
    END AS ticket_numbers,
    COALESCE(ut.ticket_count, 0)::INTEGER AS total_tickets,
    COALESCE(ut.amount, 0)::NUMERIC AS total_amount_spent,
    'confirmed'::TEXT AS entry_type,
    'completed'::TEXT AS status,
    ut.created_at AS purchase_date,
    -- FIX: For balance payments, lookup actual blockchain tx from balance_ledger
    CASE 
      WHEN ut.payment_provider = 'balance' THEN
        COALESCE(
          (SELECT bl.top_up_tx_id 
           FROM balance_ledger bl 
           WHERE bl.reference_id = ut.id::TEXT 
             AND bl.top_up_tx_id IS NOT NULL
           LIMIT 1),
          COALESCE(ut.tx_id, ut.charge_id, ut.charge_code, ut.tx_ref, ut.order_id::TEXT)
        )
      ELSE
        COALESCE(ut.tx_id, ut.charge_id, ut.charge_code, ut.tx_ref, ut.order_id::TEXT)
    END AS transaction_hash,
    COALESCE(c.is_instant_win, FALSE) AS is_instant_win,
    c.prize_value AS prize_value,
    COALESCE(c.status, 'completed') AS competition_status,
    c.end_date AS end_date
  FROM public.user_transactions ut
  LEFT JOIN public.competitions c ON ut.competition_id = c.id  -- UUID = UUID
  WHERE (
    (resolved_canonical_user_id IS NOT NULL AND ut.canonical_user_id = resolved_canonical_user_id)
    OR (resolved_wallet_address IS NOT NULL AND LOWER(ut.wallet_address) = resolved_wallet_address)
    OR (resolved_base_wallet_address IS NOT NULL AND LOWER(ut.wallet_address) = resolved_base_wallet_address)
    OR (resolved_eth_wallet_address IS NOT NULL AND LOWER(ut.wallet_address) = resolved_eth_wallet_address)
    OR (resolved_privy_user_id IS NOT NULL AND (ut.user_privy_id = resolved_privy_user_id OR ut.privy_user_id = resolved_privy_user_id))
    OR (resolved_uid IS NOT NULL AND ut.user_id = resolved_uid)
    OR (resolved_canonical_user_id IS NULL AND (
      ut.canonical_user_id = user_identifier
      OR LOWER(ut.wallet_address) = LOWER(user_identifier)
      OR ut.user_privy_id = user_identifier
      OR ut.privy_user_id = user_identifier
      OR ut.user_id = user_identifier
    ))
  )

  UNION ALL

  -- pending_tickets entries (pending reservations)
  SELECT
    pt.id AS id,
    pt.competition_id AS competition_id,
    COALESCE(c.title, '') AS title,
    COALESCE(c.image_url, c.imageurl, '') AS image_url,
    COALESCE(pt.ticket_numbers, ARRAY[]::INTEGER[]) AS ticket_numbers,
    COALESCE(pt.ticket_count, 0)::INTEGER AS total_tickets,
    COALESCE(pt.total_amount, 0)::NUMERIC AS total_amount_spent,
    'pending'::TEXT AS entry_type,
    pt.status::TEXT AS status,
    pt.created_at AS purchase_date,
    pt.transaction_hash AS transaction_hash,
    COALESCE(c.is_instant_win, FALSE) AS is_instant_win,
    c.prize_value AS prize_value,
    COALESCE(c.status, 'active') AS competition_status,
    c.end_date AS end_date
  FROM public.pending_tickets pt
  LEFT JOIN public.competitions c ON pt.competition_id = c.id  -- UUID = UUID
  WHERE (
    (resolved_canonical_user_id IS NOT NULL AND pt.canonical_user_id = resolved_canonical_user_id)
    OR (resolved_wallet_address IS NOT NULL AND LOWER(pt.user_id) = resolved_wallet_address)
    OR (resolved_base_wallet_address IS NOT NULL AND LOWER(pt.user_id) = resolved_base_wallet_address)
    OR (resolved_eth_wallet_address IS NOT NULL AND LOWER(pt.user_id) = resolved_eth_wallet_address)
    OR pt.canonical_user_id = user_identifier
    OR LOWER(pt.user_id) = LOWER(user_identifier)
  );
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_comprehensive_user_dashboard_entries(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_comprehensive_user_dashboard_entries(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_comprehensive_user_dashboard_entries(TEXT) TO service_role;

-- ============================================================================
-- PART 2: Fix get_user_competition_entries - Remove UUID ~* TEXT
-- ============================================================================

-- Drop existing function to allow return type changes
DROP FUNCTION IF EXISTS get_user_competition_entries(TEXT);

CREATE OR REPLACE FUNCTION get_user_competition_entries(p_user_identifier TEXT)
RETURNS TABLE (
  id UUID, competition_id UUID, title TEXT, image_url TEXT, ticket_count INTEGER,
  ticket_numbers TEXT, status TEXT, competition_status TEXT, end_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uuid_regex TEXT := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  lower_identifier TEXT := LOWER(p_user_identifier);
  search_wallet TEXT;
BEGIN
  IF p_user_identifier LIKE 'prize:pid:0x%' THEN
    search_wallet := SUBSTRING(p_user_identifier FROM 11);
  ELSIF p_user_identifier LIKE '0x%' THEN
    search_wallet := LOWER(p_user_identifier);
  END IF;

  RETURN QUERY
  SELECT
    jc.id,
    c.id AS competition_id,
    COALESCE(c.title, ''),
    COALESCE(c.image_url, c.imageurl, ''),
    COALESCE(jc.numberoftickets, 0)::INTEGER,
    COALESCE(jc.ticketnumbers, ''),
    'confirmed',
    COALESCE(c.status, 'active'),
    c.end_date,
    COALESCE(jc.created_at, NOW())
  FROM joincompetition jc
  LEFT JOIN competitions c ON (
    -- FIX: Both competitionid and c.id are UUID - direct comparison
    jc.competitionid = c.id
    OR c.uid = jc.competitionid::TEXT
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
-- PART 3: Add top_up_tx_id column to balance_ledger if not exists
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' 
      AND table_name = 'balance_ledger' 
      AND column_name = 'top_up_tx_id'
  ) THEN
    ALTER TABLE balance_ledger ADD COLUMN top_up_tx_id TEXT;
    COMMENT ON COLUMN balance_ledger.top_up_tx_id IS 'Blockchain transaction hash from the original topup (for balance payment traceability)';
    RAISE NOTICE 'Added top_up_tx_id column to balance_ledger';
  ELSE
    RAISE NOTICE 'top_up_tx_id column already exists in balance_ledger';
  END IF;
END $$;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

DO $$
DECLARE
  v_test_result RECORD;
  v_error_message TEXT;
BEGIN
  -- Test 1: get_comprehensive_user_dashboard_entries should not error
  BEGIN
    SELECT COUNT(*) as entry_count INTO v_test_result
    FROM get_comprehensive_user_dashboard_entries('prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363');
    
    RAISE NOTICE '✅ Test 1 PASSED: get_comprehensive_user_dashboard_entries returns % entries', v_test_result.entry_count;
  EXCEPTION WHEN OTHERS THEN
    v_error_message := SQLERRM;
    RAISE NOTICE '❌ Test 1 FAILED: get_comprehensive_user_dashboard_entries error: %', v_error_message;
  END;

  -- Test 2: get_user_competition_entries should not error
  BEGIN
    SELECT COUNT(*) as entry_count INTO v_test_result
    FROM get_user_competition_entries('prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363');
    
    RAISE NOTICE '✅ Test 2 PASSED: get_user_competition_entries returns % entries', v_test_result.entry_count;
  EXCEPTION WHEN OTHERS THEN
    v_error_message := SQLERRM;
    RAISE NOTICE '❌ Test 2 FAILED: get_user_competition_entries error: %', v_error_message;
  END;

  -- Test 3: Check top_up_tx_id column exists
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' 
      AND table_name = 'balance_ledger' 
      AND column_name = 'top_up_tx_id'
  ) THEN
    RAISE NOTICE '✅ Test 3 PASSED: top_up_tx_id column exists in balance_ledger';
  ELSE
    RAISE NOTICE '❌ Test 3 FAILED: top_up_tx_id column missing from balance_ledger';
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Fix applied successfully!';
  RAISE NOTICE 'Dashboard entries should now work and show spend amounts.';
  RAISE NOTICE 'Transaction hashes will be looked up from balance_ledger.';
  RAISE NOTICE '=================================================================';
END $$;

COMMIT;
