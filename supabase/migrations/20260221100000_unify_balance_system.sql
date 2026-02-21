-- ============================================================
-- MIGRATION: Unify Balance System
-- Date: 2026-02-21
-- 
-- Purpose:
-- 1. Rename canonical_users.usdc_balance → available_balance
-- 2. Make sub_account_balances the SOLE source of truth
-- 3. Remove bidirectional sync triggers (cause race conditions)
-- 4. Make balance_ledger a PASSIVE audit log (never writes back)
-- 5. Consolidate USDC → USD rows (single currency)
-- ============================================================

BEGIN;

-- ============================================================
-- PHASE 1: Rename canonical_users.usdc_balance → available_balance
-- ============================================================

-- Rename the column
ALTER TABLE canonical_users 
RENAME COLUMN usdc_balance TO available_balance;

-- Add comment explaining the column
COMMENT ON COLUMN canonical_users.available_balance IS 
  'User available balance in USD credits. Synced from sub_account_balances (source of truth).';

-- ============================================================
-- PHASE 2: Drop problematic bidirectional sync triggers
-- ============================================================

-- balance_ledger should NEVER write back to sub_account_balances
DROP TRIGGER IF EXISTS trg_balance_ledger_sync_wallet ON balance_ledger;

-- Remove bidirectional sync between canonical_users and sub_account_balances
DROP TRIGGER IF EXISTS trg_sync_cu_balance_to_sab ON canonical_users;
DROP TRIGGER IF EXISTS trg_sync_cu_usdc_from_sab ON sub_account_balances;

-- ============================================================
-- PHASE 3: Consolidate USDC → USD rows in sub_account_balances
-- ============================================================

-- 3a. For users with ONLY USDC row, rename to USD
UPDATE sub_account_balances usdc_rows
SET currency = 'USD'
WHERE currency = 'USDC'
AND NOT EXISTS (
  SELECT 1 FROM sub_account_balances usd_rows 
  WHERE usd_rows.canonical_user_id = usdc_rows.canonical_user_id 
  AND usd_rows.currency = 'USD'
);

-- 3b. For users with BOTH USD and USDC, merge into USD (take higher balance)
WITH to_merge AS (
  SELECT 
    usd.id as usd_id,
    usdc.id as usdc_id,
    usd.canonical_user_id,
    GREATEST(COALESCE(usd.available_balance, 0), COALESCE(usdc.available_balance, 0)) as merged_balance
  FROM sub_account_balances usd
  JOIN sub_account_balances usdc 
    ON usd.canonical_user_id = usdc.canonical_user_id
  WHERE usd.currency = 'USD' AND usdc.currency = 'USDC'
)
UPDATE sub_account_balances 
SET available_balance = to_merge.merged_balance,
    last_updated = NOW()
FROM to_merge 
WHERE sub_account_balances.id = to_merge.usd_id;

-- 3c. Delete all USDC rows (now merged)
DELETE FROM sub_account_balances WHERE currency = 'USDC';

-- ============================================================
-- PHASE 3B: Update user_transactions table
-- ============================================================

-- Change currency default from 'USDC' to 'USD'
ALTER TABLE user_transactions ALTER COLUMN currency SET DEFAULT 'USD';

-- Convert existing USDC rows to USD
UPDATE user_transactions SET currency = 'USD' WHERE currency = 'USDC';

-- ============================================================
-- PHASE 3C: Update orders table
-- ============================================================

-- Change currency default from 'USDC' to 'USD'
ALTER TABLE orders ALTER COLUMN currency SET DEFAULT 'USD';

-- Convert existing USDC rows to USD
UPDATE orders SET currency = 'USD' WHERE currency = 'USDC';

-- ============================================================
-- PHASE 4: Enforce USD-only going forward
-- ============================================================

CREATE OR REPLACE FUNCTION public.normalize_sub_account_currency()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  -- Default NULL to USD
  IF NEW.currency IS NULL THEN
    NEW.currency := 'USD';
  END IF;

  -- Normalize case/whitespace
  NEW.currency := upper(btrim(NEW.currency));

  -- Convert legacy USDC to USD (backwards compatibility)
  IF NEW.currency = 'USDC' THEN
    NEW.currency := 'USD';
  END IF;

  -- Only USD allowed
  IF NEW.currency <> 'USD' THEN
    RAISE EXCEPTION 'Only USD currency supported for balance, got: %', NEW.currency;
  END IF;

  RETURN NEW;
END;
$function$;

-- Create trigger on sub_account_balances (if not exists)
DROP TRIGGER IF EXISTS trg_normalize_sab_currency ON sub_account_balances;
CREATE TRIGGER trg_normalize_sab_currency
BEFORE INSERT OR UPDATE OF currency ON sub_account_balances
FOR EACH ROW
EXECUTE FUNCTION normalize_sub_account_currency();

-- ============================================================
-- PHASE 4B: Add currency normalizer for user_transactions
-- ============================================================

CREATE OR REPLACE FUNCTION public.normalize_user_tx_currency()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  -- Default NULL to USD
  IF NEW.currency IS NULL THEN
    NEW.currency := 'USD';
  END IF;

  -- Normalize case/whitespace
  NEW.currency := upper(btrim(NEW.currency));

  -- Convert legacy USDC to USD (backwards compatibility)
  IF NEW.currency = 'USDC' THEN
    NEW.currency := 'USD';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_normalize_user_tx_currency ON user_transactions;
CREATE TRIGGER trg_normalize_user_tx_currency
BEFORE INSERT OR UPDATE OF currency ON user_transactions
FOR EACH ROW
EXECUTE FUNCTION normalize_user_tx_currency();

-- ============================================================
-- PHASE 4C: Add currency normalizer for orders
-- ============================================================

CREATE OR REPLACE FUNCTION public.normalize_order_currency()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  -- Default NULL to USD
  IF NEW.currency IS NULL THEN
    NEW.currency := 'USD';
  END IF;

  -- Normalize case/whitespace
  NEW.currency := upper(btrim(NEW.currency));

  -- Convert legacy USDC to USD (backwards compatibility)
  IF NEW.currency = 'USDC' THEN
    NEW.currency := 'USD';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_normalize_order_currency ON orders;
CREATE TRIGGER trg_normalize_order_currency
BEFORE INSERT OR UPDATE OF currency ON orders
FOR EACH ROW
EXECUTE FUNCTION normalize_order_currency();

-- ============================================================
-- PHASE 5: Drop functions that wrote back from balance_ledger
-- ============================================================

-- Drop the trigger function that synced balance_ledger → sub_account_balances
DROP FUNCTION IF EXISTS balance_ledger_sync_wallet() CASCADE;

-- Drop the helper that applied deltas (used by balance_ledger_sync_wallet)
DROP FUNCTION IF EXISTS _apply_wallet_delta(text, text, numeric) CASCADE;

-- Drop old bidirectional sync functions
DROP FUNCTION IF EXISTS sync_cu_usdc_from_sab() CASCADE;
DROP FUNCTION IF EXISTS sync_canonical_users_to_sub_account_balances() CASCADE;

-- ============================================================
-- PHASE 6: Create ONE-WAY sync from SAB → canonical_users
-- ============================================================

-- SAB is source of truth, canonical_users.available_balance is a mirror for frontend reads
CREATE OR REPLACE FUNCTION sync_cu_balance_from_sab()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  -- One-way sync: SAB → canonical_users (SAB is authoritative)
  UPDATE canonical_users
  SET available_balance = NEW.available_balance,
      updated_at = NOW()
  WHERE canonical_user_id = NEW.canonical_user_id;
  
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION sync_cu_balance_from_sab() IS 
  'One-way sync: sub_account_balances → canonical_users.available_balance. SAB is source of truth.';

-- Create the one-way trigger (only fires for USD currency)
DROP TRIGGER IF EXISTS trg_sync_cu_from_sab ON sub_account_balances;
CREATE TRIGGER trg_sync_cu_from_sab
AFTER INSERT OR UPDATE OF available_balance ON sub_account_balances
FOR EACH ROW
WHEN (NEW.currency = 'USD')
EXECUTE FUNCTION sync_cu_balance_from_sab();

-- ============================================================
-- PHASE 7: Update RPC functions that return usdc_balance
-- ============================================================

-- Drop functions that change return type (must drop before recreating with different signature)
DROP FUNCTION IF EXISTS public.get_user_balance_by_canonical_id(text);
DROP FUNCTION IF EXISTS public.get_user_balance(text);
DROP FUNCTION IF EXISTS public.get_user_by_wallet(text);
DROP FUNCTION IF EXISTS public.get_custody_wallet_summary();
DROP FUNCTION IF EXISTS public.credit_sub_account_balance(text, numeric, text, text, text);
DROP FUNCTION IF EXISTS public.credit_sub_account_with_bonus(text, numeric);

-- Update get_user_balance_by_canonical_id to return available_balance
CREATE OR REPLACE FUNCTION public.get_user_balance_by_canonical_id(p_canonical_user_id text)
RETURNS TABLE(canonical_user_id text, available_balance numeric, bonus_balance numeric)
LANGUAGE sql
STABLE
AS $function$
  SELECT cu.canonical_user_id, cu.available_balance, cu.bonus_balance
  FROM public.canonical_users cu
  WHERE cu.canonical_user_id = p_canonical_user_id
$function$;

-- ============================================================
-- PHASE 7B: Update functions with USDC defaults to use USD
-- ============================================================

-- pay_balance_transaction - change default from 'USDC' to 'USD'
CREATE OR REPLACE FUNCTION public.pay_balance_transaction(
  p_canonical_user_id text, 
  p_amount numeric, 
  p_currency text DEFAULT 'USD'::text, 
  p_description text DEFAULT NULL::text, 
  p_order_id uuid DEFAULT NULL::uuid, 
  p_competition_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(transaction_id uuid, balance_before numeric, balance_after numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_balance_id uuid;
  v_balance_before numeric;
  v_balance_after numeric;
  v_tx_id uuid;
  v_currency text;
BEGIN
  -- Normalize currency to USD (convert legacy USDC)
  v_currency := CASE WHEN upper(btrim(p_currency)) = 'USDC' THEN 'USD' ELSE upper(btrim(p_currency)) END;

  -- Validate positive amount
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive.' USING ERRCODE = '22023';
  END IF;

  -- Lock the balance row for this canonical user and currency
  SELECT id, COALESCE(available_balance, 0)
    INTO v_balance_id, v_balance_before
  FROM sub_account_balances
  WHERE canonical_user_id = p_canonical_user_id AND currency = v_currency
  FOR UPDATE;

  IF v_balance_id IS NULL THEN
    RAISE EXCEPTION 'Balance row not found for user % and currency %', p_canonical_user_id, v_currency USING ERRCODE = 'P0002';
  END IF;

  -- Ensure sufficient balance
  IF v_balance_before < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance.' USING ERRCODE = '22023';
  END IF;

  v_balance_after := v_balance_before - p_amount;

  -- Update the balance atomically
  UPDATE sub_account_balances
    SET available_balance = v_balance_after,
        last_updated = now()
  WHERE id = v_balance_id;

  -- Record the transaction as a real debit
  INSERT INTO user_transactions (
    user_id,
    canonical_user_id,
    type,
    amount,
    currency,
    balance_before,
    balance_after,
    description,
    status,
    order_id,
    competition_id,
    created_at
  ) VALUES (
    NULL,
    p_canonical_user_id,
    'debit',
    p_amount,
    v_currency,
    v_balance_before,
    v_balance_after,
    p_description,
    'completed',
    p_order_id,
    p_competition_id,
    now()
  ) RETURNING id INTO v_tx_id;

  RETURN QUERY SELECT v_tx_id, v_balance_before, v_balance_after;
END;
$function$;

-- upsert_sub_account_topup - change default from 'USDC' to 'USD'
CREATE OR REPLACE FUNCTION public.upsert_sub_account_topup(
  p_canonical_user_id text, 
  p_amount numeric, 
  p_currency text DEFAULT 'USD'::text
)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_currency text;
BEGIN
  -- Normalize currency to USD (convert legacy USDC)
  v_currency := CASE WHEN upper(btrim(p_currency)) = 'USDC' THEN 'USD' ELSE upper(btrim(p_currency)) END;

  INSERT INTO public.sub_account_balances AS sab
    (canonical_user_id, currency, available_balance, pending_balance, last_updated)
  VALUES (p_canonical_user_id, v_currency, p_amount, 0, now())
  ON CONFLICT (canonical_user_id, currency) DO UPDATE
    SET available_balance = sab.available_balance + excluded.available_balance,
        last_updated = now();
END;
$function$;

-- ============================================================
-- PHASE 8: Sync existing data (ensure canonical_users matches SAB)
-- ============================================================

-- One-time sync: Update canonical_users.available_balance from SAB
UPDATE canonical_users cu
SET available_balance = COALESCE(sab.available_balance, 0),
    updated_at = NOW()
FROM sub_account_balances sab
WHERE sab.canonical_user_id = cu.canonical_user_id
  AND sab.currency = 'USD';

-- ============================================================
-- PHASE 8B: Fix commerce_post_to_balance to use SAB (source of truth)
-- ============================================================

-- This function was writing to canonical_users.usdc_balance directly.
-- Fix it to write to sub_account_balances instead (one-way sync will update canonical_users)
CREATE OR REPLACE FUNCTION public.commerce_post_to_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  -- Only proceed if not already posted and status is completed
  IF NEW.posted_to_balance IS TRUE THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM 'completed' THEN
    RETURN NEW;
  END IF;

  -- Only for explicit commerce providers and topups
  IF NEW.type = 'topup' AND NEW.payment_provider IN ('coinbase_commerce','cdp_commerce') THEN
    IF NEW.canonical_user_id IS NULL THEN
      RAISE EXCEPTION 'Cannot post topup without canonical_user_id for tx %', NEW.id;
    END IF;

    -- Credit sub_account_balances (source of truth) instead of canonical_users
    -- The trigger trg_sync_cu_from_sab will propagate to canonical_users.available_balance
    INSERT INTO public.sub_account_balances AS sab
      (canonical_user_id, currency, available_balance, pending_balance, last_updated)
    VALUES (NEW.canonical_user_id, 'USD', COALESCE(NEW.amount, 0), 0, now())
    ON CONFLICT (canonical_user_id, currency) DO UPDATE
      SET available_balance = sab.available_balance + COALESCE(NEW.amount, 0),
          last_updated = now();

    -- Mark posted
    NEW.posted_to_balance := true;
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.commerce_post_to_balance() IS 
  'Credits sub_account_balances for coinbase_commerce/cdp_commerce topups. SAB is source of truth.';

-- ============================================================
-- PHASE 8C: Fix apply_topup_and_welcome_bonus to use SAB
-- ============================================================

-- This function is called by trg_apply_topup_and_welcome_bonus on user_transactions
-- It credits SAB (source of truth), trigger syncs to canonical_users.available_balance
CREATE OR REPLACE FUNCTION public.apply_topup_and_welcome_bonus()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_user_id text;
  v_amount numeric;
  v_currency text := 'USD';
  v_provider text;
  v_before numeric;
  v_after numeric;
  v_bonus_before boolean;
  v_bonus_amount numeric := 0;
  v_after_bonus numeric;
  v_ref_topup text;
  v_ref_bonus text;
  v_idem_key text;
BEGIN
  -- Only when posted_to_balance flips to true
  IF TG_OP <> 'UPDATE' OR (NEW.posted_to_balance IS DISTINCT FROM TRUE) OR (OLD.posted_to_balance IS TRUE) THEN
    RETURN NEW;
  END IF;

  -- Only for top-up providers
  v_provider := NEW.payment_provider;
  IF v_provider NOT IN ('base_account', 'coinbase_commerce', 'cdp_commerce') THEN
    RETURN NEW;
  END IF;

  -- Idempotency lock
  v_idem_key := COALESCE(NEW.webhook_ref, NEW.charge_id, NEW.id::text, gen_random_uuid()::text);
  PERFORM pg_advisory_xact_lock(hashtext('user_tx_topup:' || v_idem_key));

  v_user_id := COALESCE(NEW.canonical_user_id, NEW.canonical_user_id_norm, NEW.user_id);
  v_amount := COALESCE(NEW.amount, 0);
  v_ref_topup := COALESCE(NEW.charge_id, NEW.webhook_ref, 'user_tx:' || NEW.id::text);
  v_ref_bonus := v_ref_topup || ':bonus50';

  IF v_user_id IS NULL OR v_user_id = '' OR v_amount <= 0 THEN
    RETURN NEW;
  END IF;

  -- Get current balance from SAB and bonus status
  SELECT COALESCE(sab.available_balance, 0), COALESCE(cu.has_used_new_user_bonus, false)
  INTO v_before, v_bonus_before
  FROM public.canonical_users cu
  LEFT JOIN public.sub_account_balances sab ON sab.canonical_user_id = cu.canonical_user_id AND sab.currency = v_currency
  WHERE cu.canonical_user_id = v_user_id
  FOR UPDATE OF cu;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'canonical_user not found for id % (tx id=%)', v_user_id, NEW.id;
  END IF;

  -- 1) Credit the cash top-up to SAB
  INSERT INTO public.sub_account_balances AS sab
    (canonical_user_id, currency, available_balance, pending_balance, last_updated)
  VALUES (v_user_id, v_currency, v_amount, 0, now())
  ON CONFLICT (canonical_user_id, currency) DO UPDATE
    SET available_balance = sab.available_balance + v_amount,
        last_updated = now()
  RETURNING available_balance INTO v_after;

  INSERT INTO public.balance_ledger (
    canonical_user_id, transaction_type, amount, currency,
    balance_before, balance_after, reference_id, description, created_at, type, payment_provider
  ) VALUES (
    v_user_id, 'credit', v_amount, v_currency,
    v_before, v_after, v_ref_topup, 'Wallet top-up', now(), 'topup', v_provider
  );

  -- 2) Apply 50% welcome bonus exactly once
  IF v_bonus_before IS FALSE THEN
    v_bonus_amount := ROUND(v_amount * 0.5, 2);

    UPDATE public.sub_account_balances
    SET available_balance = available_balance + v_bonus_amount,
        last_updated = now()
    WHERE canonical_user_id = v_user_id AND currency = v_currency
    RETURNING available_balance INTO v_after_bonus;

    UPDATE public.canonical_users
    SET has_used_new_user_bonus = true, updated_at = now()
    WHERE canonical_user_id = v_user_id;

    INSERT INTO public.balance_ledger (
      canonical_user_id, transaction_type, amount, currency,
      balance_before, balance_after, reference_id, description, created_at, type, payment_provider
    ) VALUES (
      v_user_id, 'credit', v_bonus_amount, v_currency,
      v_after, v_after_bonus, v_ref_bonus, 'First top-up 50% bonus', now(), 'bonus', v_provider
    );
  END IF;

  RETURN NEW;
END;
$function$;

-- ============================================================
-- PHASE 8D: Fix sync_canonical_user_balance trigger function
-- ============================================================

CREATE OR REPLACE FUNCTION public.sync_canonical_user_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  UPDATE public.canonical_users cu
  SET 
    available_balance = NEW.available_balance,
    updated_at = now()
  WHERE cu.canonical_user_id = NEW.canonical_user_id;
  RETURN NEW;
END;
$function$;

-- ============================================================
-- PHASE 8E: Fix sync_all_user_balances utility function
-- ============================================================

CREATE OR REPLACE FUNCTION public.sync_all_user_balances()
RETURNS TABLE(canonical_user_id text, old_balance numeric, new_balance numeric)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  UPDATE public.canonical_users cu
  SET 
    available_balance = sab.available_balance,
    updated_at = now()
  FROM public.sub_account_balances sab
  WHERE cu.canonical_user_id = sab.canonical_user_id
    AND sab.currency = 'USD'
    AND COALESCE(cu.available_balance,0) != COALESCE(sab.available_balance,0)
  RETURNING 
    cu.canonical_user_id,
    cu.available_balance AS old_balance,
    sab.available_balance AS new_balance;
END;
$function$;

-- ============================================================
-- PHASE 8F: Fix update_custody_balance utility function
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_custody_balance(
  p_user_id text,
  p_amount numeric,
  p_transaction_type text,
  p_reference_id text DEFAULT NULL
)
RETURNS TABLE(success boolean, user_id text, balance_before numeric, balance_after numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE 
  v_user_uuid UUID; 
  v_canonical_id TEXT;
  v_before NUMERIC; 
  v_after NUMERIC; 
BEGIN
  -- Find user
  SELECT id, canonical_user_id INTO v_user_uuid, v_canonical_id
  FROM canonical_users 
  WHERE uid=p_user_id OR wallet_address=p_user_id OR base_wallet_address=p_user_id 
  LIMIT 1;
  
  IF v_user_uuid IS NULL THEN 
    RETURN QUERY SELECT false, p_user_id, 0::NUMERIC, 0::NUMERIC; 
    RETURN; 
  END IF;
  
  -- Get current balance from SAB (source of truth)
  SELECT COALESCE(available_balance, 0) INTO v_before 
  FROM sub_account_balances 
  WHERE canonical_user_id = v_canonical_id AND currency = 'USD';
  
  v_before := COALESCE(v_before, 0);
  v_after := v_before + p_amount;
  
  -- Update SAB (trigger will sync to canonical_users.available_balance)
  INSERT INTO sub_account_balances AS sab
    (canonical_user_id, currency, available_balance, pending_balance, last_updated)
  VALUES (v_canonical_id, 'USD', v_after, 0, now())
  ON CONFLICT (canonical_user_id, currency) DO UPDATE
    SET available_balance = v_after,
        last_updated = now();
  
  -- Log to custody_wallet_balances
  INSERT INTO custody_wallet_balances (user_id, transaction_type, change_amount, balance_before, balance_after, reference_id)
  VALUES (v_user_uuid, p_transaction_type, p_amount, v_before, v_after, p_reference_id);
  
  RETURN QUERY SELECT true, v_user_uuid::TEXT, v_before, v_after; 
END; 
$function$;

-- ============================================================
-- PHASE 8G: Fix fix_balance_discrepancies utility function
-- ============================================================

CREATE OR REPLACE FUNCTION public.fix_balance_discrepancies(p_canonical_user_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_fixed_count INT := 0;
  v_total_checked INT := 0;
  v_ledger_balance NUMERIC;
  v_user_record RECORD;
BEGIN
  IF p_canonical_user_id IS NOT NULL THEN
    -- Fix single user
    SELECT COALESCE(balance_after, 0) INTO v_ledger_balance
    FROM balance_ledger
    WHERE canonical_user_id = p_canonical_user_id
      AND currency = 'USD'
    ORDER BY created_at DESC, id DESC
    LIMIT 1;

    IF v_ledger_balance IS NULL THEN
      SELECT COALESCE(available_balance, 0) INTO v_ledger_balance
      FROM sub_account_balances
      WHERE canonical_user_id = p_canonical_user_id
        AND currency = 'USD'
      LIMIT 1;
    END IF;

    -- Update SAB (trigger syncs to canonical_users.available_balance)
    UPDATE sub_account_balances
    SET available_balance = COALESCE(v_ledger_balance, 0),
        last_updated = NOW()
    WHERE canonical_user_id = p_canonical_user_id
      AND currency = 'USD';

    v_fixed_count := 1;
    v_total_checked := 1;

  ELSE
    -- Fix all users with discrepancies
    FOR v_user_record IN
      SELECT DISTINCT bl.canonical_user_id
      FROM balance_ledger bl
      WHERE bl.currency = 'USD'
    LOOP
      v_total_checked := v_total_checked + 1;

      SELECT COALESCE(balance_after, 0) INTO v_ledger_balance
      FROM balance_ledger
      WHERE canonical_user_id = v_user_record.canonical_user_id
        AND currency = 'USD'
      ORDER BY created_at DESC, id DESC
      LIMIT 1;

      UPDATE sub_account_balances
      SET available_balance = v_ledger_balance,
          last_updated = NOW()
      WHERE canonical_user_id = v_user_record.canonical_user_id
        AND currency = 'USD';

      v_fixed_count := v_fixed_count + 1;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'users_checked', v_total_checked,
    'users_fixed', v_fixed_count
  );
END;
$function$;

-- ============================================================
-- PHASE 8H: Drop legacy functions that only reference USDC
-- ============================================================

-- These functions are obsolete after the currency unification
DROP FUNCTION IF EXISTS sync_canonical_user_usdc_from_sab() CASCADE;
DROP FUNCTION IF EXISTS sync_completed_deposits_to_usdc(text) CASCADE;
DROP FUNCTION IF EXISTS sync_external_wallet_balance(text) CASCADE;
DROP FUNCTION IF EXISTS sync_all_external_wallet_balances() CASCADE;

-- ============================================================
-- PHASE 8I: Fix user_transactions_post_to_wallet trigger function  
-- ============================================================

-- This function had USDC default and updated canonical_users.usdc_balance
-- Fix to use USD and update via SAB (trigger syncs to canonical_users.available_balance)
CREATE OR REPLACE FUNCTION public.user_transactions_post_to_wallet()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_before numeric := 0;
  v_after numeric := 0;
  v_delta numeric := 0;
  v_currency text;
  v_uid text;
BEGIN
  IF (TG_OP <> 'INSERT' AND TG_OP <> 'UPDATE') THEN
    RETURN NEW;
  END IF;

  IF NEW.posted_to_balance IS TRUE THEN
    RETURN NEW;
  END IF;

  IF lower(COALESCE(NEW.status,'')) <> 'completed' THEN
    RETURN NEW;
  END IF;

  IF lower(COALESCE(NEW.type,'')) = 'entry'
     AND lower(COALESCE(NEW.payment_provider,'')) <> 'balance' THEN
    NEW.balance_before := NULL;
    NEW.balance_after := NULL;
    RETURN NEW;
  END IF;

  -- FIXED: Default to USD, convert legacy USDC to USD
  v_currency := upper(btrim(COALESCE(NEW.currency, 'USD')));
  IF v_currency = 'USDC' THEN
    v_currency := 'USD';
  END IF;

  -- normalize user id
  v_uid := 'prize:pid:' || lower(replace(COALESCE(NEW.canonical_user_id,'')::text, 'prize:pid:', ''));

  IF v_uid = 'prize:pid:' THEN
    NEW.balance_before := NULL;
    NEW.balance_after := NULL;
    NEW.posted_to_balance := false;
    RETURN NEW;
  END IF;

  IF lower(COALESCE(NEW.type,'')) = 'topup' THEN
    v_delta := abs(COALESCE(NEW.amount,0));
  ELSIF lower(COALESCE(NEW.type,'')) = 'entry' THEN
    v_delta := -abs(COALESCE(NEW.amount,0));
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.sub_account_balances (canonical_user_id, currency, available_balance, last_updated)
  VALUES (v_uid, v_currency, 0, now())
  ON CONFLICT (canonical_user_id, currency) DO NOTHING;

  SELECT COALESCE(available_balance,0)
    INTO v_before
  FROM public.sub_account_balances
  WHERE canonical_user_id = v_uid
    AND currency = v_currency
  FOR UPDATE;

  IF NOT FOUND THEN
    NEW.balance_before := NULL;
    NEW.balance_after := NULL;
    NEW.posted_to_balance := false;
    RETURN NEW;
  END IF;

  v_after := v_before + v_delta;

  IF v_delta < 0 AND v_after < 0 THEN
    RAISE EXCEPTION 'Not enough balance';
  END IF;

  -- Update SAB (trigger trg_sync_cu_from_sab syncs to canonical_users.available_balance)
  UPDATE public.sub_account_balances
     SET available_balance = v_after,
         last_updated = now()
   WHERE canonical_user_id = v_uid
     AND currency = v_currency;

  -- No need to manually update canonical_users - the trigger does it

  NEW.balance_before := v_before;
  NEW.balance_after := v_after;
  NEW.posted_to_balance := true;
  NEW.completed_at := COALESCE(NEW.completed_at, now());
  NEW.canonical_user_id := v_uid;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.user_transactions_post_to_wallet() IS 
  'Trigger to set balance_before/after and update SAB. Uses USD, converts legacy USDC. SAB sync propagates to canonical_users.available_balance.';

-- ============================================================
-- PHASE 8J: Fix credit_sub_account_balance to use available_balance
-- ============================================================

CREATE OR REPLACE FUNCTION public.credit_sub_account_balance(
  p_canonical_user_id text,
  p_amount numeric,
  p_currency text DEFAULT 'USD',
  p_reference_id text DEFAULT NULL,
  p_description text DEFAULT NULL
)
RETURNS TABLE(success boolean, balance_before numeric, balance_after numeric, error_message text)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_record_id uuid;
  v_previous_balance numeric;
  v_new_balance numeric;
  v_currency text;
BEGIN
  -- Normalize currency
  v_currency := CASE WHEN upper(btrim(COALESCE(p_currency, 'USD'))) = 'USDC' THEN 'USD' ELSE upper(btrim(COALESCE(p_currency, 'USD'))) END;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, 0::NUMERIC, 0::NUMERIC, 'Amount must be positive'::TEXT;
    RETURN;
  END IF;

  -- Seed/lock target balance row (SAB is source of truth)
  INSERT INTO public.sub_account_balances (canonical_user_id, currency, available_balance, pending_balance, last_updated)
  VALUES (p_canonical_user_id, v_currency, 0, 0, NOW())
  ON CONFLICT (canonical_user_id, currency) DO NOTHING;

  SELECT id, coalesce(available_balance, 0)
    INTO v_record_id, v_previous_balance
  FROM public.sub_account_balances
  WHERE canonical_user_id = p_canonical_user_id
    AND currency = v_currency
  FOR UPDATE;

  v_new_balance := round(v_previous_balance + p_amount, 2);

  -- Update SAB (trigger syncs to canonical_users.available_balance)
  UPDATE public.sub_account_balances
  SET available_balance = v_new_balance,
      last_updated = NOW()
  WHERE id = v_record_id;

  -- Idempotent user transaction
  INSERT INTO public.user_transactions (
    canonical_user_id, amount, currency, type, status, payment_status,
    balance_before, balance_after, tx_id, webhook_ref,
    payment_provider, method, notes, created_at, completed_at
  ) VALUES (
    p_canonical_user_id, p_amount, v_currency, 'topup', 'completed', 'confirmed',
    v_previous_balance, v_new_balance, p_reference_id, p_reference_id,
    'system', 'credit_sub_account_balance', coalesce(p_description, 'Account balance credited'),
    NOW(), NOW()
  )
  ON CONFLICT (type, canonical_user_id, tx_id) DO NOTHING;

  -- Balance ledger
  INSERT INTO public.balance_ledger (
    canonical_user_id, transaction_type, amount, currency,
    balance_before, balance_after, reference_id, description, created_at
  ) VALUES (
    p_canonical_user_id, 'deposit', p_amount, v_currency,
    v_previous_balance, v_new_balance, p_reference_id,
    coalesce(p_description, 'Account balance credited'), NOW()
  );

  RETURN QUERY SELECT TRUE, v_previous_balance, v_new_balance, NULL::TEXT;
END;
$function$;

-- ============================================================
-- PHASE 8K: Fix credit_sub_account_with_bonus to use SAB
-- ============================================================

CREATE OR REPLACE FUNCTION public.credit_sub_account_with_bonus(p_canonical_user_id text, p_amount numeric)
RETURNS TABLE(success boolean, balance_before numeric, balance_after numeric, bonus_amount numeric, bonus_applied boolean)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_has_used_bonus BOOLEAN;
  v_bonus_amount NUMERIC := 0;
  v_total_credit NUMERIC := 0;
  v_current_balance NUMERIC := 0;
  v_new_balance NUMERIC := 0;
BEGIN
  -- Get current balance from SAB (source of truth)
  SELECT COALESCE(sab.available_balance, 0), COALESCE(cu.has_used_new_user_bonus, false)
  INTO v_current_balance, v_has_used_bonus
  FROM canonical_users cu
  LEFT JOIN sub_account_balances sab ON sab.canonical_user_id = cu.canonical_user_id AND sab.currency = 'USD'
  WHERE cu.canonical_user_id = p_canonical_user_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 0::NUMERIC, 0::NUMERIC, 0::NUMERIC, false;
    RETURN;
  END IF;

  IF v_has_used_bonus = false THEN
    v_bonus_amount := COALESCE(p_amount,0) * 0.5;
    v_total_credit := COALESCE(p_amount,0) + v_bonus_amount;
  ELSE
    v_total_credit := COALESCE(p_amount,0);
  END IF;

  v_new_balance := v_current_balance + v_total_credit;

  -- Update SAB (trigger syncs to canonical_users.available_balance)
  INSERT INTO public.sub_account_balances AS sab
    (canonical_user_id, currency, available_balance, pending_balance, last_updated)
  VALUES (p_canonical_user_id, 'USD', v_new_balance, 0, now())
  ON CONFLICT (canonical_user_id, currency) DO UPDATE
    SET available_balance = v_new_balance,
        last_updated = now();

  -- Mark bonus as used if applicable
  IF v_bonus_amount > 0 THEN
    UPDATE canonical_users
    SET has_used_new_user_bonus = true, updated_at = NOW()
    WHERE canonical_user_id = p_canonical_user_id;
  END IF;

  RETURN QUERY SELECT true, v_current_balance, v_new_balance, v_bonus_amount, v_bonus_amount > 0;
END;
$function$;

-- ============================================================
-- PHASE 8L: Fix credit_user_balance to use SAB
-- ============================================================

CREATE OR REPLACE FUNCTION public.credit_user_balance(user_id text, amount numeric)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE 
  v_new_balance NUMERIC;
  v_canonical_id TEXT;
BEGIN
  -- Get canonical_user_id from uuid
  SELECT canonical_user_id INTO v_canonical_id
  FROM canonical_users 
  WHERE id = user_id::UUID;

  IF v_canonical_id IS NULL THEN
    RETURN 0;
  END IF;

  -- Update SAB (trigger syncs to canonical_users.available_balance)
  INSERT INTO public.sub_account_balances AS sab
    (canonical_user_id, currency, available_balance, pending_balance, last_updated)
  VALUES (v_canonical_id, 'USD', amount, 0, now())
  ON CONFLICT (canonical_user_id, currency) DO UPDATE
    SET available_balance = sab.available_balance + amount,
        last_updated = now()
  RETURNING available_balance INTO v_new_balance;

  RETURN COALESCE(v_new_balance, 0);
END;
$function$;

-- ============================================================
-- PHASE 8M: Fix credit_user_topup to use SAB
-- ============================================================

CREATE OR REPLACE FUNCTION public.credit_user_topup(
  p_canonical_user_id text,
  p_amount numeric,
  p_currency text DEFAULT 'USD',
  p_payment_provider text DEFAULT 'system',
  p_external_ref text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_before numeric;
  v_after numeric;
  v_bonus_before boolean;
  v_bonus_amount numeric := 0;
  v_new_after numeric;
  v_ref_topup text := COALESCE(p_external_ref, gen_random_uuid()::text);
  v_ref_bonus text := v_ref_topup || ':bonus50';
  v_currency text;
BEGIN
  -- Normalize currency
  v_currency := CASE WHEN upper(btrim(COALESCE(p_currency, 'USD'))) = 'USDC' THEN 'USD' ELSE upper(btrim(COALESCE(p_currency, 'USD'))) END;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Top-up amount must be > 0' USING ERRCODE = '22023';
  END IF;
  IF p_canonical_user_id IS NULL OR p_canonical_user_id = '' THEN
    RAISE EXCEPTION 'canonical_user_id required' USING ERRCODE = '22023';
  END IF;

  -- Idempotency check
  IF p_external_ref IS NOT NULL AND p_external_ref <> '' THEN
    PERFORM pg_advisory_xact_lock(hashtext('topup-idem:' || p_external_ref));
    PERFORM 1 FROM public.payment_idempotency
    WHERE idempotency_key = p_external_ref AND canonical_user_id = p_canonical_user_id;
    IF FOUND THEN
      RETURN jsonb_build_object('ok', true, 'idempotent', true, 'message', 'Top-up previously processed');
    END IF;
  END IF;

  -- Get current balance from SAB and bonus status from canonical_users
  SELECT COALESCE(sab.available_balance, 0), COALESCE(cu.has_used_new_user_bonus, false)
  INTO v_before, v_bonus_before
  FROM public.canonical_users cu
  LEFT JOIN public.sub_account_balances sab ON sab.canonical_user_id = cu.canonical_user_id AND sab.currency = v_currency
  WHERE cu.canonical_user_id = p_canonical_user_id
  FOR UPDATE OF cu;

  -- 1) Credit the cash top-up to SAB
  INSERT INTO public.sub_account_balances AS sab
    (canonical_user_id, currency, available_balance, pending_balance, last_updated)
  VALUES (p_canonical_user_id, v_currency, p_amount, 0, now())
  ON CONFLICT (canonical_user_id, currency) DO UPDATE
    SET available_balance = sab.available_balance + p_amount,
        last_updated = now()
  RETURNING available_balance INTO v_after;

  INSERT INTO public.balance_ledger (
    canonical_user_id, transaction_type, amount, currency,
    balance_before, balance_after, reference_id, description, created_at, type, payment_provider
  ) VALUES (
    p_canonical_user_id, 'credit', p_amount, v_currency,
    v_before, v_after, v_ref_topup, 'Wallet top-up', now(), 'topup', p_payment_provider
  );

  -- 2) Apply 50% first-top-up bonus exactly once
  IF v_bonus_before IS FALSE THEN
    v_bonus_amount := ROUND(p_amount * 0.5, 2);

    UPDATE public.sub_account_balances
    SET available_balance = available_balance + v_bonus_amount,
        last_updated = now()
    WHERE canonical_user_id = p_canonical_user_id AND currency = v_currency
    RETURNING available_balance INTO v_new_after;

    UPDATE public.canonical_users
    SET has_used_new_user_bonus = true, updated_at = now()
    WHERE canonical_user_id = p_canonical_user_id;

    INSERT INTO public.balance_ledger (
      canonical_user_id, transaction_type, amount, currency,
      balance_before, balance_after, reference_id, description, created_at, type, payment_provider
    ) VALUES (
      p_canonical_user_id, 'credit', v_bonus_amount, v_currency,
      v_after, v_new_after, v_ref_bonus, 'First top-up 50% bonus', now(), 'bonus', p_payment_provider
    );
  ELSE
    v_new_after := v_after;
  END IF;

  -- Record idempotency
  IF p_external_ref IS NOT NULL AND p_external_ref <> '' THEN
    INSERT INTO public.payment_idempotency (idempotency_key, user_id, amount, result, canonical_user_id)
    VALUES (p_external_ref, p_canonical_user_id, p_amount,
            jsonb_build_object('topup_ref', v_ref_topup, 'bonus_ref', CASE WHEN v_bonus_amount > 0 THEN v_ref_bonus ELSE NULL END),
            p_canonical_user_id);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'credited', p_amount,
    'bonus_applied', (v_bonus_amount > 0),
    'bonus_amount', v_bonus_amount,
    'balance_after', v_new_after,
    'topup_ref', v_ref_topup,
    'bonus_ref', CASE WHEN v_bonus_amount > 0 THEN v_ref_bonus ELSE NULL END
  );
END;
$function$;

-- ============================================================
-- PHASE 8N: Fix rollback_balance_from_ledger to use available_balance
-- ============================================================

CREATE OR REPLACE FUNCTION public.rollback_balance_from_ledger(p_canonical_user_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_user_record RECORD;
  v_ledger_balance NUMERIC;
  v_fixed_count INTEGER := 0;
  v_total_checked INTEGER := 0;
BEGIN
  IF p_canonical_user_id IS NOT NULL THEN
    SELECT COALESCE(balance_after, 0) INTO v_ledger_balance
    FROM balance_ledger
    WHERE canonical_user_id = p_canonical_user_id AND currency = 'USD'
    ORDER BY created_at DESC, id DESC LIMIT 1;

    IF v_ledger_balance IS NULL THEN
      SELECT COALESCE(available_balance, 0) INTO v_ledger_balance
      FROM sub_account_balances
      WHERE canonical_user_id = p_canonical_user_id AND currency = 'USD' LIMIT 1;
    END IF;

    -- Update SAB (trigger syncs to canonical_users.available_balance)
    UPDATE sub_account_balances
    SET available_balance = COALESCE(v_ledger_balance, 0), last_updated = NOW()
    WHERE canonical_user_id = p_canonical_user_id AND currency = 'USD';

    v_fixed_count := 1;
    v_total_checked := 1;
  ELSE
    FOR v_user_record IN SELECT DISTINCT bl.canonical_user_id FROM balance_ledger bl WHERE bl.currency = 'USD' LOOP
      v_total_checked := v_total_checked + 1;

      SELECT COALESCE(balance_after, 0) INTO v_ledger_balance
      FROM balance_ledger
      WHERE canonical_user_id = v_user_record.canonical_user_id AND currency = 'USD'
      ORDER BY created_at DESC, id DESC LIMIT 1;

      UPDATE sub_account_balances
      SET available_balance = v_ledger_balance, last_updated = NOW()
      WHERE canonical_user_id = v_user_record.canonical_user_id AND currency = 'USD';

      v_fixed_count := v_fixed_count + 1;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('success', true, 'users_checked', v_total_checked, 'users_fixed', v_fixed_count);
END;
$function$;

-- ============================================================
-- PHASE 8O: Fix READ-ONLY functions to use available_balance
-- ============================================================

-- get_user_balance - commonly used to fetch user balance
CREATE OR REPLACE FUNCTION public.get_user_balance(p_user_id text)
RETURNS TABLE(canonical_user_id text, available_balance numeric, bonus_balance numeric)
LANGUAGE sql
STABLE
AS $function$
  SELECT 
    cu.canonical_user_id,
    COALESCE(cu.available_balance, 0) as available_balance,
    COALESCE(cu.bonus_balance, 0) as bonus_balance
  FROM public.canonical_users cu
  WHERE cu.canonical_user_id = p_user_id
     OR cu.privy_user_id = p_user_id
     OR cu.wallet_address = p_user_id
     OR cu.uid = p_user_id
  LIMIT 1;
$function$;

-- get_user_by_wallet
CREATE OR REPLACE FUNCTION public.get_user_by_wallet(p_wallet_address text)
RETURNS TABLE(
  id uuid, canonical_user_id text, wallet_address text, privy_user_id text,
  available_balance numeric, bonus_balance numeric, has_used_new_user_bonus boolean
)
LANGUAGE sql
STABLE
AS $function$
  SELECT 
    cu.id, cu.canonical_user_id, cu.wallet_address, cu.privy_user_id,
    COALESCE(cu.available_balance, 0), COALESCE(cu.bonus_balance, 0),
    COALESCE(cu.has_used_new_user_bonus, false)
  FROM public.canonical_users cu
  WHERE lower(cu.wallet_address) = lower(p_wallet_address)
  LIMIT 1;
$function$;

-- get_custody_wallet_summary
CREATE OR REPLACE FUNCTION public.get_custody_wallet_summary()
RETURNS TABLE(total_users bigint, total_balance numeric, avg_balance numeric)
LANGUAGE sql
STABLE
AS $function$
  SELECT 
    COUNT(*)::BIGINT as total_users,
    COALESCE(SUM(available_balance), 0) as total_balance,
    COALESCE(AVG(available_balance), 0) as avg_balance
  FROM public.canonical_users;
$function$;

-- check_balance_health - may not exist but referenced
CREATE OR REPLACE FUNCTION public.check_balance_health(p_canonical_user_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
  v_cu_balance NUMERIC;
  v_sab_balance NUMERIC;
  v_discrepancy NUMERIC;
BEGIN
  IF p_canonical_user_id IS NOT NULL THEN
    SELECT available_balance INTO v_cu_balance
    FROM canonical_users WHERE canonical_user_id = p_canonical_user_id;
    
    SELECT available_balance INTO v_sab_balance
    FROM sub_account_balances 
    WHERE canonical_user_id = p_canonical_user_id AND currency = 'USD';
    
    v_discrepancy := ABS(COALESCE(v_cu_balance, 0) - COALESCE(v_sab_balance, 0));
    
    RETURN jsonb_build_object(
      'canonical_user_id', p_canonical_user_id,
      'cu_balance', v_cu_balance,
      'sab_balance', v_sab_balance,
      'discrepancy', v_discrepancy,
      'healthy', v_discrepancy < 0.01
    );
  ELSE
    RETURN jsonb_build_object('error', 'p_canonical_user_id required');
  END IF;
END;
$function$;

-- Drop more obsolete functions
DROP FUNCTION IF EXISTS sync_external_wallet_balances(text) CASCADE;

-- ============================================================
-- PHASE 9: Verification
-- ============================================================

DO $$
DECLARE
  usdc_count INT;
  usdc_tx_count INT;
  usdc_orders_count INT;
  trigger_count INT;
BEGIN
  -- Check for any remaining USDC rows in sub_account_balances
  SELECT COUNT(*) INTO usdc_count FROM sub_account_balances WHERE currency = 'USDC';
  IF usdc_count > 0 THEN
    RAISE WARNING 'Still have % USDC rows remaining in sub_account_balances!', usdc_count;
  ELSE
    RAISE NOTICE '✓ No USDC rows remain in sub_account_balances';
  END IF;

  -- Check for any remaining USDC rows in user_transactions
  SELECT COUNT(*) INTO usdc_tx_count FROM user_transactions WHERE currency = 'USDC';
  IF usdc_tx_count > 0 THEN
    RAISE WARNING 'Still have % USDC rows remaining in user_transactions!', usdc_tx_count;
  ELSE
    RAISE NOTICE '✓ No USDC rows remain in user_transactions';
  END IF;

  -- Check for any remaining USDC rows in orders
  SELECT COUNT(*) INTO usdc_orders_count FROM orders WHERE currency = 'USDC';
  IF usdc_orders_count > 0 THEN
    RAISE WARNING 'Still have % USDC rows remaining in orders!', usdc_orders_count;
  ELSE
    RAISE NOTICE '✓ No USDC rows remain in orders';
  END IF;

  -- Check that problematic triggers are gone
  SELECT COUNT(*) INTO trigger_count 
  FROM pg_trigger 
  WHERE tgrelid = 'balance_ledger'::regclass 
  AND tgname = 'trg_balance_ledger_sync_wallet';
  
  IF trigger_count > 0 THEN
    RAISE WARNING 'trg_balance_ledger_sync_wallet still exists!';
  ELSE
    RAISE NOTICE '✓ balance_ledger no longer syncs back to sub_account_balances';
  END IF;

  RAISE NOTICE '✓ Migration complete: canonical_users.usdc_balance renamed to available_balance';
  RAISE NOTICE '✓ sub_account_balances is now the sole source of truth';
  RAISE NOTICE '✓ balance_ledger is now a passive audit log';
END $$;

COMMIT;
