-- =====================================================
-- COMPREHENSIVE FIX FOR DASHBOARD ISSUES (PRODUCTION SCHEMA)
-- =====================================================
-- Based on ACTUAL production schema from "Substage Schema, functions, triggers & indexes.md"
--
-- Issues Fixed:
-- 1. Entries not showing - WRONG JOIN condition in joincompetition (c.id::TEXT should be c.id)
-- 2. Orders tab empty - same issue
-- 3. RPC errors - UUID type casting errors
-- 4. Balance discrepancy - credit_sub_account_balance doesn't update canonical_users.usdc_balance
-- 5. Top-up glitch - same root cause as #4
--
-- Date: 2026-02-02
-- =====================================================

BEGIN;

-- =====================================================
-- FIX 1: get_comprehensive_user_dashboard_entries
-- CRITICAL FIX: Line 7206 has WRONG casting: jc.competitionid = c.id::TEXT
-- Should be: jc.competitionid = c.id (both are UUID)
-- =====================================================

DROP FUNCTION IF EXISTS get_comprehensive_user_dashboard_entries(TEXT) CASCADE;

CREATE OR REPLACE FUNCTION public.get_comprehensive_user_dashboard_entries(p_user_identifier text)
 RETURNS TABLE(id text, competition_id text, title text, description text, image text, status text, entry_type text, is_winner boolean, ticket_numbers text, total_tickets integer, total_amount_spent numeric, purchase_date timestamp with time zone, transaction_hash text, is_instant_win boolean, prize_value numeric, competition_status text, end_date timestamp with time zone)
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
      c.prize_value::NUMERIC AS prize_value,
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
      ut.tx_id AS transaction_hash,
      c.is_instant_win,
      c.prize_value::NUMERIC AS prize_value,
      c.end_time AS end_date
    FROM user_transactions ut
    LEFT JOIN competitions c ON ut.competition_id = c.id OR ut.competition_id = c.uid
    WHERE (ut.user_id = v_canonical_user_id OR ut.canonical_user_id = v_canonical_user_id)
      AND ut.payment_status IN ('completed', 'confirmed')
      AND ut.competition_id IS NOT NULL

    UNION ALL

    -- Source 3: joincompetition table (CRITICAL - where old data is!)
    -- FIX: Changed c.id::TEXT to c.id (both jc.competitionid and c.id are UUID)
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
      c.prize_value::NUMERIC AS prize_value,
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
  ORDER BY ue.competition_id, ue.purchase_date DESC NULLS LAST;
END;
$function$;

-- =====================================================
-- FIX 2: get_user_competition_entries
-- Same fix as above - change c.id::TEXT to c.id
-- =====================================================

DROP FUNCTION IF EXISTS get_user_competition_entries(TEXT) CASCADE;

CREATE OR REPLACE FUNCTION public.get_user_competition_entries(p_user_identifier text)
 RETURNS TABLE(competition_id text, competition_title text, tickets_count integer, amount_spent numeric, is_winner boolean, latest_purchase_at timestamp with time zone)
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
      ce.tickets_count,
      ce.amount_spent,
      ce.is_winner,
      ce.latest_purchase_at
    FROM competition_entries ce
    LEFT JOIN competitions c ON ce.competition_id = c.id OR ce.competition_id = c.uid
    WHERE ce.canonical_user_id = v_canonical_user_id

    UNION ALL

    -- From joincompetition (where old data is!)
    -- FIX: Changed c.id::TEXT to c.id
    SELECT
      jc.competitionid::TEXT AS competition_id,
      c.title AS competition_title,
      jc.numberoftickets AS tickets_count,
      jc.amountspent AS amount_spent,
      false AS is_winner,
      jc.purchasedate AS latest_purchase_at
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
    ae.tickets_count,
    ae.amount_spent,
    ae.is_winner,
    ae.latest_purchase_at
  FROM all_entries ae
  ORDER BY ae.competition_id, ae.latest_purchase_at DESC NULLS LAST;
END;
$function$;

-- =====================================================
-- FIX 3: credit_sub_account_balance (3-parameter version)
-- Add code to ALSO update canonical_users.usdc_balance
-- This fixes the balance discrepancy issue
-- =====================================================

DROP FUNCTION IF EXISTS credit_sub_account_balance(TEXT, TEXT, NUMERIC) CASCADE;

CREATE OR REPLACE FUNCTION public.credit_sub_account_balance(p_canonical_user_id text, p_currency text, p_amount numeric)
 RETURNS TABLE(balance_before numeric, balance_after numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_before numeric;
  v_after numeric;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  LOOP
    BEGIN
      SELECT available_balance
      INTO v_before
      FROM public.sub_account_balances
      WHERE canonical_user_id = p_canonical_user_id
        AND currency = p_currency
      FOR UPDATE;

      IF NOT FOUND THEN
        INSERT INTO public.sub_account_balances (canonical_user_id, currency, available_balance, pending_balance, last_updated)
        VALUES (p_canonical_user_id, p_currency, 0, 0, now())
        ON CONFLICT (canonical_user_id, currency) DO NOTHING;
        CONTINUE;
      END IF;

      EXIT;
    EXCEPTION WHEN unique_violation THEN
      CONTINUE;
    END;
  END LOOP;

  IF v_before IS NULL THEN
    v_before := 0;
  END IF;

  v_after := v_before + p_amount;

  UPDATE public.sub_account_balances
  SET available_balance = v_after,
      last_updated = now()
  WHERE canonical_user_id = p_canonical_user_id
    AND currency = p_currency;

  -- FIX: ALSO update canonical_users.usdc_balance when currency is USD
  -- This keeps both tables in sync and fixes the balance discrepancy
  IF p_currency = 'USD' THEN
    UPDATE public.canonical_users
    SET usdc_balance = COALESCE(usdc_balance, 0) + p_amount,
        updated_at = now()
    WHERE canonical_user_id = p_canonical_user_id;
  END IF;

  RETURN QUERY SELECT v_before, v_after;
END;
$function$;

-- =====================================================
-- FIX 4: credit_sub_account_balance (5-parameter version with ledger)
-- Add code to ALSO update canonical_users.usdc_balance
-- =====================================================

DROP FUNCTION IF EXISTS credit_sub_account_balance(TEXT, NUMERIC, TEXT, TEXT, TEXT) CASCADE;

CREATE OR REPLACE FUNCTION public.credit_sub_account_balance(p_canonical_user_id text, p_amount numeric, p_currency text DEFAULT 'USD'::text, p_reference_id text DEFAULT NULL::text, p_description text DEFAULT NULL::text)
 RETURNS TABLE(success boolean, previous_balance numeric, new_balance numeric, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_record_id UUID;
  v_previous_balance NUMERIC;
  v_new_balance NUMERIC;
  search_wallet TEXT;
BEGIN
  -- Validate amount
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, 0::NUMERIC, 0::NUMERIC, 'Amount must be positive'::TEXT;
    RETURN;
  END IF;

  -- Extract wallet address from prize:pid: format if present
  IF p_canonical_user_id LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(p_canonical_user_id FROM 11));
  ELSIF p_canonical_user_id LIKE '0x%' AND LENGTH(p_canonical_user_id) = 42 THEN
    search_wallet := LOWER(p_canonical_user_id);
  ELSE
    search_wallet := NULL;
  END IF;

  -- Find the record to update
  SELECT id, COALESCE(available_balance, 0)
  INTO v_record_id, v_previous_balance
  FROM public.sub_account_balances
  WHERE currency = p_currency
    AND (
      canonical_user_id = p_canonical_user_id
      OR canonical_user_id = LOWER(p_canonical_user_id)
      OR (search_wallet IS NOT NULL AND canonical_user_id = 'prize:pid:' || search_wallet)
      OR user_id = p_canonical_user_id
      OR privy_user_id = p_canonical_user_id
    )
  ORDER BY
    CASE
      WHEN canonical_user_id = p_canonical_user_id THEN 0
      WHEN canonical_user_id = LOWER(p_canonical_user_id) THEN 1
      ELSE 2
    END
  LIMIT 1
  FOR UPDATE;

  IF v_record_id IS NULL THEN
    -- No record found - create one
    v_previous_balance := 0;
    v_new_balance := p_amount;

    INSERT INTO public.sub_account_balances (
      canonical_user_id,
      user_id,
      currency,
      available_balance,
      pending_balance,
      last_updated
    ) VALUES (
      p_canonical_user_id,
      p_canonical_user_id,  -- Use same value for user_id initially
      p_currency,
      v_new_balance,
      0,
      NOW()
    )
    RETURNING id INTO v_record_id;
  ELSE
    -- Calculate new balance
    v_new_balance := ROUND(v_previous_balance + p_amount, 2);

    -- Update the record
    UPDATE public.sub_account_balances
    SET
      available_balance = v_new_balance,
      last_updated = NOW()
    WHERE id = v_record_id;
  END IF;

  -- FIX: ALSO update canonical_users.usdc_balance when currency is USD
  -- This keeps both tables in sync and fixes the balance discrepancy
  IF p_currency = 'USD' THEN
    UPDATE public.canonical_users
    SET usdc_balance = COALESCE(usdc_balance, 0) + p_amount,
        updated_at = NOW()
    WHERE canonical_user_id = p_canonical_user_id;
  END IF;

  -- CRITICAL: Create balance_ledger audit entry
  INSERT INTO public.balance_ledger (
    canonical_user_id,
    transaction_type,
    amount,
    currency,
    balance_before,
    balance_after,
    reference_id,
    description,
    created_at
  ) VALUES (
    p_canonical_user_id,
    'credit',
    p_amount,
    p_currency,
    v_previous_balance,
    v_new_balance,
    p_reference_id,
    COALESCE(p_description, 'Account balance credited'),
    NOW()
  );

  RETURN QUERY SELECT TRUE, v_previous_balance, v_new_balance, NULL::TEXT;
END;
$function$;

-- =====================================================
-- FIX 5: Add sync_balance_discrepancies helper function
-- This can be called to fix existing balance discrepancies
-- Uses sub_account_balances as source of truth
-- =====================================================

CREATE OR REPLACE FUNCTION sync_balance_discrepancies()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fixed_count INTEGER := 0;
  v_discrepancy_record RECORD;
BEGIN
  -- Find and fix all discrepancies where canonical_users.usdc_balance != sub_account_balances.available_balance
  FOR v_discrepancy_record IN
    SELECT 
      cu.canonical_user_id,
      cu.usdc_balance as canonical_balance,
      COALESCE(sab.available_balance, 0) as sub_account_balance,
      COALESCE(sab.available_balance, 0) - cu.usdc_balance as discrepancy
    FROM canonical_users cu
    LEFT JOIN sub_account_balances sab ON cu.canonical_user_id = sab.canonical_user_id AND sab.currency = 'USD'
    WHERE ABS(COALESCE(sab.available_balance, 0) - cu.usdc_balance) > 0.01
  LOOP
    -- Use sub_account_balances as source of truth and update canonical_users
    UPDATE canonical_users
    SET usdc_balance = v_discrepancy_record.sub_account_balance,
        updated_at = NOW()
    WHERE canonical_user_id = v_discrepancy_record.canonical_user_id;

    v_fixed_count := v_fixed_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'discrepancies_fixed', v_fixed_count
  );
END;
$$;

COMMIT;

-- Log completion
DO $$
BEGIN
  RAISE NOTICE 'Migration complete: All dashboard issues fixed based on production schema';
  RAISE NOTICE '- Fixed UUID type casting error in joincompetition JOINs (c.id::TEXT -> c.id)';
  RAISE NOTICE '- Fixed balance discrepancy by syncing both tables in credit_sub_account_balance';
  RAISE NOTICE '- Added sync_balance_discrepancies() helper function';
  RAISE NOTICE '';
  RAISE NOTICE 'Next step: Run SELECT * FROM sync_balance_discrepancies(); to fix existing discrepancies';
END $$;
