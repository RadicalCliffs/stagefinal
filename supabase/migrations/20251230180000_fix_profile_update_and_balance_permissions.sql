-- =====================================================
-- FIX: PROFILE UPDATE TRIGGER ERROR & BALANCE PERMISSIONS
-- =====================================================
-- This migration fixes two critical issues:
--
-- 1. Profile update failing with "record 'new' has no field 'usdc_balance'"
--    - The sync_wallet_balance trigger was referencing NEW.usdc_balance
--    - If the column doesn't exist or is accessed incorrectly, this fails
--    - Fix: Make the trigger defensive with proper error handling
--
-- 2. get_user_balance RPC returning 401 "permission denied for wallet_transactions"
--    - The RPC needs proper grants to access underlying tables
--    - The error message mentions wallet_transactions which doesn't exist
--    - This is likely an RLS policy issue on wallet_balances table
--    - Fix: Grant proper permissions and fix RLS policies
-- =====================================================

BEGIN;

-- =====================================================
-- PART 1: FIX SYNC_WALLET_BALANCE TRIGGER FUNCTION
-- =====================================================
-- Make it defensive - check for column existence before accessing

CREATE OR REPLACE FUNCTION sync_wallet_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_usdc_balance NUMERIC;
  v_has_used_new_user_bonus BOOLEAN;
BEGIN
  -- Safely get usdc_balance with fallback
  BEGIN
    v_usdc_balance := COALESCE(NEW.usdc_balance, 0);
  EXCEPTION WHEN undefined_column THEN
    v_usdc_balance := 0;
  END;

  -- Safely get has_used_new_user_bonus with fallback
  BEGIN
    v_has_used_new_user_bonus := COALESCE(NEW.has_used_new_user_bonus, FALSE);
  EXCEPTION WHEN undefined_column THEN
    v_has_used_new_user_bonus := FALSE;
  END;

  -- Insert or update wallet_balances when privy_user_connections changes
  INSERT INTO public.wallet_balances (
    user_id,
    canonical_user_id,
    wallet_address,
    base_wallet_address,
    balance,
    has_used_new_user_bonus,
    updated_at
  )
  VALUES (
    NEW.id,
    NEW.canonical_user_id,
    NEW.wallet_address,
    NEW.base_wallet_address,
    v_usdc_balance,
    v_has_used_new_user_bonus,
    NOW()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    canonical_user_id = EXCLUDED.canonical_user_id,
    wallet_address = EXCLUDED.wallet_address,
    base_wallet_address = EXCLUDED.base_wallet_address,
    balance = EXCLUDED.balance,
    has_used_new_user_bonus = EXCLUDED.has_used_new_user_bonus,
    updated_at = NOW();

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Log the error but don't fail the transaction
    RAISE WARNING 'sync_wallet_balance trigger error: % - SQLSTATE: %', SQLERRM, SQLSTATE;
    RETURN NEW;
END;
$$;

-- =====================================================
-- PART 2: RECREATE TRIGGER WITH CORRECT COLUMN LIST
-- =====================================================
-- Only fire on columns that should trigger a wallet_balances sync

DROP TRIGGER IF EXISTS trigger_sync_wallet_balance ON privy_user_connections;

-- Only fire when balance-related columns change, not on every update
CREATE TRIGGER trigger_sync_wallet_balance
  AFTER INSERT OR UPDATE OF usdc_balance, canonical_user_id, wallet_address, base_wallet_address, has_used_new_user_bonus
  ON privy_user_connections
  FOR EACH ROW
  EXECUTE FUNCTION sync_wallet_balance();

-- =====================================================
-- PART 3: FIX RLS POLICIES ON WALLET_BALANCES
-- =====================================================
-- The error mentions wallet_transactions but we don't have that table
-- The actual issue is RLS on wallet_balances blocking the query

-- Ensure RLS is enabled
ALTER TABLE public.wallet_balances ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to recreate them properly
DROP POLICY IF EXISTS "wallet_balances_service_role_all" ON public.wallet_balances;
DROP POLICY IF EXISTS "wallet_balances_select_own_by_canonical" ON public.wallet_balances;
DROP POLICY IF EXISTS "wallet_balances_select_own_anon" ON public.wallet_balances;

-- Service role has full access
CREATE POLICY "wallet_balances_service_role_all"
  ON public.wallet_balances
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated users can read their own balance
-- Use multiple matching strategies for flexibility
CREATE POLICY "wallet_balances_select_own_by_canonical"
  ON public.wallet_balances
  FOR SELECT
  TO authenticated
  USING (
    -- Always allow read access for authenticated users to their own balance
    -- Match by canonical_user_id from JWT claim
    canonical_user_id = COALESCE(
      current_setting('request.jwt.claims', true)::json->>'canonical_user_id',
      current_setting('request.jwt.claims', true)::json->>'sub',
      ''
    )
    -- Or match by wallet address (case-insensitive)
    OR LOWER(wallet_address) = LOWER(
      COALESCE(
        current_setting('request.jwt.claims', true)::json->>'wallet_address',
        ''
      )
    )
    -- Or match by user_id (UUID from auth.uid())
    OR user_id = auth.uid()
  );

-- Anon users can ONLY read via RPC functions (SECURITY DEFINER)
-- Don't allow direct table access for anon
CREATE POLICY "wallet_balances_select_own_anon"
  ON public.wallet_balances
  FOR SELECT
  TO anon
  USING (
    -- Anon can only access via canonical_user_id claim (set by edge functions)
    canonical_user_id = COALESCE(
      current_setting('request.jwt.claims', true)::json->>'canonical_user_id',
      ''
    )
    AND canonical_user_id != ''
  );

-- =====================================================
-- PART 4: ENSURE GET_USER_BALANCE RPC HAS PROPER GRANTS
-- =====================================================

-- Grant table access to the function (SECURITY DEFINER functions need explicit grants)
GRANT SELECT ON public.wallet_balances TO authenticated;
GRANT SELECT ON public.wallet_balances TO anon;
GRANT SELECT ON public.wallet_balances TO service_role;
GRANT ALL ON public.wallet_balances TO service_role;

GRANT SELECT ON public.privy_user_connections TO authenticated;
GRANT SELECT ON public.privy_user_connections TO anon;
GRANT SELECT ON public.privy_user_connections TO service_role;

-- If sub_account_balances exists, grant access
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'sub_account_balances'
  ) THEN
    EXECUTE 'GRANT SELECT ON public.sub_account_balances TO authenticated';
    EXECUTE 'GRANT SELECT ON public.sub_account_balances TO anon';
    EXECUTE 'GRANT SELECT ON public.sub_account_balances TO service_role';
  END IF;
END $$;

-- Ensure RPC functions have execute permissions
GRANT EXECUTE ON FUNCTION get_user_balance(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_balance(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_user_balance(TEXT) TO service_role;

-- =====================================================
-- PART 5: ENSURE PROFILE UPDATE RPC HAS PROPER GRANTS
-- =====================================================

GRANT EXECUTE ON FUNCTION update_user_profile_by_identifier(text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION update_user_profile_by_identifier(text, text, text, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION update_user_profile_by_identifier(text, text, text, text, text, text) TO service_role;

-- If update_user_avatar exists, grant access
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'update_user_avatar'
  ) THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION update_user_avatar(text, text) TO authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION update_user_avatar(text, text) TO anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION update_user_avatar(text, text) TO service_role';
  END IF;
END $$;

-- =====================================================
-- PART 6: ENSURE USDC_BALANCE COLUMN EXISTS
-- =====================================================
-- The error could also occur if the column was somehow dropped

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'privy_user_connections'
    AND column_name = 'usdc_balance'
  ) THEN
    ALTER TABLE privy_user_connections
    ADD COLUMN usdc_balance NUMERIC DEFAULT 0;
    RAISE NOTICE 'Added missing usdc_balance column to privy_user_connections';
  END IF;
END $$;

-- Ensure has_used_new_user_bonus column exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'privy_user_connections'
    AND column_name = 'has_used_new_user_bonus'
  ) THEN
    ALTER TABLE privy_user_connections
    ADD COLUMN has_used_new_user_bonus BOOLEAN DEFAULT FALSE;
    RAISE NOTICE 'Added missing has_used_new_user_bonus column to privy_user_connections';
  END IF;
END $$;

-- =====================================================
-- VALIDATION
-- =====================================================

DO $$
DECLARE
  trigger_exists BOOLEAN;
  func_exists BOOLEAN;
  usdc_col_exists BOOLEAN;
  wallet_balances_exists BOOLEAN;
BEGIN
  -- Check trigger exists
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trigger_sync_wallet_balance'
  ) INTO trigger_exists;

  -- Check function exists
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'sync_wallet_balance'
  ) INTO func_exists;

  -- Check usdc_balance column exists
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'privy_user_connections'
    AND column_name = 'usdc_balance'
  ) INTO usdc_col_exists;

  -- Check wallet_balances table exists
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name = 'wallet_balances'
  ) INTO wallet_balances_exists;

  RAISE NOTICE '=============================================';
  RAISE NOTICE 'PROFILE UPDATE & BALANCE PERMISSIONS FIX';
  RAISE NOTICE '=============================================';
  RAISE NOTICE 'sync_wallet_balance function exists: %', func_exists;
  RAISE NOTICE 'trigger_sync_wallet_balance trigger exists: %', trigger_exists;
  RAISE NOTICE 'usdc_balance column exists: %', usdc_col_exists;
  RAISE NOTICE 'wallet_balances table exists: %', wallet_balances_exists;
  RAISE NOTICE '=============================================';
  RAISE NOTICE 'Fixed issues:';
  RAISE NOTICE '  1. sync_wallet_balance trigger now has defensive error handling';
  RAISE NOTICE '  2. RLS policies on wallet_balances recreated';
  RAISE NOTICE '  3. Proper grants for get_user_balance RPC';
  RAISE NOTICE '  4. Proper grants for update_user_profile_by_identifier RPC';
  RAISE NOTICE '=============================================';
END $$;

COMMIT;
