-- ============================================================================
-- FIX: Dashboard Entries Showing Incorrect Amounts (BATCHED VERSION)
-- ============================================================================
-- This version updates tickets in smaller batches to avoid timeout
-- ============================================================================

BEGIN;

-- ============================================================================
-- FIX 1: Temporarily Disable User Triggers
-- ============================================================================

-- Disable only user-created triggers (not system constraint triggers)
DO $$
DECLARE
  trigger_rec RECORD;
BEGIN
  FOR trigger_rec IN 
    SELECT tgname 
    FROM pg_trigger 
    WHERE tgrelid = 'tickets'::regclass 
      AND tgname NOT LIKE 'RI_ConstraintTrigger%'
      AND tgname NOT LIKE 'pg_%'
  LOOP
    EXECUTE format('ALTER TABLE tickets DISABLE TRIGGER %I', trigger_rec.tgname);
    RAISE NOTICE 'Disabled trigger: %', trigger_rec.tgname;
  END LOOP;
  
  RAISE NOTICE '⚠️  Temporarily disabled user triggers on tickets table';
END $$;

-- ============================================================================
-- FIX 2: Update Missing purchase_price Values (BATCHED)
-- ============================================================================

-- Check current state
DO $$
DECLARE
  v_null_count INTEGER;
  v_zero_count INTEGER;
  v_batch_size INTEGER := 1000;
  v_total_updated INTEGER := 0;
  v_batch_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_null_count
  FROM tickets
  WHERE purchase_price IS NULL OR purchase_price = 0;
  
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Found % tickets to update', v_null_count;
  RAISE NOTICE 'Updating in batches of %...', v_batch_size;
  RAISE NOTICE '=================================================================';
  
  -- Update in batches
  LOOP
    UPDATE tickets t
    SET purchase_price = c.ticket_price
    FROM competitions c
    WHERE t.competition_id = c.id
      AND t.id IN (
        SELECT t2.id
        FROM tickets t2
        WHERE t2.purchase_price IS NULL OR t2.purchase_price = 0
        LIMIT v_batch_size
      );
    
    GET DIAGNOSTICS v_batch_count = ROW_COUNT;
    
    IF v_batch_count = 0 THEN
      EXIT;
    END IF;
    
    v_total_updated := v_total_updated + v_batch_count;
    RAISE NOTICE 'Updated % tickets (total: %)', v_batch_count, v_total_updated;
    
    -- Brief pause between batches
    PERFORM pg_sleep(0.1);
  END LOOP;
  
  RAISE NOTICE '=================================================================';
  RAISE NOTICE '✅ Updated % tickets total', v_total_updated;
  RAISE NOTICE '=================================================================';
END $$;

-- ============================================================================
-- Re-enable User Triggers
-- ============================================================================

DO $$
DECLARE
  trigger_rec RECORD;
BEGIN
  FOR trigger_rec IN 
    SELECT tgname 
    FROM pg_trigger 
    WHERE tgrelid = 'tickets'::regclass 
      AND tgname NOT LIKE 'RI_ConstraintTrigger%'
      AND tgname NOT LIKE 'pg_%'
  LOOP
    EXECUTE format('ALTER TABLE tickets ENABLE TRIGGER %I', trigger_rec.tgname);
    RAISE NOTICE 'Re-enabled trigger: %', trigger_rec.tgname;
  END LOOP;
  
  RAISE NOTICE '✅ Re-enabled user triggers on tickets table';
END $$;

-- ============================================================================
-- FIX 3: Fix get_comprehensive_user_dashboard_entries RPC
-- ============================================================================

DROP FUNCTION IF EXISTS get_comprehensive_user_dashboard_entries(TEXT);

CREATE OR REPLACE FUNCTION get_comprehensive_user_dashboard_entries(user_identifier TEXT)
RETURNS TABLE (
  id UUID, 
  competition_id UUID, 
  title TEXT, 
  image_url TEXT, 
  ticket_numbers INTEGER[],
  total_tickets INTEGER, 
  total_amount_spent NUMERIC, 
  entry_type TEXT, 
  status TEXT,
  purchase_date TIMESTAMPTZ, 
  transaction_hash TEXT, 
  is_instant_win BOOLEAN,
  prize_value NUMERIC, 
  competition_status TEXT, 
  end_date TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  resolved_canonical_user_id TEXT;
  resolved_wallet_address TEXT;
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
  END IF;

  RETURN QUERY
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
      jc.amountspent,
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
           c.prize_value, c.status, c.end_date;
END;
$$;

GRANT EXECUTE ON FUNCTION get_comprehensive_user_dashboard_entries(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_comprehensive_user_dashboard_entries(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_comprehensive_user_dashboard_entries(TEXT) TO service_role;

DO $$
BEGIN
  RAISE NOTICE '✅ RPC function fixed';
END $$;

COMMIT;

-- ============================================================================
-- SUMMARY
-- ============================================================================
-- This fix:
-- 1. Temporarily disabled user triggers (not system constraint triggers)
-- 2. Updated tickets.purchase_price in batches of 1000
-- 3. Re-enabled user triggers
-- 4. Fixed get_comprehensive_user_dashboard_entries RPC function
--
-- Dashboard amounts will now display correctly for all users.
-- ============================================================================
