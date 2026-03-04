-- ============================================================================
-- PERFORMANCE FIX: Add competition_id parameter to RPC
-- ============================================================================
-- This fixes the stalling issue when buying final tickets by allowing the 
-- RPC to query only one competition instead of all user entries

-- Drop all existing overloads
DROP FUNCTION IF EXISTS public.get_user_competition_entries(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.get_user_competition_entries(TEXT, UUID) CASCADE;

CREATE OR REPLACE FUNCTION public.get_user_competition_entries(
  p_user_identifier TEXT,
  p_competition_id UUID DEFAULT NULL
)
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
  ticket_numbers TEXT,
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
    
    -- Competition information
    c.title,
    c.description,
    c.image_url,
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
    
    -- User entry data
    ce.tickets_count,
    ce.ticket_numbers_csv AS ticket_numbers,
    ce.amount_spent,
    ce.amount_spent AS amount_paid,
    ce.is_winner,
    cu.wallet_address,
    
    -- Purchase timestamps
    ce.latest_purchase_at,
    ce.created_at,
    
    -- Entry status
    'confirmed' AS entry_status,
    
    -- Individual purchases - group by purchased_at timestamp
    COALESCE(
      (
        SELECT jsonb_agg(purchase_data)
        FROM (
          SELECT jsonb_build_object(
            'id', (ARRAY_AGG(t.id ORDER BY t.ticket_number))[1]::TEXT,
            'purchase_key', MAX(COALESCE(t.purchase_key, t.purchased_at::TEXT)),
            'tickets_count', COUNT(*)::INTEGER,
            'amount_spent', SUM(COALESCE(t.purchase_price, c.ticket_price, 0)),
            'ticket_numbers', STRING_AGG(t.ticket_number::TEXT, ',' ORDER BY t.ticket_number),
            'purchased_at', t.purchased_at,
            'created_at', MIN(t.created_at),
            'transaction_hash', MAX(t.transaction_hash)
          ) AS purchase_data
          FROM tickets t
          WHERE t.competition_id = ce.competition_id
            AND t.canonical_user_id = ce.canonical_user_id
          GROUP BY t.purchased_at
          ORDER BY t.purchased_at DESC
        ) grouped_purchases
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
  -- PERFORMANCE FIX: Filter by competition_id if provided
  AND (p_competition_id IS NULL OR ce.competition_id = p_competition_id)
  ORDER BY ce.latest_purchase_at DESC NULLS LAST, ce.created_at DESC;
END;
$$;

COMMENT ON FUNCTION public.get_user_competition_entries IS
'Get user competition entries with optional competition_id filter for improved performance';

GRANT EXECUTE ON FUNCTION public.get_user_competition_entries(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_competition_entries(TEXT, UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.get_user_competition_entries(TEXT, UUID) TO service_role;

-- Test the function
DO $$
DECLARE
  v_test_count INTEGER;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== TESTING OPTIMIZED RPC ===';
  RAISE NOTICE '';
  
  -- Test 1: Get all entries for a user
  SELECT COUNT(*) INTO v_test_count
    FROM get_user_competition_entries('prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363');
  RAISE NOTICE '✅ Test 1 PASSED: Returns % total entries', v_test_count;
  
  -- Test 2: Get entries for specific competition
  SELECT COUNT(*) INTO v_test_count
    FROM get_user_competition_entries(
      'prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363',
      '3015f2a2-ed52-4013-b0a6-880a165fbad7'::UUID
    );
  RAISE NOTICE '✅ Test 2 PASSED: Returns % entries for specific competition', v_test_count;
  
  RAISE NOTICE '';
  RAISE NOTICE '=== OPTIMIZATION COMPLETE ===';
END $$;
