-- ============================================================================
-- FIX: get_user_competition_entries Missing amount_spent Field
-- ============================================================================
-- The function returns ticket information but is missing amount_spent,
-- causing dashboard entries to show $0.00
--
-- FIX: Add amount_spent calculation from joincompetition table
-- ============================================================================

BEGIN;

-- Drop and recreate with amount_spent field
DROP FUNCTION IF EXISTS get_user_competition_entries(TEXT);

CREATE OR REPLACE FUNCTION get_user_competition_entries(p_user_identifier TEXT)
RETURNS TABLE (
  id UUID,
  competition_id UUID,
  title TEXT,
  image_url TEXT,
  ticket_count INTEGER,
  ticket_numbers TEXT,
  amount_spent NUMERIC,  -- ADDED: amount spent on this entry
  status TEXT,
  competition_status TEXT,
  end_date TIMESTAMPTZ,
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
    -- ADDED: Calculate amount_spent from numberoftickets * ticket_price or use amountspent field
    COALESCE(
      jc.amountspent,
      jc.numberoftickets * c.ticket_price,
      0
    )::NUMERIC AS amount_spent,
    'confirmed'::TEXT,
    COALESCE(c.status, 'active'),
    c.end_date,
    COALESCE(jc.created_at, NOW())
  FROM joincompetition jc
  LEFT JOIN competitions c ON (
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
-- VERIFICATION
-- ============================================================================

DO $$
DECLARE
  v_test_result RECORD;
  v_error_message TEXT;
BEGIN
  -- Test: get_user_competition_entries should return amount_spent
  BEGIN
    SELECT 
      COUNT(*) as entry_count,
      SUM(amount_spent) as total_spent,
      MAX(amount_spent) as max_spent
    INTO v_test_result
    FROM get_user_competition_entries('prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363');
    
    RAISE NOTICE '=================================================================';
    RAISE NOTICE 'Test Results:';
    RAISE NOTICE '  Entries returned: %', v_test_result.entry_count;
    RAISE NOTICE '  Total amount spent: $%', v_test_result.total_spent;
    RAISE NOTICE '  Max entry amount: $%', v_test_result.max_spent;
    
    IF v_test_result.entry_count > 0 AND v_test_result.total_spent > 0 THEN
      RAISE NOTICE '  ✅ PASSED: get_user_competition_entries returns amount_spent';
    ELSIF v_test_result.entry_count > 0 AND (v_test_result.total_spent IS NULL OR v_test_result.total_spent = 0) THEN
      RAISE NOTICE '  ⚠️  WARNING: Entries found but amount_spent is 0 or NULL';
    ELSE
      RAISE NOTICE '  ℹ️  No entries found for test user';
    END IF;
    RAISE NOTICE '=================================================================';
  EXCEPTION WHEN OTHERS THEN
    v_error_message := SQLERRM;
    RAISE NOTICE '❌ Test FAILED: %', v_error_message;
  END;
END $$;

COMMIT;
