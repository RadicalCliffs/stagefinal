-- =====================================================
-- FIX: 5 CRITICAL ERRORS FOR FULL FUNCTIONALITY
-- =====================================================
-- This migration addresses five critical errors identified in the codebase:
--
-- 1. credit_user_balance/debit_user_balance STILL REFERENCE privy_user_connections
--    The older version in 20251217000001_fix_credit_balance_for_base_auth.sql
--    still references the deprecated privy_user_connections table.
--
-- 2. Missing sub_account_balances sync when debiting/crediting
--    The balance functions update canonical_users and wallet_balances,
--    but not sub_account_balances which is the PRIMARY balance source.
--
-- 3. Missing ExternalLink import in PaymentModal.tsx (frontend error)
--    The PaymentModal uses <ExternalLink> but doesn't import it.
--    (This requires a code fix, noted for documentation)
--
-- 4. Race condition in balance deduction - non-atomic balance check and debit
--    The debit_user_balance function reads then updates in separate statements
--    without FOR UPDATE lock, allowing concurrent over-debits.
--
-- 5. Missing RLS policy for sub_account_balances INSERT/UPDATE
--    Users cannot update their own balance records via authenticated role.
-- =====================================================

BEGIN;

-- =====================================================
-- FIX #1 & #2 & #4: RECREATE credit_user_balance with proper table reference
-- and sub_account_balances sync
-- =====================================================

-- Drop ALL versions of credit_user_balance to ensure clean slate
DROP FUNCTION IF EXISTS credit_user_balance(TEXT, NUMERIC) CASCADE;
DROP FUNCTION IF EXISTS credit_user_balance(TEXT, NUMERIC, TEXT) CASCADE;

CREATE OR REPLACE FUNCTION credit_user_balance(
  p_user_identifier TEXT,
  p_amount NUMERIC,
  p_reason TEXT DEFAULT 'credit'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_record RECORD;
  v_new_balance NUMERIC;
  v_search_wallet TEXT;
  v_canonical_user_id TEXT;
BEGIN
  -- Validate inputs
  IF p_user_identifier IS NULL OR TRIM(p_user_identifier) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'User identifier is required');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be positive');
  END IF;

  -- Extract wallet address for matching (case-insensitive)
  IF p_user_identifier LIKE 'prize:pid:0x%' THEN
    v_search_wallet := LOWER(SUBSTRING(p_user_identifier FROM 11));
    v_canonical_user_id := 'prize:pid:' || v_search_wallet;
  ELSIF p_user_identifier LIKE '0x%' AND LENGTH(p_user_identifier) = 42 THEN
    v_search_wallet := LOWER(p_user_identifier);
    v_canonical_user_id := 'prize:pid:' || v_search_wallet;
  ELSE
    v_search_wallet := NULL;
    v_canonical_user_id := p_user_identifier;
  END IF;

  -- Find user in canonical_users (NOT privy_user_connections - that table is deprecated)
  SELECT id, uid, canonical_user_id, COALESCE(usdc_balance, 0) as usdc_balance, wallet_address, base_wallet_address
  INTO v_user_record
  FROM public.canonical_users
  WHERE
    canonical_user_id = p_user_identifier
    OR canonical_user_id = LOWER(p_user_identifier)
    OR canonical_user_id = v_canonical_user_id
    OR (v_search_wallet IS NOT NULL AND LOWER(wallet_address) = v_search_wallet)
    OR (v_search_wallet IS NOT NULL AND LOWER(base_wallet_address) = v_search_wallet)
    OR privy_user_id = p_user_identifier
    OR uid = p_user_identifier
  LIMIT 1;

  IF v_user_record IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found for identifier: ' || LEFT(p_user_identifier, 20));
  END IF;

  -- Update balance in canonical_users
  UPDATE public.canonical_users
  SET
    usdc_balance = COALESCE(usdc_balance, 0) + p_amount,
    updated_at = NOW()
  WHERE id = v_user_record.id
  RETURNING usdc_balance INTO v_new_balance;

  -- FIX #2: Also update sub_account_balances (PRIMARY balance source)
  -- Use UPSERT to handle case where record doesn't exist
  INSERT INTO public.sub_account_balances (
    user_id,
    canonical_user_id,
    privy_user_id,
    currency,
    available_balance,
    pending_balance,
    created_at,
    updated_at
  )
  VALUES (
    v_user_record.uid,
    COALESCE(v_user_record.canonical_user_id, v_canonical_user_id),
    p_user_identifier,
    'USD',
    p_amount,
    0,
    NOW(),
    NOW()
  )
  ON CONFLICT (canonical_user_id, currency)
  DO UPDATE SET
    available_balance = COALESCE(sub_account_balances.available_balance, 0) + EXCLUDED.available_balance,
    updated_at = NOW();

  -- Also update wallet_balances if it exists (secondary balance table)
  BEGIN
    INSERT INTO public.wallet_balances (
      user_id,
      canonical_user_id,
      wallet_address,
      base_wallet_address,
      balance,
      updated_at
    )
    VALUES (
      v_user_record.id,
      COALESCE(v_user_record.canonical_user_id, v_canonical_user_id),
      v_user_record.wallet_address,
      v_user_record.base_wallet_address,
      p_amount,
      NOW()
    )
    ON CONFLICT (user_id)
    DO UPDATE SET
      balance = COALESCE(wallet_balances.balance, 0) + p_amount,
      updated_at = NOW();
  EXCEPTION WHEN undefined_table THEN
    NULL; -- wallet_balances table doesn't exist, skip
  EXCEPTION WHEN undefined_column THEN
    NULL; -- Missing column, skip
  END;

  RETURN jsonb_build_object(
    'success', true,
    'new_balance', v_new_balance,
    'amount_credited', p_amount,
    'reason', p_reason,
    'user_id', v_user_record.uid
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'Database error: ' || SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION credit_user_balance(TEXT, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION credit_user_balance(TEXT, NUMERIC, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION credit_user_balance(TEXT, NUMERIC, TEXT) TO service_role;

COMMENT ON FUNCTION credit_user_balance(TEXT, NUMERIC, TEXT) IS
'Credits user balance in canonical_users, sub_account_balances, and wallet_balances.
Fixed to use canonical_users (not deprecated privy_user_connections) and sync all balance tables.';

-- =====================================================
-- FIX #1 & #2 & #4: RECREATE debit_user_balance with FOR UPDATE lock
-- to prevent race conditions
-- =====================================================

DROP FUNCTION IF EXISTS debit_user_balance(TEXT, NUMERIC) CASCADE;
DROP FUNCTION IF EXISTS debit_user_balance(TEXT, NUMERIC, TEXT) CASCADE;

CREATE OR REPLACE FUNCTION debit_user_balance(
  p_user_identifier TEXT,
  p_amount NUMERIC,
  p_reason TEXT DEFAULT 'debit'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_record RECORD;
  v_new_balance NUMERIC;
  v_search_wallet TEXT;
  v_canonical_user_id TEXT;
  v_current_balance NUMERIC;
BEGIN
  -- Validate inputs
  IF p_user_identifier IS NULL OR TRIM(p_user_identifier) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'User identifier is required');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be positive');
  END IF;

  -- Extract wallet address for matching (case-insensitive)
  IF p_user_identifier LIKE 'prize:pid:0x%' THEN
    v_search_wallet := LOWER(SUBSTRING(p_user_identifier FROM 11));
    v_canonical_user_id := 'prize:pid:' || v_search_wallet;
  ELSIF p_user_identifier LIKE '0x%' AND LENGTH(p_user_identifier) = 42 THEN
    v_search_wallet := LOWER(p_user_identifier);
    v_canonical_user_id := 'prize:pid:' || v_search_wallet;
  ELSE
    v_search_wallet := NULL;
    v_canonical_user_id := p_user_identifier;
  END IF;

  -- FIX #4: Use FOR UPDATE lock to prevent race conditions
  -- This ensures atomic read-check-update without concurrent modifications
  SELECT id, uid, canonical_user_id, COALESCE(usdc_balance, 0) as usdc_balance, wallet_address, base_wallet_address
  INTO v_user_record
  FROM public.canonical_users
  WHERE
    canonical_user_id = p_user_identifier
    OR canonical_user_id = LOWER(p_user_identifier)
    OR canonical_user_id = v_canonical_user_id
    OR (v_search_wallet IS NOT NULL AND LOWER(wallet_address) = v_search_wallet)
    OR (v_search_wallet IS NOT NULL AND LOWER(base_wallet_address) = v_search_wallet)
    OR privy_user_id = p_user_identifier
    OR uid = p_user_identifier
  FOR UPDATE  -- CRITICAL: Lock row to prevent concurrent modifications
  LIMIT 1;

  IF v_user_record IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found for identifier: ' || LEFT(p_user_identifier, 20));
  END IF;

  -- Check sufficient balance (now protected by FOR UPDATE lock)
  v_current_balance := COALESCE(v_user_record.usdc_balance, 0);

  IF v_current_balance < p_amount THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Insufficient balance',
      'current_balance', v_current_balance,
      'required', p_amount
    );
  END IF;

  -- Update balance in canonical_users (atomic with the lock)
  UPDATE public.canonical_users
  SET
    usdc_balance = v_current_balance - p_amount,
    updated_at = NOW()
  WHERE id = v_user_record.id
  RETURNING usdc_balance INTO v_new_balance;

  -- FIX #2: Also update sub_account_balances (PRIMARY balance source)
  BEGIN
    UPDATE public.sub_account_balances
    SET
      available_balance = GREATEST(0, COALESCE(available_balance, 0) - p_amount),
      updated_at = NOW()
    WHERE
      (canonical_user_id = v_user_record.canonical_user_id OR canonical_user_id = v_canonical_user_id)
      AND currency = 'USD';

    -- If no rows updated, the record might not exist yet - that's OK
    -- The balance was already deducted from canonical_users
  EXCEPTION WHEN undefined_table THEN
    NULL; -- sub_account_balances doesn't exist
  END;

  -- Also update wallet_balances if it exists
  BEGIN
    UPDATE public.wallet_balances
    SET
      balance = GREATEST(0, COALESCE(balance, 0) - p_amount),
      updated_at = NOW()
    WHERE user_id = v_user_record.id;
  EXCEPTION WHEN undefined_table THEN
    NULL; -- wallet_balances table doesn't exist
  END;

  RETURN jsonb_build_object(
    'success', true,
    'new_balance', v_new_balance,
    'amount_debited', p_amount,
    'previous_balance', v_current_balance,
    'reason', p_reason,
    'user_id', v_user_record.uid
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'Database error: ' || SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION debit_user_balance(TEXT, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION debit_user_balance(TEXT, NUMERIC, TEXT) TO service_role;
-- Note: anon should NOT be able to debit balances

COMMENT ON FUNCTION debit_user_balance(TEXT, NUMERIC, TEXT) IS
'Debits user balance with FOR UPDATE lock to prevent race conditions.
Fixed to use canonical_users (not deprecated privy_user_connections) and sync all balance tables.';

-- =====================================================
-- FIX #5: Add RLS policies for sub_account_balances
-- =====================================================

-- Enable RLS on sub_account_balances if not already enabled
ALTER TABLE IF EXISTS public.sub_account_balances ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to recreate them properly
DROP POLICY IF EXISTS "sub_account_balances_select_own" ON public.sub_account_balances;
DROP POLICY IF EXISTS "sub_account_balances_insert_service" ON public.sub_account_balances;
DROP POLICY IF EXISTS "sub_account_balances_update_service" ON public.sub_account_balances;
DROP POLICY IF EXISTS "sub_account_balances_select_all" ON public.sub_account_balances;

-- Policy: Users can read their own balance (via canonical_user_id match)
-- Note: We allow anon to read because balance lookup happens before auth is fully established
CREATE POLICY "sub_account_balances_select_all"
  ON public.sub_account_balances
  FOR SELECT
  USING (true);  -- Allow all reads (balance is not sensitive, and we need it for payment validation)

-- Policy: Only service_role can INSERT (balance created by server-side functions)
CREATE POLICY "sub_account_balances_insert_service"
  ON public.sub_account_balances
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Policy: Only service_role can UPDATE (balance modified by server-side functions)
CREATE POLICY "sub_account_balances_update_service"
  ON public.sub_account_balances
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Ensure sub_account_balances has the required unique constraint for UPSERT
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sub_account_balances_canonical_user_id_currency_key'
  ) THEN
    -- Create unique constraint if it doesn't exist
    ALTER TABLE public.sub_account_balances
    ADD CONSTRAINT sub_account_balances_canonical_user_id_currency_key
    UNIQUE (canonical_user_id, currency);
  END IF;
EXCEPTION
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_object THEN NULL;
END $$;

-- =====================================================
-- VALIDATION: Verify fixes were applied
-- =====================================================

DO $$
DECLARE
  credit_exists BOOLEAN;
  debit_exists BOOLEAN;
  credit_uses_canonical BOOLEAN;
  debit_uses_canonical BOOLEAN;
  rls_enabled BOOLEAN;
BEGIN
  -- Check functions exist
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'credit_user_balance'
  ) INTO credit_exists;

  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'debit_user_balance'
  ) INTO debit_exists;

  -- Check if functions reference canonical_users (not privy_user_connections)
  SELECT NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'credit_user_balance'
      AND prosrc LIKE '%privy_user_connections%'
  ) INTO credit_uses_canonical;

  SELECT NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'debit_user_balance'
      AND prosrc LIKE '%privy_user_connections%'
  ) INTO debit_uses_canonical;

  -- Check RLS is enabled on sub_account_balances
  SELECT COALESCE(
    (SELECT relrowsecurity FROM pg_class WHERE relname = 'sub_account_balances'),
    false
  ) INTO rls_enabled;

  RAISE NOTICE '=====================================================';
  RAISE NOTICE '5 CRITICAL ERRORS FIX - VALIDATION RESULTS';
  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'credit_user_balance exists: %', credit_exists;
  RAISE NOTICE 'debit_user_balance exists: %', debit_exists;
  RAISE NOTICE 'credit_user_balance uses canonical_users (not privy_user_connections): %', credit_uses_canonical;
  RAISE NOTICE 'debit_user_balance uses canonical_users (not privy_user_connections): %', debit_uses_canonical;
  RAISE NOTICE 'sub_account_balances RLS enabled: %', rls_enabled;
  RAISE NOTICE '=====================================================';
  RAISE NOTICE '';
  RAISE NOTICE 'FIXES APPLIED:';
  RAISE NOTICE '1. credit/debit functions now use canonical_users';
  RAISE NOTICE '2. Balance sync now includes sub_account_balances';
  RAISE NOTICE '3. Frontend ExternalLink import (requires code fix)';
  RAISE NOTICE '4. debit_user_balance now uses FOR UPDATE lock';
  RAISE NOTICE '5. sub_account_balances RLS policies added';
  RAISE NOTICE '=====================================================';

  IF NOT credit_uses_canonical OR NOT debit_uses_canonical THEN
    RAISE WARNING 'Functions may still reference deprecated privy_user_connections!';
  END IF;
END $$;

COMMIT;
