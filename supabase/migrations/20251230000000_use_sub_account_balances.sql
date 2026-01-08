-- =====================================================
-- UPDATE BALANCE SYSTEM TO USE sub_account_balances TABLE
-- =====================================================
-- This migration updates the get_user_balance RPC and related functions
-- to read from sub_account_balances as the single source of truth.
--
-- The sub_account_balances table has:
-- - available_balance: Funds available for spending (top-ups go here)
-- - pending_balance: Funds temporarily held (purchases in progress)
-- - canonical_user_id: prize:pid: format identifier
-- - user_id: Legacy privy DID
--
-- Users are identified by either:
-- - canonical_user_id (prize:pid:0x... for wallet or prize:pid:did:... for privy)
-- - user_id (legacy privy DID)
-- =====================================================

BEGIN;

-- =====================================================
-- PART 1: CREATE INDEXES FOR PERFORMANCE
-- =====================================================

-- Add indexes on sub_account_balances for efficient lookups
CREATE INDEX IF NOT EXISTS idx_sub_account_balances_canonical_user_id
  ON public.sub_account_balances(canonical_user_id);

CREATE INDEX IF NOT EXISTS idx_sub_account_balances_user_id
  ON public.sub_account_balances(user_id);

CREATE INDEX IF NOT EXISTS idx_sub_account_balances_privy_user_id
  ON public.sub_account_balances(privy_user_id);

CREATE INDEX IF NOT EXISTS idx_sub_account_balances_currency
  ON public.sub_account_balances(currency);

-- Composite index for common lookup pattern
CREATE INDEX IF NOT EXISTS idx_sub_account_balances_canonical_currency
  ON public.sub_account_balances(canonical_user_id, currency);

-- =====================================================
-- PART 2: UPDATE get_user_balance RPC FUNCTION
-- =====================================================
-- This is the primary function used by all frontend and backend
-- components to fetch user balance. Updated to read from
-- sub_account_balances.available_balance as the source of truth.

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
  -- e.g., 'prize:pid:0x1234...' -> '0x1234...'
  IF p_canonical_user_id LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(p_canonical_user_id FROM 11));
  ELSIF p_canonical_user_id LIKE '0x%' AND LENGTH(p_canonical_user_id) = 42 THEN
    search_wallet := LOWER(p_canonical_user_id);
  ELSE
    search_wallet := NULL;
  END IF;

  -- Primary: Read available_balance from sub_account_balances
  -- Only look at USD currency rows (the default for balance payments)
  SELECT COALESCE(available_balance, 0)::NUMERIC INTO user_balance
  FROM public.sub_account_balances
  WHERE currency = 'USD'
    AND (
      -- Match by canonical_user_id (exact)
      canonical_user_id = p_canonical_user_id
      -- Case-insensitive canonical match
      OR canonical_user_id = LOWER(p_canonical_user_id)
      -- Match by wallet address extracted from prize:pid:
      OR (search_wallet IS NOT NULL AND canonical_user_id = 'prize:pid:' || search_wallet)
      -- Match by user_id (legacy privy DID format)
      OR user_id = p_canonical_user_id
      -- Match by privy_user_id
      OR privy_user_id = p_canonical_user_id
    )
  ORDER BY
    -- Prioritize exact canonical_user_id match
    CASE
      WHEN canonical_user_id = p_canonical_user_id THEN 0
      WHEN canonical_user_id = LOWER(p_canonical_user_id) THEN 1
      WHEN search_wallet IS NOT NULL AND canonical_user_id = 'prize:pid:' || search_wallet THEN 2
      ELSE 3
    END,
    -- If multiple matches, prefer the one with the highest balance
    available_balance DESC NULLS LAST
  LIMIT 1;

  -- Fallback: If not found in sub_account_balances, check privy_user_connections
  -- This handles legacy users who may not have a sub_account_balances record yet
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

COMMENT ON FUNCTION get_user_balance(TEXT) IS 'Get user available balance by canonical_user_id. Reads from sub_account_balances.available_balance as primary source.';

-- =====================================================
-- PART 3: CREATE get_sub_account_balance FUNCTION
-- =====================================================
-- Returns full balance info including pending

DROP FUNCTION IF EXISTS get_sub_account_balance(TEXT, TEXT);

CREATE OR REPLACE FUNCTION get_sub_account_balance(
  p_canonical_user_id TEXT,
  p_currency TEXT DEFAULT 'USD'
)
RETURNS TABLE(
  available_balance NUMERIC,
  pending_balance NUMERIC,
  total_balance NUMERIC,
  currency TEXT,
  last_updated TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  search_wallet TEXT;
BEGIN
  -- Handle null or empty identifier
  IF p_canonical_user_id IS NULL OR p_canonical_user_id = '' THEN
    RETURN QUERY SELECT 0::NUMERIC, 0::NUMERIC, 0::NUMERIC, p_currency, NOW();
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

  RETURN QUERY
  SELECT
    COALESCE(sab.available_balance, 0)::NUMERIC,
    COALESCE(sab.pending_balance, 0)::NUMERIC,
    (COALESCE(sab.available_balance, 0) + COALESCE(sab.pending_balance, 0))::NUMERIC,
    sab.currency,
    sab.last_updated
  FROM public.sub_account_balances sab
  WHERE sab.currency = p_currency
    AND (
      sab.canonical_user_id = p_canonical_user_id
      OR sab.canonical_user_id = LOWER(p_canonical_user_id)
      OR (search_wallet IS NOT NULL AND sab.canonical_user_id = 'prize:pid:' || search_wallet)
      OR sab.user_id = p_canonical_user_id
      OR sab.privy_user_id = p_canonical_user_id
    )
  ORDER BY
    CASE
      WHEN sab.canonical_user_id = p_canonical_user_id THEN 0
      WHEN sab.canonical_user_id = LOWER(p_canonical_user_id) THEN 1
      ELSE 2
    END
  LIMIT 1;

  -- If no rows returned, return zeros
  IF NOT FOUND THEN
    RETURN QUERY SELECT 0::NUMERIC, 0::NUMERIC, 0::NUMERIC, p_currency, NOW();
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_sub_account_balance(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_sub_account_balance(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_sub_account_balance(TEXT, TEXT) TO service_role;

COMMENT ON FUNCTION get_sub_account_balance(TEXT, TEXT) IS 'Get full sub-account balance info including available and pending balances.';

-- =====================================================
-- PART 4: CREATE credit_sub_account_balance FUNCTION
-- =====================================================
-- Atomically credits available_balance for top-ups

DROP FUNCTION IF EXISTS credit_sub_account_balance(TEXT, NUMERIC, TEXT);

CREATE OR REPLACE FUNCTION credit_sub_account_balance(
  p_canonical_user_id TEXT,
  p_amount NUMERIC,
  p_currency TEXT DEFAULT 'USD'
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
    );

    RETURN QUERY SELECT TRUE, v_previous_balance, v_new_balance, NULL::TEXT;
    RETURN;
  END IF;

  -- Calculate new balance
  v_new_balance := ROUND(v_previous_balance + p_amount, 2);

  -- Update the record
  UPDATE public.sub_account_balances
  SET
    available_balance = v_new_balance,
    last_updated = NOW()
  WHERE id = v_record_id;

  RETURN QUERY SELECT TRUE, v_previous_balance, v_new_balance, NULL::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION credit_sub_account_balance(TEXT, NUMERIC, TEXT) TO service_role;

COMMENT ON FUNCTION credit_sub_account_balance(TEXT, NUMERIC, TEXT) IS 'Atomically credit available_balance in sub_account_balances for top-ups.';

-- =====================================================
-- PART 5: CREATE debit_sub_account_balance FUNCTION
-- =====================================================
-- Atomically debits available_balance for purchases

DROP FUNCTION IF EXISTS debit_sub_account_balance(TEXT, NUMERIC, TEXT);

CREATE OR REPLACE FUNCTION debit_sub_account_balance(
  p_canonical_user_id TEXT,
  p_amount NUMERIC,
  p_currency TEXT DEFAULT 'USD'
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

  RETURN QUERY SELECT TRUE, v_previous_balance, v_new_balance, NULL::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION debit_sub_account_balance(TEXT, NUMERIC, TEXT) TO service_role;

COMMENT ON FUNCTION debit_sub_account_balance(TEXT, NUMERIC, TEXT) IS 'Atomically debit available_balance in sub_account_balances for purchases.';

-- =====================================================
-- PART 6: VALIDATION
-- =====================================================

DO $$
DECLARE
  sub_account_count INTEGER;
  usd_balance_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO sub_account_count FROM public.sub_account_balances;
  SELECT COUNT(*) INTO usd_balance_count FROM public.sub_account_balances WHERE currency = 'USD';

  RAISE NOTICE '=============================================';
  RAISE NOTICE 'SUB_ACCOUNT_BALANCES MIGRATION COMPLETE';
  RAISE NOTICE '=============================================';
  RAISE NOTICE 'Total sub_account_balances rows: %', sub_account_count;
  RAISE NOTICE 'USD balance rows: %', usd_balance_count;
  RAISE NOTICE '=============================================';
  RAISE NOTICE 'Functions created:';
  RAISE NOTICE '  - get_user_balance(TEXT) - Updated to read from sub_account_balances';
  RAISE NOTICE '  - get_sub_account_balance(TEXT, TEXT) - Full balance info';
  RAISE NOTICE '  - credit_sub_account_balance(TEXT, NUMERIC, TEXT) - Top-ups';
  RAISE NOTICE '  - debit_sub_account_balance(TEXT, NUMERIC, TEXT) - Purchases';
  RAISE NOTICE '=============================================';
END $$;

COMMIT;
