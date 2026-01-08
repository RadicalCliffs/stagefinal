-- =====================================================
-- BACKFILL WALLET BALANCES & ADD RLS FOR CLIENT ACCESS
-- =====================================================
-- This migration performs two critical operations:
--
-- 1. BACKFILL: Reconcile usdc_balance in privy_user_connections
--    from completed user_transactions (finished top-ups)
--
-- 2. RLS: Add Row Level Security policies for secure client-side
--    balance reads using canonical_user_id claim
--
-- SAFETY:
-- - All operations are idempotent
-- - No destructive changes to existing data
-- - Backfill only ADDS missing balances, never reduces
-- - Uses transactions for atomicity
-- =====================================================

BEGIN;

-- =====================================================
-- PART 1: BACKFILL WALLET BALANCES
-- =====================================================

-- Step 1.1: Create temporary table to compute expected balances
-- from completed user_transactions (top-ups only, not purchases)
CREATE TEMP TABLE expected_balances AS
WITH transaction_credits AS (
  SELECT
    -- Resolve to privy_user_connections.id via multiple lookups
    COALESCE(
      puc_by_canonical.id,
      puc_by_wallet.id,
      puc_by_privy.id
    ) AS user_uuid,
    ut.amount AS credit_amount,
    ut.id AS transaction_id,
    ut.completed_at
  FROM user_transactions ut
  -- Join by canonical_user_id (prize:pid: format)
  LEFT JOIN privy_user_connections puc_by_canonical
    ON puc_by_canonical.canonical_user_id = ut.user_id
    OR (ut.user_id LIKE 'prize:pid:0x%' AND LOWER(puc_by_canonical.wallet_address) = LOWER(SUBSTRING(ut.user_id FROM 11)))
  -- Join by wallet_address
  LEFT JOIN privy_user_connections puc_by_wallet
    ON LOWER(puc_by_wallet.wallet_address) = LOWER(ut.wallet_address)
    AND puc_by_canonical.id IS NULL
  -- Join by privy_user_id (legacy)
  LEFT JOIN privy_user_connections puc_by_privy
    ON puc_by_privy.privy_user_id = ut.user_privy_id
    AND puc_by_canonical.id IS NULL
    AND puc_by_wallet.id IS NULL
  WHERE ut.status = 'finished'
    AND ut.competition_id IS NULL  -- Top-up transactions have no competition_id
    AND ut.amount > 0
),
aggregated AS (
  SELECT
    user_uuid,
    SUM(credit_amount) AS total_credits
  FROM transaction_credits
  WHERE user_uuid IS NOT NULL
  GROUP BY user_uuid
)
SELECT * FROM aggregated;

-- Step 1.2: Log pre-backfill state
DO $$
DECLARE
  users_with_zero_balance INTEGER;
  users_needing_backfill INTEGER;
BEGIN
  SELECT COUNT(*) INTO users_with_zero_balance
  FROM privy_user_connections
  WHERE COALESCE(usdc_balance, 0) = 0;

  SELECT COUNT(*) INTO users_needing_backfill
  FROM expected_balances eb
  JOIN privy_user_connections puc ON puc.id = eb.user_uuid
  WHERE COALESCE(puc.usdc_balance, 0) < eb.total_credits;

  RAISE NOTICE '[BACKFILL] Users with zero balance: %', users_with_zero_balance;
  RAISE NOTICE '[BACKFILL] Users needing backfill: %', users_needing_backfill;
END $$;

-- Step 1.3: Update usdc_balance where current balance is less than expected
-- (This ensures we never reduce existing balances)
UPDATE privy_user_connections puc
SET
  usdc_balance = eb.total_credits,
  updated_at = NOW()
FROM expected_balances eb
WHERE puc.id = eb.user_uuid
  AND COALESCE(puc.usdc_balance, 0) < eb.total_credits;

-- Step 1.4: Log post-backfill results
DO $$
DECLARE
  rows_updated INTEGER;
BEGIN
  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RAISE NOTICE '[BACKFILL] Users updated: %', rows_updated;
END $$;

-- Clean up temp table
DROP TABLE IF EXISTS expected_balances;

-- =====================================================
-- PART 2: CREATE WALLET_BALANCES TABLE (MATERIALIZED)
-- =====================================================
-- Convert from VIEW to TABLE for proper RLS support
-- The view doesn't support RLS policies directly

-- Step 2.1: Drop existing view
DROP VIEW IF EXISTS public.wallet_balances;

-- Step 2.2: Create wallet_balances as a proper table
CREATE TABLE IF NOT EXISTS public.wallet_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,  -- References privy_user_connections.id
  canonical_user_id TEXT,
  wallet_address TEXT,
  base_wallet_address TEXT,
  balance NUMERIC NOT NULL DEFAULT 0,
  has_used_new_user_bonus BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Step 2.3: Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_wallet_balances_user_id ON public.wallet_balances(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_balances_canonical_user_id ON public.wallet_balances(canonical_user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_balances_wallet_address ON public.wallet_balances(LOWER(wallet_address));
CREATE INDEX IF NOT EXISTS idx_wallet_balances_updated_at ON public.wallet_balances(updated_at DESC);

-- Step 2.4: Backfill wallet_balances table from privy_user_connections
INSERT INTO public.wallet_balances (
  user_id,
  canonical_user_id,
  wallet_address,
  base_wallet_address,
  balance,
  has_used_new_user_bonus,
  updated_at,
  created_at
)
SELECT
  id AS user_id,
  canonical_user_id,
  wallet_address,
  base_wallet_address,
  COALESCE(usdc_balance, 0) AS balance,
  COALESCE(has_used_new_user_bonus, FALSE),
  COALESCE(updated_at, NOW()),
  COALESCE(created_at, NOW())
FROM privy_user_connections
WHERE canonical_user_id IS NOT NULL
ON CONFLICT (user_id) DO UPDATE SET
  canonical_user_id = EXCLUDED.canonical_user_id,
  wallet_address = EXCLUDED.wallet_address,
  base_wallet_address = EXCLUDED.base_wallet_address,
  balance = EXCLUDED.balance,
  has_used_new_user_bonus = EXCLUDED.has_used_new_user_bonus,
  updated_at = NOW();

-- Step 2.5: Add comment for documentation
COMMENT ON TABLE public.wallet_balances IS 'Materialized wallet balance summary for RLS-enabled client reads. Sync with privy_user_connections.usdc_balance via trigger.';

-- =====================================================
-- PART 3: ENABLE ROW LEVEL SECURITY
-- =====================================================

-- Step 3.1: Enable RLS on wallet_balances
ALTER TABLE public.wallet_balances ENABLE ROW LEVEL SECURITY;

-- Step 3.2: Create RLS policies for client access

-- Policy: Service role has full access (for backend operations)
DROP POLICY IF EXISTS "wallet_balances_service_role_all" ON public.wallet_balances;
CREATE POLICY "wallet_balances_service_role_all"
  ON public.wallet_balances
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Policy: Authenticated users can read their own balance via canonical_user_id claim
-- This uses the JWT claim to identify the user
DROP POLICY IF EXISTS "wallet_balances_select_own_by_canonical" ON public.wallet_balances;
CREATE POLICY "wallet_balances_select_own_by_canonical"
  ON public.wallet_balances
  FOR SELECT
  TO authenticated
  USING (
    -- Match by canonical_user_id from JWT claim
    canonical_user_id = COALESCE(
      current_setting('request.jwt.claims', true)::json->>'canonical_user_id',
      current_setting('request.jwt.claims', true)::json->>'sub'
    )
    -- Or match by wallet address (case-insensitive)
    OR LOWER(wallet_address) = LOWER(
      COALESCE(
        current_setting('request.jwt.claims', true)::json->>'wallet_address',
        ''
      )
    )
    -- Or match by user_id (UUID from auth.uid())
    OR user_id = (SELECT auth.uid())
  );

-- Policy: Anon can read their own balance if they provide a valid identifier
-- This is more restrictive - only allows reading via wallet address
DROP POLICY IF EXISTS "wallet_balances_select_own_anon" ON public.wallet_balances;
CREATE POLICY "wallet_balances_select_own_anon"
  ON public.wallet_balances
  FOR SELECT
  TO anon
  USING (
    -- Anon can only read by exact canonical_user_id match from headers
    canonical_user_id = COALESCE(
      current_setting('request.jwt.claims', true)::json->>'canonical_user_id',
      ''
    )
  );

-- =====================================================
-- PART 4: CREATE SYNC TRIGGER
-- =====================================================
-- Keep wallet_balances in sync with privy_user_connections

-- Step 4.1: Create sync function
CREATE OR REPLACE FUNCTION sync_wallet_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
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
    COALESCE(NEW.usdc_balance, 0),
    COALESCE(NEW.has_used_new_user_bonus, FALSE),
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
END;
$$;

-- Step 4.2: Create trigger on privy_user_connections
DROP TRIGGER IF EXISTS trigger_sync_wallet_balance ON privy_user_connections;
CREATE TRIGGER trigger_sync_wallet_balance
  AFTER INSERT OR UPDATE OF usdc_balance, canonical_user_id, wallet_address, base_wallet_address, has_used_new_user_bonus
  ON privy_user_connections
  FOR EACH ROW
  EXECUTE FUNCTION sync_wallet_balance();

-- =====================================================
-- PART 5: UPDATE GET_USER_BALANCE RPC
-- =====================================================
-- Update to optionally read from wallet_balances table for better RLS support

DROP FUNCTION IF EXISTS get_user_balance(TEXT);

CREATE OR REPLACE FUNCTION get_user_balance(p_canonical_user_id TEXT)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_balance NUMERIC;
  search_wallet TEXT;
BEGIN
  -- Handle null or empty identifier
  IF p_canonical_user_id IS NULL OR p_canonical_user_id = '' THEN
    RETURN 0;
  END IF;

  -- Extract wallet address from prize:pid: format if present
  IF p_canonical_user_id LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(p_canonical_user_id FROM 11));
  ELSIF p_canonical_user_id LIKE '0x%' AND LENGTH(p_canonical_user_id) = 42 THEN
    search_wallet := LOWER(p_canonical_user_id);
  ELSE
    search_wallet := NULL;
  END IF;

  -- Primary: Read from wallet_balances table (RLS-enabled)
  SELECT balance INTO user_balance
  FROM public.wallet_balances
  WHERE
    canonical_user_id = p_canonical_user_id
    OR canonical_user_id = LOWER(p_canonical_user_id)
    OR (search_wallet IS NOT NULL AND LOWER(wallet_address) = search_wallet)
    OR (search_wallet IS NOT NULL AND LOWER(base_wallet_address) = search_wallet)
  ORDER BY
    CASE WHEN canonical_user_id = p_canonical_user_id THEN 0
         WHEN canonical_user_id = LOWER(p_canonical_user_id) THEN 1
         ELSE 2 END
  LIMIT 1;

  -- Fallback: Read from privy_user_connections if not in wallet_balances
  IF user_balance IS NULL THEN
    SELECT COALESCE(usdc_balance, 0) INTO user_balance
    FROM privy_user_connections
    WHERE
      canonical_user_id = p_canonical_user_id
      OR canonical_user_id = LOWER(p_canonical_user_id)
      OR (search_wallet IS NOT NULL AND LOWER(wallet_address) = search_wallet)
      OR (search_wallet IS NOT NULL AND LOWER(base_wallet_address) = search_wallet)
      OR LOWER(wallet_address) = LOWER(p_canonical_user_id)
      OR privy_user_id = p_canonical_user_id
    ORDER BY
      CASE WHEN canonical_user_id = p_canonical_user_id THEN 0
           WHEN canonical_user_id = LOWER(p_canonical_user_id) THEN 1
           ELSE 2 END
    LIMIT 1;
  END IF;

  RETURN COALESCE(user_balance, 0);
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_user_balance(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_balance(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_user_balance(TEXT) TO service_role;

-- Add comment for documentation
COMMENT ON FUNCTION get_user_balance(TEXT) IS 'Get user balance by canonical_user_id. Reads from wallet_balances table with RLS, falls back to privy_user_connections.';

-- =====================================================
-- PART 6: GRANT PERMISSIONS
-- =====================================================

-- Grant table permissions
GRANT ALL ON public.wallet_balances TO service_role;
GRANT SELECT ON public.wallet_balances TO authenticated;
GRANT SELECT ON public.wallet_balances TO anon;

-- =====================================================
-- PART 7: VALIDATION
-- =====================================================

DO $$
DECLARE
  wallet_balances_count INTEGER;
  privy_users_count INTEGER;
  synced_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO wallet_balances_count FROM public.wallet_balances;
  SELECT COUNT(*) INTO privy_users_count FROM privy_user_connections WHERE canonical_user_id IS NOT NULL;

  SELECT COUNT(*) INTO synced_count
  FROM public.wallet_balances wb
  JOIN privy_user_connections puc ON puc.id = wb.user_id
  WHERE wb.balance = COALESCE(puc.usdc_balance, 0);

  RAISE NOTICE '=============================================';
  RAISE NOTICE 'WALLET BALANCES BACKFILL & RLS COMPLETE';
  RAISE NOTICE '=============================================';
  RAISE NOTICE 'wallet_balances rows: %', wallet_balances_count;
  RAISE NOTICE 'privy_user_connections with canonical_id: %', privy_users_count;
  RAISE NOTICE 'Synced balance count: %', synced_count;
  RAISE NOTICE '=============================================';
  RAISE NOTICE 'RLS Policies Created:';
  RAISE NOTICE '  - wallet_balances_service_role_all (full access)';
  RAISE NOTICE '  - wallet_balances_select_own_by_canonical (authenticated)';
  RAISE NOTICE '  - wallet_balances_select_own_anon (anon with claim)';
  RAISE NOTICE '=============================================';
END $$;

COMMIT;
