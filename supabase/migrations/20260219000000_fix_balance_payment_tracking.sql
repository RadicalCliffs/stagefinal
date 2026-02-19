-- Fix Balance Payment Tracking Issues
-- This migration fixes two critical problems in the Orders tab:
-- 1. DUPLICATE ENTRIES: 3 triggers creating user_transactions for same event
-- 2. WRONG PAYMENT_PROVIDER: balance payments showing as "base_account"
--
-- Root Cause:
-- - trg_orders_from_balance_ledger creates user_transaction from balance_ledger
-- - trg_sync_balance_purchase_to_user_transactions creates from joincompetition
-- - orders_to_user_transactions_trigger creates from orders table
-- All fire for the SAME balance payment, creating 3 duplicate entries
--
-- Solution:
-- 1. Update triggers to set payment_provider correctly
-- 2. Add idempotency checks to prevent duplicates
-- 3. Ensure balance payments are marked distinctly from base_account payments

-- ============================================================================
-- Step 1: Fix the _orders_from_balance_ledger trigger function
-- This creates user_transactions from balance_ledger entries
-- ============================================================================

CREATE OR REPLACE FUNCTION public._orders_from_balance_ledger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_competition_name TEXT;
BEGIN
  -- Only create user_transaction if one doesn't already exist for this reference_id
  -- This prevents duplicates when multiple triggers fire
  IF NOT EXISTS (
    SELECT 1 FROM public.user_transactions 
    WHERE tx_id = NEW.reference_id::TEXT 
    OR order_id = NEW.reference_id::TEXT
  ) THEN
    -- Fetch competition name if competition_id exists
    IF NEW.competition_id IS NOT NULL THEN
      SELECT title INTO v_competition_name
      FROM public.competitions
      WHERE id = NEW.competition_id;
    END IF;
    
    INSERT INTO public.user_transactions (
      id,
      user_id,
      canonical_user_id,
      wallet_address,
      type,
      amount,
      currency,
      status,
      payment_status,
      competition_id,
      competition_name,
      created_at,
      completed_at,
      balance_before,
      balance_after,
      -- CRITICAL FIX: Set payment_provider correctly
      -- Balance payments should be NULL or 'balance_payment', NOT 'base_account'
      payment_provider,
      metadata,
      tx_id,
      order_id
    ) VALUES (
      gen_random_uuid(),
      NEW.canonical_user_id,
      NEW.canonical_user_id,
      NEW.wallet_address,
      NEW.type,  -- 'purchase', 'topup', 'bonus_credit', etc.
      ABS(NEW.amount),  -- Use absolute value
      NEW.currency,
      'completed',
      'completed',
      NEW.competition_id,
      CASE 
        WHEN NEW.type = 'topup' THEN 'Wallet Top-Up'
        WHEN NEW.type = 'bonus_credit' THEN COALESCE(NEW.description, 'Bonus Credit')
        ELSE COALESCE(v_competition_name, 'Unknown Competition')
      END,
      NEW.created_at,
      NOW(),
      NEW.balance_before,
      NEW.balance_after,
      -- Set payment_provider based on entry type
      -- NULL or 'balance_payment' indicates balance was used
      -- 'base_account' indicates crypto payment
      CASE 
        WHEN NEW.type IN ('purchase', 'entry', 'bonus_credit') THEN 'balance_payment'
        WHEN NEW.type = 'topup' THEN COALESCE(NEW.payment_provider, 'topup')
        ELSE NULL
      END,
      jsonb_build_object(
        'source', 'balance_ledger',
        'reference_id', NEW.reference_id,
        'description', NEW.description
      ),
      NEW.reference_id::TEXT,
      NEW.reference_id::TEXT
    );
  END IF;
  
  RETURN NEW;
END;
$$;

-- ============================================================================
-- Step 2: Fix the sync_balance_purchase_to_user_transactions trigger function
-- This creates user_transactions from joincompetition entries
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sync_balance_purchase_to_user_transactions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_competition RECORD;
  v_amount NUMERIC;
BEGIN
  -- Only process if payment_provider indicates balance payment
  -- Skip if it's a base_account (crypto) payment
  IF NEW.payment_provider = 'base_account' THEN
    RETURN NEW;
  END IF;
  
  -- Get competition details for amount calculation and name
  SELECT ticket_price, title INTO v_competition
  FROM public.competitions
  WHERE id = NEW.competitionid;
  
  v_amount := COALESCE(v_competition.ticket_price, 0) * COALESCE(NEW.ticketCount, 0);
  
  -- Only create if transaction doesn't exist (check by transactionhash or joincompetition uid)
  IF NOT EXISTS (
    SELECT 1 FROM public.user_transactions 
    WHERE tx_id = NEW.transactionhash 
    OR tx_id = NEW.uid
    OR order_id::TEXT = NEW.uid
  ) THEN
    INSERT INTO public.user_transactions (
      id,
      user_id,
      canonical_user_id,
      wallet_address,
      competition_id,
      competition_name,
      type,
      amount,
      currency,
      status,
      payment_status,
      ticket_count,
      ticket_numbers,
      created_at,
      completed_at,
      -- CRITICAL FIX: Mark as balance_payment, not base_account
      payment_provider,
      tx_id,
      order_id,
      metadata
    ) VALUES (
      gen_random_uuid(),
      NEW.userid,
      NEW.canonical_user_id,
      NEW.wallet_address,
      NEW.competitionid,
      COALESCE(v_competition.title, 'Unknown Competition'),
      'purchase',
      v_amount,
      'USD',
      'completed',
      'completed',
      NEW.ticketCount,
      array_to_string(NEW.tickets, ','),
      COALESCE(NEW.created_at, NOW()),
      NOW(),
      -- Payment provider: NULL or 'balance_payment' for balance payments
      COALESCE(NEW.payment_provider, 'balance_payment'),
      COALESCE(NEW.transactionhash, NEW.uid),
      NEW.uid::UUID,
      jsonb_build_object(
        'source', 'joincompetition',
        'entry_id', NEW.uid
      )
    );
  END IF;
  
  RETURN NEW;
END;
$$;

-- ============================================================================
-- Step 3: Update the orders_to_user_transactions trigger function
-- This creates user_transactions from orders table
-- ============================================================================

CREATE OR REPLACE FUNCTION public.orders_to_user_transactions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_competition_name TEXT;
BEGIN
  -- Only create if transaction doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM public.user_transactions 
    WHERE order_id = NEW.id::TEXT
    OR tx_id = NEW.id::TEXT
  ) THEN
    -- Fetch competition name if competition_id exists
    IF NEW.competition_id IS NOT NULL THEN
      SELECT title INTO v_competition_name
      FROM public.competitions
      WHERE id = NEW.competition_id;
    END IF;
    
    INSERT INTO public.user_transactions (
      id,
      user_id,
      canonical_user_id,
      wallet_address,
      competition_id,
      competition_name,
      type,
      amount,
      currency,
      status,
      payment_status,
      created_at,
      completed_at,
      -- CRITICAL FIX: Use payment_provider from orders, default to 'balance_payment' if NULL
      payment_provider,
      tx_id,
      transaction_hash,
      order_id,
      metadata,
      webhook_ref
    ) VALUES (
      gen_random_uuid(),
      NEW.user_id,
      NEW.canonical_user_id,
      NEW.wallet_address,
      NEW.competition_id,
      CASE 
        WHEN NEW.type = 'topup' THEN 'Wallet Top-Up'
        ELSE COALESCE(v_competition_name, 'Unknown Competition')
      END,
      COALESCE(NEW.type, 'purchase'),
      NEW.amount,
      COALESCE(NEW.currency, 'USD'),
      COALESCE(NEW.status, 'completed'),
      COALESCE(NEW.payment_status, 'completed'),
      COALESCE(NEW.created_at, NOW()),
      NEW.completed_at,
      -- Use order's payment_provider, or 'balance_payment' if NULL
      -- This distinguishes balance payments from crypto (base_account) payments
      COALESCE(NEW.payment_provider, 'balance_payment'),
      NEW.tx_id,
      NEW.transaction_hash,
      NEW.id::TEXT,
      jsonb_build_object(
        'source', 'orders',
        'order_id', NEW.id
      ),
      NEW.webhook_ref
    );
  END IF;
  
  RETURN NEW;
END;
$$;

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON FUNCTION public._orders_from_balance_ledger IS 
'Creates user_transactions from balance_ledger with idempotency check. Sets payment_provider=balance_payment for balance payments.';

COMMENT ON FUNCTION public.sync_balance_purchase_to_user_transactions IS 
'Creates user_transactions from joincompetition for balance payments only. Skips base_account payments. Includes idempotency check.';

COMMENT ON FUNCTION public.orders_to_user_transactions IS 
'Creates user_transactions from orders with idempotency check. Preserves payment_provider from orders.';
