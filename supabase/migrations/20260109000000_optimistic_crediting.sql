-- =====================================================
-- OPTIMISTIC CREDITING SYSTEM FOR ROBUST PAYMENTS
-- =====================================================
-- This migration adds support for optimistic crediting where:
-- 1. Top-ups and entries are immediately shown as "pending" to users
-- 2. Webhook confirms and moves pending -> available
-- 3. Reconciliation function catches any missed credits
--
-- Key Tables:
-- - pending_topups: Tracks pending top-up transactions
-- - sub_account_balances: Added pending_balance column support
--
-- Key Functions:
-- - add_pending_balance: Add to pending_balance for optimistic credit
-- - confirm_pending_balance: Move pending to available on payment confirm
-- - reconcile_unconfirmed_payments: Catch-all for missed credits
-- =====================================================

BEGIN;

-- =====================================================
-- PART 1: CREATE pending_topups TABLE
-- =====================================================
-- Mirrors pending_tickets structure for top-ups

CREATE TABLE IF NOT EXISTS public.pending_topups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  canonical_user_id TEXT NOT NULL,
  amount NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'expired', 'failed')),
  session_id TEXT,
  transaction_hash TEXT,
  payment_provider TEXT DEFAULT 'coinbase_commerce',
  expires_at TIMESTAMPTZ NOT NULL,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_pending_topups_session_id ON public.pending_topups(session_id);
CREATE INDEX IF NOT EXISTS idx_pending_topups_user_id ON public.pending_topups(user_id);
CREATE INDEX IF NOT EXISTS idx_pending_topups_canonical_user_id ON public.pending_topups(canonical_user_id);
CREATE INDEX IF NOT EXISTS idx_pending_topups_status ON public.pending_topups(status);
CREATE INDEX IF NOT EXISTS idx_pending_topups_expires_at ON public.pending_topups(expires_at) WHERE status = 'pending';

-- Enable RLS but allow service role full access
ALTER TABLE public.pending_topups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to pending_topups"
  ON public.pending_topups
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Allow authenticated users to read their own pending topups
CREATE POLICY "Users can view own pending_topups"
  ON public.pending_topups
  FOR SELECT
  TO authenticated
  USING (
    canonical_user_id = auth.jwt()->>'sub'
    OR user_id = auth.jwt()->>'sub'
  );

-- =====================================================
-- PART 2: ADD pending_balance SUPPORT
-- =====================================================
-- Ensure pending_balance column exists in sub_account_balances

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'sub_account_balances'
    AND column_name = 'pending_balance'
  ) THEN
    ALTER TABLE public.sub_account_balances
    ADD COLUMN pending_balance NUMERIC(12, 2) DEFAULT 0;
  END IF;
END $$;

-- =====================================================
-- PART 3: ADD add_pending_balance FUNCTION
-- =====================================================
-- Adds amount to pending_balance for optimistic display

DROP FUNCTION IF EXISTS add_pending_balance(TEXT, NUMERIC, TEXT);

CREATE OR REPLACE FUNCTION add_pending_balance(
  p_canonical_user_id TEXT,
  p_amount NUMERIC,
  p_currency TEXT DEFAULT 'USD'
)
RETURNS TABLE(
  success BOOLEAN,
  new_pending_balance NUMERIC,
  error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record_id UUID;
  v_current_pending NUMERIC;
  v_new_pending NUMERIC;
  search_wallet TEXT;
BEGIN
  -- Validate amount
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, 0::NUMERIC, 'Amount must be positive'::TEXT;
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

  -- Find or create the record
  SELECT id, COALESCE(pending_balance, 0)
  INTO v_record_id, v_current_pending
  FROM public.sub_account_balances
  WHERE currency = p_currency
    AND (
      canonical_user_id = p_canonical_user_id
      OR canonical_user_id = LOWER(p_canonical_user_id)
      OR (search_wallet IS NOT NULL AND canonical_user_id = 'prize:pid:' || search_wallet)
      OR user_id = p_canonical_user_id
    )
  LIMIT 1
  FOR UPDATE;

  v_new_pending := COALESCE(v_current_pending, 0) + p_amount;

  IF v_record_id IS NULL THEN
    -- Create new record with pending balance
    INSERT INTO public.sub_account_balances (
      canonical_user_id,
      user_id,
      currency,
      available_balance,
      pending_balance,
      last_updated
    ) VALUES (
      p_canonical_user_id,
      p_canonical_user_id,
      p_currency,
      0,
      v_new_pending,
      NOW()
    );
  ELSE
    -- Update existing record
    UPDATE public.sub_account_balances
    SET
      pending_balance = v_new_pending,
      last_updated = NOW()
    WHERE id = v_record_id;
  END IF;

  RETURN QUERY SELECT TRUE, v_new_pending, NULL::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION add_pending_balance(TEXT, NUMERIC, TEXT) TO service_role;

-- =====================================================
-- PART 4: ADD confirm_pending_balance FUNCTION
-- =====================================================
-- Moves pending_balance to available_balance on payment confirmation
-- Called by webhook after successful payment

DROP FUNCTION IF EXISTS confirm_pending_balance(TEXT, NUMERIC, TEXT);

CREATE OR REPLACE FUNCTION confirm_pending_balance(
  p_canonical_user_id TEXT,
  p_amount NUMERIC,
  p_currency TEXT DEFAULT 'USD'
)
RETURNS TABLE(
  success BOOLEAN,
  new_available_balance NUMERIC,
  new_pending_balance NUMERIC,
  error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record_id UUID;
  v_current_available NUMERIC;
  v_current_pending NUMERIC;
  v_new_available NUMERIC;
  v_new_pending NUMERIC;
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

  -- Find the record
  SELECT id, COALESCE(available_balance, 0), COALESCE(pending_balance, 0)
  INTO v_record_id, v_current_available, v_current_pending
  FROM public.sub_account_balances
  WHERE currency = p_currency
    AND (
      canonical_user_id = p_canonical_user_id
      OR canonical_user_id = LOWER(p_canonical_user_id)
      OR (search_wallet IS NOT NULL AND canonical_user_id = 'prize:pid:' || search_wallet)
      OR user_id = p_canonical_user_id
    )
  LIMIT 1
  FOR UPDATE;

  IF v_record_id IS NULL THEN
    -- No record found - this shouldn't happen but handle gracefully
    -- Just credit the available balance directly
    INSERT INTO public.sub_account_balances (
      canonical_user_id,
      user_id,
      currency,
      available_balance,
      pending_balance,
      last_updated
    ) VALUES (
      p_canonical_user_id,
      p_canonical_user_id,
      p_currency,
      p_amount,
      0,
      NOW()
    );

    RETURN QUERY SELECT TRUE, p_amount, 0::NUMERIC, NULL::TEXT;
    RETURN;
  END IF;

  -- Move from pending to available (but don't go negative on pending)
  v_new_pending := GREATEST(v_current_pending - p_amount, 0);
  v_new_available := v_current_available + p_amount;

  UPDATE public.sub_account_balances
  SET
    available_balance = v_new_available,
    pending_balance = v_new_pending,
    last_updated = NOW()
  WHERE id = v_record_id;

  RETURN QUERY SELECT TRUE, v_new_available, v_new_pending, NULL::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION confirm_pending_balance(TEXT, NUMERIC, TEXT) TO service_role;

-- =====================================================
-- PART 5: ADD reconcile_unconfirmed_payments FUNCTION
-- =====================================================
-- Finds and credits any payments that were confirmed by Coinbase
-- but not properly credited to user balance. Run periodically.

DROP FUNCTION IF EXISTS reconcile_unconfirmed_payments();

CREATE OR REPLACE FUNCTION reconcile_unconfirmed_payments()
RETURNS TABLE(
  reconciled_count INTEGER,
  total_amount_credited NUMERIC,
  transactions_processed TEXT[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reconciled_count INTEGER := 0;
  v_total_amount NUMERIC := 0;
  v_transactions TEXT[] := '{}';
  v_record RECORD;
  v_credit_result RECORD;
BEGIN
  -- Find all transactions that:
  -- 1. Have payment confirmed (payment_status = 'confirmed' or status = 'finished')
  -- 2. Are top-ups (no competition_id)
  -- 3. Haven't been credited yet (wallet_credited = false or null)
  -- 4. Are at least 5 minutes old (to avoid racing with webhook)

  FOR v_record IN
    SELECT id, user_id, amount
    FROM public.user_transactions
    WHERE competition_id IS NULL  -- Top-ups only
      AND (payment_status = 'confirmed' OR status IN ('finished', 'completed'))
      AND (wallet_credited IS NULL OR wallet_credited = FALSE)
      AND status != 'needs_reconciliation'  -- Don't re-process failures
      AND created_at < NOW() - INTERVAL '5 minutes'
    ORDER BY created_at ASC
    LIMIT 100  -- Process in batches
  LOOP
    -- Attempt to credit the user
    BEGIN
      SELECT * INTO v_credit_result
      FROM credit_sub_account_balance(v_record.user_id, v_record.amount, 'USD');

      IF v_credit_result.success THEN
        -- Mark as credited
        UPDATE public.user_transactions
        SET
          wallet_credited = TRUE,
          credit_synced = TRUE,
          status = 'completed',
          updated_at = NOW()
        WHERE id = v_record.id;

        v_reconciled_count := v_reconciled_count + 1;
        v_total_amount := v_total_amount + v_record.amount;
        v_transactions := array_append(v_transactions, v_record.id::TEXT);

        RAISE NOTICE 'Reconciled transaction % for user %, amount $%', v_record.id, v_record.user_id, v_record.amount;
      ELSE
        -- Mark as needing manual review
        UPDATE public.user_transactions
        SET
          status = 'needs_reconciliation',
          updated_at = NOW()
        WHERE id = v_record.id;

        RAISE WARNING 'Failed to reconcile transaction %: %', v_record.id, v_credit_result.error_message;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Error reconciling transaction %: %', v_record.id, SQLERRM;
    END;
  END LOOP;

  RETURN QUERY SELECT v_reconciled_count, v_total_amount, v_transactions;
END;
$$;

GRANT EXECUTE ON FUNCTION reconcile_unconfirmed_payments() TO service_role;

-- =====================================================
-- PART 6: ADD cleanup_expired_pending FUNCTION
-- =====================================================
-- Cleans up expired pending_topups and pending_tickets
-- Run periodically to prevent stale pending balances

DROP FUNCTION IF EXISTS cleanup_expired_pending();

CREATE OR REPLACE FUNCTION cleanup_expired_pending()
RETURNS TABLE(
  expired_topups_count INTEGER,
  expired_tickets_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_topups_count INTEGER := 0;
  v_tickets_count INTEGER := 0;
BEGIN
  -- Mark expired pending_topups
  WITH expired_topups AS (
    UPDATE public.pending_topups
    SET status = 'expired', updated_at = NOW()
    WHERE status = 'pending'
      AND expires_at < NOW()
    RETURNING id, canonical_user_id, amount
  )
  SELECT COUNT(*) INTO v_topups_count FROM expired_topups;

  -- Reduce pending_balance for expired topups
  -- (Only if the pending_balance tracking was being used)
  UPDATE public.sub_account_balances sab
  SET
    pending_balance = GREATEST(pending_balance - pt.amount, 0),
    last_updated = NOW()
  FROM public.pending_topups pt
  WHERE pt.canonical_user_id = sab.canonical_user_id
    AND pt.status = 'expired'
    AND pt.updated_at > NOW() - INTERVAL '1 minute';  -- Just expired

  -- Mark expired pending_tickets
  WITH expired_tickets AS (
    UPDATE public.pending_tickets
    SET status = 'expired', updated_at = NOW()
    WHERE status = 'pending'
      AND expires_at < NOW()
    RETURNING id
  )
  SELECT COUNT(*) INTO v_tickets_count FROM expired_tickets;

  RETURN QUERY SELECT v_topups_count, v_tickets_count;
END;
$$;

GRANT EXECUTE ON FUNCTION cleanup_expired_pending() TO service_role;

-- =====================================================
-- PART 7: ADD get_user_balance_with_pending FUNCTION
-- =====================================================
-- Returns both available and pending balance for display

DROP FUNCTION IF EXISTS get_user_balance_with_pending(TEXT);

CREATE OR REPLACE FUNCTION get_user_balance_with_pending(p_canonical_user_id TEXT)
RETURNS TABLE(
  available_balance NUMERIC,
  pending_balance NUMERIC,
  total_balance NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_available NUMERIC := 0;
  v_pending NUMERIC := 0;
  search_wallet TEXT;
BEGIN
  -- Handle null or empty identifier
  IF p_canonical_user_id IS NULL OR p_canonical_user_id = '' THEN
    RETURN QUERY SELECT 0::NUMERIC, 0::NUMERIC, 0::NUMERIC;
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

  -- Get balance from sub_account_balances
  SELECT
    COALESCE(sab.available_balance, 0),
    COALESCE(sab.pending_balance, 0)
  INTO v_available, v_pending
  FROM public.sub_account_balances sab
  WHERE sab.currency = 'USD'
    AND (
      sab.canonical_user_id = p_canonical_user_id
      OR sab.canonical_user_id = LOWER(p_canonical_user_id)
      OR (search_wallet IS NOT NULL AND sab.canonical_user_id = 'prize:pid:' || search_wallet)
      OR sab.user_id = p_canonical_user_id
    )
  ORDER BY
    CASE
      WHEN sab.canonical_user_id = p_canonical_user_id THEN 0
      ELSE 1
    END
  LIMIT 1;

  -- Fallback to privy_user_connections if not found
  IF v_available IS NULL THEN
    SELECT COALESCE(usdc_balance, 0), 0
    INTO v_available, v_pending
    FROM privy_user_connections
    WHERE
      canonical_user_id = p_canonical_user_id
      OR canonical_user_id = LOWER(p_canonical_user_id)
      OR (search_wallet IS NOT NULL AND LOWER(wallet_address) = search_wallet)
      OR privy_user_id = p_canonical_user_id
    LIMIT 1;
  END IF;

  RETURN QUERY SELECT
    COALESCE(v_available, 0)::NUMERIC,
    COALESCE(v_pending, 0)::NUMERIC,
    (COALESCE(v_available, 0) + COALESCE(v_pending, 0))::NUMERIC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_user_balance_with_pending(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_balance_with_pending(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_user_balance_with_pending(TEXT) TO service_role;

-- =====================================================
-- PART 8: VALIDATION
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE '=============================================';
  RAISE NOTICE 'OPTIMISTIC CREDITING MIGRATION COMPLETE';
  RAISE NOTICE '=============================================';
  RAISE NOTICE 'Tables created:';
  RAISE NOTICE '  - pending_topups: Track pending top-up transactions';
  RAISE NOTICE '';
  RAISE NOTICE 'Functions created:';
  RAISE NOTICE '  - add_pending_balance: Add to pending balance (optimistic)';
  RAISE NOTICE '  - confirm_pending_balance: Move pending to available';
  RAISE NOTICE '  - reconcile_unconfirmed_payments: Fix missed credits';
  RAISE NOTICE '  - cleanup_expired_pending: Remove stale pending records';
  RAISE NOTICE '  - get_user_balance_with_pending: Get available + pending';
  RAISE NOTICE '=============================================';
  RAISE NOTICE '';
  RAISE NOTICE 'IMPORTANT: Schedule these jobs in your cron:';
  RAISE NOTICE '  - reconcile_unconfirmed_payments() every 15 minutes';
  RAISE NOTICE '  - cleanup_expired_pending() every hour';
  RAISE NOTICE '=============================================';
END $$;

COMMIT;
