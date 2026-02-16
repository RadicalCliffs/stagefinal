-- =====================================================
-- FIX PAYMENT STATUS FILTERING IN DASHBOARD RPCS
-- =====================================================
-- This migration fixes the payment status filtering to include ALL successful
-- payment statuses: 'completed', 'confirmed', AND 'success'
--
-- ISSUE: Dashboard entries tab and transaction tab not showing payments with
-- status='success' because RPCs only filter for 'completed' and 'confirmed'
--
-- AFFECTED FUNCTIONS:
-- 1. get_comprehensive_user_dashboard_entries - filters user_transactions by payment_status
-- 2. sync_competition_entries_from_user_transactions trigger - filters by status
--
-- Date: 2026-02-16
-- Issue: Transactions tab not showing balance payments, Entries tab not showing base payments
-- =====================================================

BEGIN;

-- =====================================================
-- FIX 1: get_comprehensive_user_dashboard_entries
-- Add 'success' to payment_status filter
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
      -- FIXED: Include ALL successful payment statuses
      AND ut.payment_status IN ('completed', 'confirmed', 'success')
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

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_comprehensive_user_dashboard_entries(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_comprehensive_user_dashboard_entries(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_comprehensive_user_dashboard_entries(TEXT) TO service_role;

-- =====================================================
-- FIX 2: sync_competition_entries_from_user_transactions trigger
-- Add 'success' to status filter
-- =====================================================

CREATE OR REPLACE FUNCTION public.sync_competition_entries_from_user_transactions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_canonical_user_id TEXT;
  v_existing_entry_id uuid;
BEGIN
  -- Only process completed competition entries (not top-ups)
  -- FIXED: Include ALL successful statuses
  IF NEW.type != 'topup' 
     AND NEW.competition_id IS NOT NULL 
     AND NEW.status IN ('completed', 'confirmed', 'success')
     AND NEW.ticket_count > 0
  THEN
    -- Resolve canonical_user_id
    v_canonical_user_id := COALESCE(NEW.canonical_user_id, NEW.user_privy_id, NEW.user_id);
    
    IF v_canonical_user_id IS NULL THEN
      RETURN NEW;
    END IF;

    -- Check if entry already exists
    SELECT id INTO v_existing_entry_id
    FROM public.competition_entries
    WHERE canonical_user_id = v_canonical_user_id
      AND competition_id = NEW.competition_id;

    IF v_existing_entry_id IS NOT NULL THEN
      -- Update existing entry
      UPDATE public.competition_entries
      SET
        tickets_count = COALESCE(tickets_count, 0) + COALESCE(NEW.ticket_count, 0),
        amount_spent = COALESCE(amount_spent, 0) + COALESCE(ABS(NEW.amount), 0),
        latest_purchase_at = GREATEST(
          COALESCE(latest_purchase_at, NEW.completed_at, NEW.created_at),
          COALESCE(NEW.completed_at, NEW.created_at)
        ),
        updated_at = NOW()
      WHERE id = v_existing_entry_id;
    ELSE
      -- Insert new entry
      INSERT INTO public.competition_entries (
        id,
        canonical_user_id,
        competition_id,
        wallet_address,
        tickets_count,
        amount_spent,
        latest_purchase_at,
        created_at,
        updated_at
      ) VALUES (
        gen_random_uuid(),
        v_canonical_user_id,
        NEW.competition_id,
        NEW.wallet_address,
        COALESCE(NEW.ticket_count, 0),
        COALESCE(ABS(NEW.amount), 0),
        COALESCE(NEW.completed_at, NEW.created_at),
        NOW(),
        NOW()
      )
      ON CONFLICT (canonical_user_id, competition_id) 
      DO UPDATE SET
        tickets_count = competition_entries.tickets_count + COALESCE(NEW.ticket_count, 0),
        amount_spent = competition_entries.amount_spent + COALESCE(ABS(NEW.amount), 0),
        latest_purchase_at = GREATEST(
          competition_entries.latest_purchase_at,
          COALESCE(NEW.completed_at, NEW.created_at)
        ),
        updated_at = NOW();
    END IF;

    -- Also ensure the purchase is recorded in competition_entries_purchases
    INSERT INTO public.competition_entries_purchases (
      id,
      canonical_user_id,
      competition_id,
      purchase_key,
      tickets_count,
      amount_spent,
      ticket_numbers_csv,
      purchased_at,
      created_at
    ) VALUES (
      gen_random_uuid(),
      v_canonical_user_id,
      NEW.competition_id,
      'ut_' || NEW.id::text,
      COALESCE(NEW.ticket_count, 0),
      COALESCE(ABS(NEW.amount), 0),
      NEW.ticket_numbers,
      COALESCE(NEW.completed_at, NEW.created_at),
      NOW()
    )
    ON CONFLICT (canonical_user_id, competition_id, purchase_key)
    DO UPDATE SET
      tickets_count = EXCLUDED.tickets_count,
      amount_spent = EXCLUDED.amount_spent,
      ticket_numbers_csv = EXCLUDED.ticket_numbers_csv,
      purchased_at = EXCLUDED.purchased_at;
  END IF;

  RETURN NEW;
END;
$$;

-- Recreate trigger
DROP TRIGGER IF EXISTS trg_sync_competition_entries_from_ut ON public.user_transactions;
CREATE TRIGGER trg_sync_competition_entries_from_ut
  AFTER INSERT OR UPDATE ON public.user_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_competition_entries_from_user_transactions();

COMMIT;

-- Log completion
DO $$
BEGIN
  RAISE NOTICE 'Migration 20260216000000 complete: Payment status filtering fixed';
  RAISE NOTICE '- Added ''success'' to payment_status filter in get_comprehensive_user_dashboard_entries';
  RAISE NOTICE '- Added ''success'' to status filter in sync_competition_entries_from_user_transactions trigger';
  RAISE NOTICE '- Dashboard entries and transactions tabs should now show ALL payment types';
  RAISE NOTICE '';
  RAISE NOTICE 'Payment statuses now recognized: ''completed'', ''confirmed'', ''success''';
END $$;
