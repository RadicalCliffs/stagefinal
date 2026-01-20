-- =====================================================
-- COMPREHENSIVE FIX: Balance RPC Functions for Payment System
-- =====================================================
-- This migration implements the missing critical RPCs from PAYMENT_DATABASE_SCHEMA.md:
-- 1. credit_sub_account_balance - Credits user balance with ledger tracking
-- 2. debit_sub_account_balance - Debits user balance with ledger tracking  
-- 3. debit_sub_account_balance_with_entry - Debits balance AND creates competition entry
-- 4. get_user_competition_entries - Gets user entries for dashboard display
--
-- ISSUE: Previous implementations existed but didn't properly:
-- - Create balance_ledger audit trail entries
-- - Handle entry creation atomically with balance debit
-- - Surface entries correctly on user dashboard
--
-- Date: 2026-01-20
-- =====================================================

BEGIN;

-- =====================================================
-- PART 1: Update balance_ledger table to match schema
-- =====================================================
-- Add missing columns to balance_ledger to match PAYMENT_DATABASE_SCHEMA.md

DO $$
BEGIN
  -- Add canonical_user_id column if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'balance_ledger'
    AND column_name = 'canonical_user_id'
  ) THEN
    ALTER TABLE public.balance_ledger ADD COLUMN canonical_user_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_balance_ledger_canonical_user_id 
      ON public.balance_ledger(canonical_user_id);
    RAISE NOTICE 'Added canonical_user_id column to balance_ledger';
  END IF;

  -- Add transaction_type column if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'balance_ledger'
    AND column_name = 'transaction_type'
  ) THEN
    ALTER TABLE public.balance_ledger ADD COLUMN transaction_type TEXT;
    CREATE INDEX IF NOT EXISTS idx_balance_ledger_transaction_type 
      ON public.balance_ledger(transaction_type);
    RAISE NOTICE 'Added transaction_type column to balance_ledger';
  END IF;

  -- Add balance_before column if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'balance_ledger'
    AND column_name = 'balance_before'
  ) THEN
    ALTER TABLE public.balance_ledger ADD COLUMN balance_before NUMERIC DEFAULT 0;
    RAISE NOTICE 'Added balance_before column to balance_ledger';
  END IF;

  -- Add balance_after column if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'balance_ledger'
    AND column_name = 'balance_after'
  ) THEN
    ALTER TABLE public.balance_ledger ADD COLUMN balance_after NUMERIC DEFAULT 0;
    RAISE NOTICE 'Added balance_after column to balance_ledger';
  END IF;

  -- Add currency column if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'balance_ledger'
    AND column_name = 'currency'
  ) THEN
    ALTER TABLE public.balance_ledger ADD COLUMN currency TEXT DEFAULT 'USD';
    RAISE NOTICE 'Added currency column to balance_ledger';
  END IF;

  -- Add reference_id column if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'balance_ledger'
    AND column_name = 'reference_id'
  ) THEN
    ALTER TABLE public.balance_ledger ADD COLUMN reference_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_balance_ledger_reference_id 
      ON public.balance_ledger(reference_id);
    RAISE NOTICE 'Added reference_id column to balance_ledger';
  END IF;

  -- Add description column if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'balance_ledger'
    AND column_name = 'description'
  ) THEN
    ALTER TABLE public.balance_ledger ADD COLUMN description TEXT;
    RAISE NOTICE 'Added description column to balance_ledger';
  END IF;
END $$;

-- =====================================================
-- PART 2: UPDATE credit_sub_account_balance RPC
-- =====================================================
-- Credits user's sub_account_balance AND creates balance_ledger entry

DROP FUNCTION IF EXISTS credit_sub_account_balance(TEXT, NUMERIC, TEXT) CASCADE;

CREATE OR REPLACE FUNCTION credit_sub_account_balance(
  p_canonical_user_id TEXT,
  p_amount NUMERIC,
  p_currency TEXT DEFAULT 'USD',
  p_reference_id TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL
)
RETURNS TABLE(
  success BOOLEAN,
  previous_balance NUMERIC,
  new_balance NUMERIC,
  error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

GRANT EXECUTE ON FUNCTION credit_sub_account_balance(TEXT, NUMERIC, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION credit_sub_account_balance(TEXT, NUMERIC, TEXT, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION credit_sub_account_balance(TEXT, NUMERIC, TEXT, TEXT, TEXT) IS 
'Credits user sub_account_balance and creates balance_ledger audit entry. Use for top-ups.';

-- =====================================================
-- PART 3: UPDATE debit_sub_account_balance RPC
-- =====================================================
-- Debits user's sub_account_balance AND creates balance_ledger entry

DROP FUNCTION IF EXISTS debit_sub_account_balance(TEXT, NUMERIC, TEXT) CASCADE;

CREATE OR REPLACE FUNCTION debit_sub_account_balance(
  p_canonical_user_id TEXT,
  p_amount NUMERIC,
  p_currency TEXT DEFAULT 'USD',
  p_reference_id TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL
)
RETURNS TABLE(
  success BOOLEAN,
  previous_balance NUMERIC,
  new_balance NUMERIC,
  error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Find the record to update (with row lock)
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
    RETURN QUERY SELECT FALSE, 0::NUMERIC, 0::NUMERIC, 'User balance record not found'::TEXT;
    RETURN;
  END IF;

  -- Check sufficient balance
  IF v_previous_balance < p_amount THEN
    RETURN QUERY SELECT FALSE, v_previous_balance, v_previous_balance,
      format('Insufficient balance. Have: %s, Need: %s', v_previous_balance, p_amount)::TEXT;
    RETURN;
  END IF;

  -- Calculate new balance
  v_new_balance := ROUND(v_previous_balance - p_amount, 2);

  -- Update the record
  UPDATE public.sub_account_balances
  SET
    available_balance = v_new_balance,
    last_updated = NOW()
  WHERE id = v_record_id;

  -- CRITICAL: Create balance_ledger audit entry (negative amount for debit)
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
    'debit',
    -p_amount,  -- Negative for debit
    p_currency,
    v_previous_balance,
    v_new_balance,
    p_reference_id,
    COALESCE(p_description, 'Account balance debited'),
    NOW()
  );

  RETURN QUERY SELECT TRUE, v_previous_balance, v_new_balance, NULL::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION debit_sub_account_balance(TEXT, NUMERIC, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION debit_sub_account_balance(TEXT, NUMERIC, TEXT, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION debit_sub_account_balance(TEXT, NUMERIC, TEXT, TEXT, TEXT) IS 
'Debits user sub_account_balance and creates balance_ledger audit entry. Use for purchases.';

-- =====================================================
-- PART 4: CREATE debit_sub_account_balance_with_entry RPC
-- =====================================================
-- Atomically debits balance AND creates competition entry
-- This is the critical missing function for balance-based ticket purchases

DROP FUNCTION IF EXISTS debit_sub_account_balance_with_entry(TEXT, UUID, NUMERIC, INTEGER, TEXT, TEXT) CASCADE;

CREATE OR REPLACE FUNCTION debit_sub_account_balance_with_entry(
  p_canonical_user_id TEXT,
  p_competition_id UUID,
  p_amount NUMERIC,
  p_ticket_count INTEGER,
  p_ticket_numbers TEXT DEFAULT '',
  p_transaction_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance_result RECORD;
  v_entry_uid UUID;
  v_wallet_address TEXT;
BEGIN
  -- Step 1: Debit the balance (with ledger entry)
  SELECT *
  INTO v_balance_result
  FROM debit_sub_account_balance(
    p_canonical_user_id,
    p_amount,
    'USD',
    p_transaction_id,
    format('Purchase %s tickets for competition %s', p_ticket_count, p_competition_id)
  );

  -- Check if debit was successful
  IF NOT v_balance_result.success THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', v_balance_result.error_message,
      'previous_balance', v_balance_result.previous_balance
    );
  END IF;

  -- Extract wallet address if canonical_user_id is in prize:pid:0x... format
  IF p_canonical_user_id LIKE 'prize:pid:0x%' THEN
    v_wallet_address := LOWER(SUBSTRING(p_canonical_user_id FROM 11));
  ELSIF p_canonical_user_id LIKE '0x%' THEN
    v_wallet_address := LOWER(p_canonical_user_id);
  ELSE
    v_wallet_address := NULL;
  END IF;

  -- Step 2: Create competition entry in joincompetition table
  v_entry_uid := gen_random_uuid();
  
  INSERT INTO public.joincompetition (
    uid,
    competitionid,
    userid,
    canonical_user_id,
    numberoftickets,
    ticketnumbers,
    amountspent,
    walletaddress,
    chain,
    transactionhash,
    purchasedate,
    created_at
  ) VALUES (
    v_entry_uid,
    p_competition_id,
    p_canonical_user_id,
    p_canonical_user_id,
    p_ticket_count,
    p_ticket_numbers,
    p_amount,
    v_wallet_address,
    'balance',  -- Payment method
    COALESCE(p_transaction_id, v_entry_uid::TEXT),  -- Use transaction_id or entry uid
    NOW(),
    NOW()
  );

  -- Step 3: Return success with details
  RETURN jsonb_build_object(
    'success', true,
    'entry_uid', v_entry_uid,
    'previous_balance', v_balance_result.previous_balance,
    'new_balance', v_balance_result.new_balance,
    'amount_debited', p_amount,
    'ticket_count', p_ticket_count,
    'competition_id', p_competition_id
  );

EXCEPTION
  WHEN OTHERS THEN
    -- If anything fails, the transaction will be rolled back automatically
    RETURN jsonb_build_object(
      'success', false,
      'error', SQLERRM,
      'error_detail', SQLSTATE
    );
END;
$$;

GRANT EXECUTE ON FUNCTION debit_sub_account_balance_with_entry(TEXT, UUID, NUMERIC, INTEGER, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION debit_sub_account_balance_with_entry(TEXT, UUID, NUMERIC, INTEGER, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION debit_sub_account_balance_with_entry(TEXT, UUID, NUMERIC, INTEGER, TEXT, TEXT) IS 
'Atomically debits user balance and creates competition entry. Returns success/error with balance details.';

-- =====================================================
-- PART 5: CREATE get_user_competition_entries RPC
-- =====================================================
-- Gets all competition entries for a user (for dashboard display)
-- This is a simpler alternative to get_comprehensive_user_dashboard_entries
-- specifically for competition entries

DROP FUNCTION IF EXISTS get_user_competition_entries(TEXT) CASCADE;

CREATE OR REPLACE FUNCTION get_user_competition_entries(p_user_identifier TEXT)
RETURNS TABLE (
  entry_id TEXT,
  competition_id TEXT,
  competition_title TEXT,
  ticket_count INTEGER,
  ticket_numbers TEXT,
  amount_spent NUMERIC,
  purchase_date TIMESTAMPTZ,
  payment_method TEXT,
  transaction_hash TEXT,
  is_winner BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  lower_identifier TEXT;
  search_wallet TEXT;
  resolved_canonical_user_id TEXT := NULL;
BEGIN
  -- Normalize identifier
  lower_identifier := LOWER(TRIM(p_user_identifier));

  -- Extract wallet address if present
  IF p_user_identifier LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(p_user_identifier FROM 11));
  ELSIF p_user_identifier LIKE '0x%' THEN
    search_wallet := lower_identifier;
  ELSE
    search_wallet := NULL;
  END IF;

  -- Resolve user from canonical_users
  SELECT cu.canonical_user_id
  INTO resolved_canonical_user_id
  FROM canonical_users cu
  WHERE
    cu.canonical_user_id = p_user_identifier
    OR LOWER(cu.wallet_address) = lower_identifier
    OR LOWER(cu.base_wallet_address) = lower_identifier
    OR LOWER(cu.eth_wallet_address) = lower_identifier
    OR cu.privy_user_id = p_user_identifier
    OR (search_wallet IS NOT NULL AND (
      LOWER(cu.wallet_address) = search_wallet
      OR LOWER(cu.base_wallet_address) = search_wallet
      OR LOWER(cu.eth_wallet_address) = search_wallet
    ))
  LIMIT 1;

  -- Return entries
  RETURN QUERY
  SELECT
    jc.uid::TEXT AS entry_id,
    jc.competitionid::TEXT AS competition_id,
    COALESCE(c.title, '') AS competition_title,
    COALESCE(jc.numberoftickets, 0)::INTEGER AS ticket_count,
    COALESCE(jc.ticketnumbers, '') AS ticket_numbers,
    COALESCE(jc.amountspent, 0)::NUMERIC AS amount_spent,
    jc.purchasedate AS purchase_date,
    COALESCE(jc.chain, 'unknown') AS payment_method,
    jc.transactionhash AS transaction_hash,
    COALESCE(
      LOWER(c.winner_address) = LOWER(jc.walletaddress),
      FALSE
    ) AS is_winner
  FROM public.joincompetition jc
  LEFT JOIN public.competitions c ON jc.competitionid = c.id::TEXT
  WHERE (
    -- Match using resolved canonical_user_id
    (resolved_canonical_user_id IS NOT NULL AND jc.canonical_user_id = resolved_canonical_user_id)
    -- Fallback: Direct matching
    OR (resolved_canonical_user_id IS NULL AND (
      jc.canonical_user_id = p_user_identifier
      OR jc.userid = p_user_identifier
      OR LOWER(jc.walletaddress) = lower_identifier
      OR (search_wallet IS NOT NULL AND LOWER(jc.walletaddress) = search_wallet)
    ))
  )
  AND jc.competitionid IS NOT NULL
  ORDER BY jc.purchasedate DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_user_competition_entries(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_competition_entries(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_user_competition_entries(TEXT) TO service_role;

COMMENT ON FUNCTION get_user_competition_entries(TEXT) IS 
'Gets all competition entries for a user, including entries paid with balance. Used for dashboard display.';

-- =====================================================
-- VALIDATION
-- =====================================================

DO $$
DECLARE
  func_count INTEGER;
  ledger_columns_count INTEGER;
BEGIN
  -- Count created functions
  SELECT COUNT(*) INTO func_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'credit_sub_account_balance',
      'debit_sub_account_balance',
      'debit_sub_account_balance_with_entry',
      'get_user_competition_entries'
    );

  -- Count balance_ledger columns
  SELECT COUNT(*) INTO ledger_columns_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'balance_ledger'
    AND column_name IN (
      'canonical_user_id',
      'transaction_type',
      'balance_before',
      'balance_after',
      'currency',
      'reference_id',
      'description'
    );

  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'BALANCE RPC FUNCTIONS - MIGRATION COMPLETE';
  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'Functions created: % / 4', func_count;
  RAISE NOTICE 'Balance ledger columns added: % / 7', ledger_columns_count;
  RAISE NOTICE '';
  RAISE NOTICE 'Created RPCs:';
  RAISE NOTICE '  1. credit_sub_account_balance(canonical_user_id, amount, currency, reference_id, description)';
  RAISE NOTICE '     → Credits user balance + creates ledger entry';
  RAISE NOTICE '';
  RAISE NOTICE '  2. debit_sub_account_balance(canonical_user_id, amount, currency, reference_id, description)';
  RAISE NOTICE '     → Debits user balance + creates ledger entry';
  RAISE NOTICE '';
  RAISE NOTICE '  3. debit_sub_account_balance_with_entry(canonical_user_id, competition_id, amount, ticket_count, ticket_numbers, transaction_id)';
  RAISE NOTICE '     → Atomically debits balance AND creates competition entry';
  RAISE NOTICE '';
  RAISE NOTICE '  4. get_user_competition_entries(user_identifier)';
  RAISE NOTICE '     → Gets all user competition entries for dashboard';
  RAISE NOTICE '';
  RAISE NOTICE 'Next steps:';
  RAISE NOTICE '  - Apply this migration to Supabase';
  RAISE NOTICE '  - Update process-balance-payments edge function to use these RPCs';
  RAISE NOTICE '  - Test: top-up → balance → purchase → entry shows on dashboard';
  RAISE NOTICE '=====================================================';
END $$;

COMMIT;
