-- =====================================================
-- COMPREHENSIVE FIX FOR DASHBOARD ISSUES
-- =====================================================
-- This migration fixes all the critical issues:
-- 1. Entries not showing due to UUID/TEXT type mismatches in JOIN conditions
-- 2. Orders tab empty due to same type issues
-- 3. RPC function errors (operator does not exist uuid = text)
-- 4. Balance discrepancy between canonical_users.usdc_balance and sub_account_balances
-- 5. Top-up balance glitches
--
-- Date: 2026-02-02
-- =====================================================

BEGIN;

-- =====================================================
-- FIX 1: DROP AND RECREATE get_user_competition_entries
-- with proper type casting for UUID/TEXT compatibility
-- =====================================================

DROP FUNCTION IF EXISTS get_user_competition_entries(TEXT) CASCADE;

CREATE OR REPLACE FUNCTION get_user_competition_entries(p_user_identifier TEXT)
RETURNS TABLE (
  competition_id TEXT,
  competition_title TEXT,
  tickets_count INTEGER,
  amount_spent NUMERIC,
  is_winner BOOLEAN,
  latest_purchase_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Return entries from both competition_entries AND joincompetition
  -- FIX: Cast c.id to TEXT and c.uid to TEXT for safe comparison
  RETURN QUERY
  WITH all_entries AS (
    -- Source 1: competition_entries table
    SELECT 
      ce.competition_id,
      c.title AS competition_title,
      ce.tickets_count,
      ce.amount_spent,
      ce.is_winner,
      ce.latest_purchase_at
    FROM competition_entries ce
    LEFT JOIN competitions c ON ce.competition_id = c.id::TEXT OR ce.competition_id = c.uid::TEXT
    WHERE ce.canonical_user_id = v_canonical_user_id

    UNION ALL

    -- Source 2: joincompetition table (where old data is!)
    SELECT
      jc.competitionid AS competition_id,
      c.title AS competition_title,
      jc.numberoftickets AS tickets_count,
      jc.amountspent AS amount_spent,
      false AS is_winner,
      jc.purchasedate AS latest_purchase_at
    FROM joincompetition jc
    LEFT JOIN competitions c ON jc.competitionid = c.id::TEXT OR jc.competitionid = c.uid::TEXT
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
$$;

-- =====================================================
-- FIX 2: DROP AND RECREATE get_comprehensive_user_dashboard_entries
-- with proper type casting for UUID/TEXT compatibility
-- =====================================================

DROP FUNCTION IF EXISTS get_comprehensive_user_dashboard_entries(TEXT) CASCADE;

CREATE OR REPLACE FUNCTION get_comprehensive_user_dashboard_entries(p_user_identifier TEXT)
RETURNS TABLE (
  id TEXT,
  competition_id TEXT,
  title TEXT,
  description TEXT,
  image TEXT,
  status TEXT,
  entry_type TEXT,
  is_winner BOOLEAN,
  ticket_numbers TEXT,
  total_tickets INTEGER,
  total_amount_spent NUMERIC,
  purchase_date TIMESTAMPTZ,
  transaction_hash TEXT,
  is_instant_win BOOLEAN,
  prize_value NUMERIC,
  competition_status TEXT,
  end_date TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  -- FIX: Cast c.id to TEXT and c.uid to TEXT for safe comparison
  RETURN QUERY
  WITH user_entries AS (
    -- Source 1: competition_entries table
    SELECT DISTINCT
      ce.id,
      ce.competition_id,
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
    LEFT JOIN competitions c ON ce.competition_id = c.id::TEXT OR ce.competition_id = c.uid::TEXT
    WHERE ce.canonical_user_id = v_canonical_user_id

    UNION ALL

    -- Source 2: user_transactions table
    SELECT DISTINCT
      ut.id,
      ut.competition_id,
      c.title,
      c.description,
      c.image_url AS image,
      c.status AS competition_status,
      'transaction' AS entry_type,
      false AS is_winner,
      ut.ticket_numbers,
      ut.ticket_count AS total_tickets,
      ut.amount AS total_amount_spent,
      ut.created_at AS purchase_date,
      ut.transaction_hash,
      c.is_instant_win,
      c.prize_value::NUMERIC AS prize_value,
      c.end_time AS end_date
    FROM user_transactions ut
    LEFT JOIN competitions c ON ut.competition_id = c.id::TEXT OR ut.competition_id = c.uid::TEXT
    WHERE (ut.user_id = v_canonical_user_id OR ut.canonical_user_id = v_canonical_user_id)
      AND ut.payment_status IN ('completed', 'confirmed')
      AND ut.competition_id IS NOT NULL

    UNION ALL

    -- Source 3: joincompetition table (CRITICAL - where old data is!)
    SELECT DISTINCT
      jc.uid AS id,
      jc.competitionid AS competition_id,
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
    LEFT JOIN competitions c ON jc.competitionid = c.id::TEXT OR jc.competitionid = c.uid::TEXT
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
$$;

-- =====================================================
-- FIX 3: DROP AND RECREATE get_user_transactions
-- with proper type casting for UUID/TEXT compatibility
-- =====================================================

DROP FUNCTION IF EXISTS get_user_transactions(TEXT) CASCADE;

CREATE OR REPLACE FUNCTION get_user_transactions(p_user_identifier TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transactions JSONB;
  v_canonical_user_id TEXT;
  search_wallet TEXT;
BEGIN
  -- Extract wallet if prize:pid: format
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
    RETURN jsonb_build_object(
      'success', true,
      'transactions', '[]'::jsonb
    );
  END IF;

  -- Get transactions
  -- FIX: No need to cast competition_id since it's already TEXT in user_transactions
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', id,
      'type', type,
      'amount', amount,
      'currency', currency,
      'status', status,
      'payment_status', payment_status,
      'competition_id', competition_id,
      'ticket_count', ticket_count,
      'ticket_numbers', ticket_numbers,
      'created_at', created_at,
      'completed_at', completed_at,
      'payment_method', payment_method,
      'payment_provider', payment_provider,
      'transaction_hash', transaction_hash,
      'tx_id', tx_id,
      'order_id', order_id,
      'webhook_ref', webhook_ref,
      'metadata', metadata,
      'balance_before', balance_before,
      'balance_after', balance_after
    ) ORDER BY created_at DESC
  ) INTO v_transactions
  FROM user_transactions
  WHERE user_id = p_user_identifier
     OR canonical_user_id = v_canonical_user_id
     OR user_id = v_canonical_user_id
     OR (search_wallet IS NOT NULL AND LOWER(wallet_address) = search_wallet)
  LIMIT 100;

  RETURN jsonb_build_object(
    'success', true,
    'transactions', COALESCE(v_transactions, '[]'::jsonb)
  );
END;
$$;

-- =====================================================
-- FIX 4: UPDATE credit_balance_with_first_deposit_bonus
-- to also update canonical_users.usdc_balance
-- This fixes the balance discrepancy issue
-- =====================================================

DROP FUNCTION IF EXISTS credit_balance_with_first_deposit_bonus(TEXT, NUMERIC, TEXT, TEXT) CASCADE;

CREATE OR REPLACE FUNCTION credit_balance_with_first_deposit_bonus(
  p_canonical_user_id TEXT,
  p_amount NUMERIC,
  p_reason TEXT,
  p_reference_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_used_bonus BOOLEAN;
  v_bonus_amount NUMERIC := 0;
  v_total_credit NUMERIC;
  v_new_balance NUMERIC;
  v_balance_before NUMERIC;
BEGIN
  -- Check if user has used first deposit bonus
  SELECT has_used_new_user_bonus INTO v_has_used_bonus
  FROM canonical_users
  WHERE canonical_user_id = p_canonical_user_id;

  -- If first deposit, add 50% bonus
  IF v_has_used_bonus = false OR v_has_used_bonus IS NULL THEN
    v_bonus_amount := p_amount * 0.50; -- 50% bonus
    v_total_credit := p_amount + v_bonus_amount;

    -- Mark bonus as used
    UPDATE canonical_users
    SET has_used_new_user_bonus = true,
        updated_at = NOW()
    WHERE canonical_user_id = p_canonical_user_id;

    -- Log bonus award to audit table
    INSERT INTO bonus_award_audit (
      canonical_user_id,
      amount,
      reason,
      note
    ) VALUES (
      p_canonical_user_id,
      v_bonus_amount,
      p_reason,
      'First deposit bonus: 50%'
    );
  ELSE
    v_total_credit := p_amount;
  END IF;

  -- Get current balance before update
  SELECT COALESCE(available_balance, 0) INTO v_balance_before
  FROM sub_account_balances
  WHERE canonical_user_id = p_canonical_user_id AND currency = 'USD';

  -- FIX 1: Credit total amount to sub_account_balances
  INSERT INTO sub_account_balances (canonical_user_id, currency, available_balance)
  VALUES (p_canonical_user_id, 'USD', v_total_credit)
  ON CONFLICT (canonical_user_id, currency)
  DO UPDATE SET
    available_balance = sub_account_balances.available_balance + v_total_credit,
    updated_at = NOW();

  -- Get the new balance after credit
  SELECT available_balance INTO v_new_balance
  FROM sub_account_balances
  WHERE canonical_user_id = p_canonical_user_id AND currency = 'USD';

  -- FIX 2: ALSO update canonical_users.usdc_balance to keep both tables in sync
  -- This fixes the balance discrepancy issue
  UPDATE canonical_users
  SET usdc_balance = COALESCE(usdc_balance, 0) + v_total_credit,
      updated_at = NOW()
  WHERE canonical_user_id = p_canonical_user_id;

  -- Log transaction in balance ledger with before/after balances
  INSERT INTO balance_ledger (
    canonical_user_id,
    transaction_type,
    amount,
    balance_before,
    balance_after,
    reference_id,
    description
  ) VALUES (
    p_canonical_user_id,
    'deposit',
    v_total_credit,
    COALESCE(v_balance_before, 0),
    COALESCE(v_new_balance, v_total_credit),
    p_reference_id,
    p_reason || CASE WHEN v_bonus_amount > 0 THEN ' (with 50% bonus)' ELSE '' END
  );

  RETURN jsonb_build_object(
    'success', true,
    'credited_amount', p_amount,
    'bonus_amount', v_bonus_amount,
    'bonus_applied', v_bonus_amount > 0,
    'total_credited', v_total_credit,
    'balance_before', COALESCE(v_balance_before, 0),
    'new_balance', COALESCE(v_new_balance, v_total_credit)
  );
END;
$$;

-- =====================================================
-- FIX 5: UPDATE credit_sub_account_balance
-- to also update canonical_users.usdc_balance
-- =====================================================

DROP FUNCTION IF EXISTS credit_sub_account_balance(TEXT, NUMERIC, TEXT) CASCADE;

CREATE OR REPLACE FUNCTION credit_sub_account_balance(
  p_canonical_user_id TEXT,
  p_amount NUMERIC,
  p_currency TEXT DEFAULT 'USD'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_balance NUMERIC;
  v_balance_before NUMERIC;
BEGIN
  -- Validate amount
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Amount must be positive'
    );
  END IF;

  -- Get current balance
  SELECT COALESCE(available_balance, 0) INTO v_balance_before
  FROM sub_account_balances
  WHERE canonical_user_id = p_canonical_user_id AND currency = p_currency;

  -- Credit to sub_account_balances
  INSERT INTO sub_account_balances (canonical_user_id, currency, available_balance)
  VALUES (p_canonical_user_id, p_currency, p_amount)
  ON CONFLICT (canonical_user_id, currency)
  DO UPDATE SET
    available_balance = sub_account_balances.available_balance + p_amount,
    updated_at = NOW();

  -- Get new balance
  SELECT available_balance INTO v_new_balance
  FROM sub_account_balances
  WHERE canonical_user_id = p_canonical_user_id AND currency = p_currency;

  -- FIX: ALSO update canonical_users.usdc_balance for consistency
  IF p_currency = 'USD' THEN
    UPDATE canonical_users
    SET usdc_balance = COALESCE(usdc_balance, 0) + p_amount,
        updated_at = NOW()
    WHERE canonical_user_id = p_canonical_user_id;
  END IF;

  -- Log to balance ledger
  INSERT INTO balance_ledger (
    canonical_user_id,
    transaction_type,
    amount,
    currency,
    balance_before,
    balance_after,
    description
  ) VALUES (
    p_canonical_user_id,
    'credit',
    p_amount,
    p_currency,
    COALESCE(v_balance_before, 0),
    COALESCE(v_new_balance, p_amount),
    'Balance credit'
  );

  RETURN jsonb_build_object(
    'success', true,
    'amount_credited', p_amount,
    'currency', p_currency,
    'balance_before', COALESCE(v_balance_before, 0),
    'new_balance', COALESCE(v_new_balance, p_amount)
  );
END;
$$;

-- =====================================================
-- FIX 6: UPDATE debit_sub_account_balance
-- to also update canonical_users.usdc_balance
-- =====================================================

DROP FUNCTION IF EXISTS debit_sub_account_balance(TEXT, NUMERIC, TEXT) CASCADE;

CREATE OR REPLACE FUNCTION debit_sub_account_balance(
  p_canonical_user_id TEXT,
  p_amount NUMERIC,
  p_currency TEXT DEFAULT 'USD'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_balance NUMERIC;
  v_new_balance NUMERIC;
BEGIN
  -- Validate amount
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Amount must be positive'
    );
  END IF;

  -- Get current balance with row lock
  SELECT available_balance INTO v_current_balance
  FROM sub_account_balances
  WHERE canonical_user_id = p_canonical_user_id AND currency = p_currency
  FOR UPDATE;

  -- Check sufficient balance
  IF v_current_balance IS NULL OR v_current_balance < p_amount THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Insufficient balance',
      'current_balance', COALESCE(v_current_balance, 0),
      'required', p_amount
    );
  END IF;

  -- Debit from sub_account_balances
  UPDATE sub_account_balances
  SET available_balance = available_balance - p_amount,
      updated_at = NOW()
  WHERE canonical_user_id = p_canonical_user_id AND currency = p_currency;

  -- Get new balance
  SELECT available_balance INTO v_new_balance
  FROM sub_account_balances
  WHERE canonical_user_id = p_canonical_user_id AND currency = p_currency;

  -- FIX: ALSO update canonical_users.usdc_balance for consistency
  IF p_currency = 'USD' THEN
    UPDATE canonical_users
    SET usdc_balance = GREATEST(COALESCE(usdc_balance, 0) - p_amount, 0),
        updated_at = NOW()
    WHERE canonical_user_id = p_canonical_user_id;
  END IF;

  -- Log to balance ledger
  INSERT INTO balance_ledger (
    canonical_user_id,
    transaction_type,
    amount,
    currency,
    balance_before,
    balance_after,
    description
  ) VALUES (
    p_canonical_user_id,
    'debit',
    p_amount,
    p_currency,
    v_current_balance,
    COALESCE(v_new_balance, 0),
    'Balance debit'
  );

  RETURN jsonb_build_object(
    'success', true,
    'amount_debited', p_amount,
    'currency', p_currency,
    'balance_before', v_current_balance,
    'new_balance', COALESCE(v_new_balance, 0)
  );
END;
$$;

-- =====================================================
-- FIX 7: Add helper function to sync balance discrepancies
-- This can be called manually or periodically to fix any discrepancies
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
  RAISE NOTICE 'Migration complete: All dashboard issues fixed';
  RAISE NOTICE '- Fixed UUID/TEXT type mismatches in JOIN conditions';
  RAISE NOTICE '- Fixed balance discrepancy by syncing both tables';
  RAISE NOTICE '- Added sync_balance_discrepancies() helper function';
END $$;
