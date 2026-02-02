-- Add instant_wallet_topup to trigger skip list for explicit handling
-- 
-- instant_wallet_topup is used by the /api/instant-topup endpoint which:
-- 1. Credits balance via credit_balance_with_first_deposit_bonus RPC directly
-- 2. Creates user_transactions record with payment_provider='instant_wallet_topup'
-- 3. Should NOT be processed by balance triggers (to avoid double-crediting)
--
-- This migration makes the skip explicit rather than implicit (via unknown provider handler)

-- ============================================================================
-- UPDATE: post_user_transaction_to_balance()
-- ============================================================================

CREATE OR REPLACE FUNCTION public.post_user_transaction_to_balance()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_currency text;
  v_effect numeric;
  v_bal_id uuid;
  v_currency_final text;
BEGIN
  -- Skip if already posted to balance
  IF NEW.posted_to_balance = true THEN
    RETURN NEW;
  END IF;

  -- Skip if not completed
  IF NEW.status <> 'completed' THEN
    RETURN NEW;
  END IF;

  -- CRITICAL: Skip external crypto payments and instant wallet top-ups
  -- These payment providers mean the user paid externally (on-chain or via payment gateway)
  -- OR the endpoint already credited the balance via RPC
  IF NEW.payment_provider IN (
    'base_account',           -- Base Account SDK payments (on-chain USDC)
    'coinbase_commerce',      -- Coinbase Commerce payments
    'coinbase',              -- Coinbase Pay
    'privy_base_wallet',     -- Privy wallet payments
    'onchainkit',            -- OnchainKit payments
    'onchainkit_checkout',   -- OnchainKit checkout
    'instant_wallet_topup'   -- Instant wallet top-up (handled by /api/instant-topup endpoint)
  ) THEN
    -- Mark as posted to prevent reprocessing, but don't modify balance
    NEW.posted_to_balance := true;
    RETURN NEW;
  END IF;

  -- ONLY process balance payments and onramp top-ups
  -- balance = user paying from their existing balance (type=entry debits, type=topup credits)
  -- onramp = Coinbase Onramp adding funds to balance (type=topup credits)
  IF NEW.payment_provider NOT IN ('balance', 'onramp', 'coinbase_onramp') THEN
    -- Unknown/other payment provider - skip to be safe
    NEW.posted_to_balance := true;
    RETURN NEW;
  END IF;

  -- Determine currency
  BEGIN
    EXECUTE 'SELECT ($1).' || quote_ident('currency')
    INTO v_currency
    USING NEW;
  EXCEPTION WHEN others THEN
    v_currency := NULL;
  END;

  v_currency_final := COALESCE(v_currency, NEW.metadata->>'currency', 'USD');

  -- Calculate balance effect
  IF NEW.type IN ('entry','payment') THEN
    -- Entry/payment: DEBIT (subtract from balance)
    v_effect := - NEW.amount;
  ELSIF NEW.type IN ('topup','refund','adjustment') THEN
    -- Top-up/refund: CREDIT (add to balance)
    v_effect := NEW.amount;
  ELSE
    -- Unknown type - no effect
    v_effect := 0;
  END IF;

  -- Only proceed if there's an effect
  IF v_effect != 0 THEN
    -- Ensure balance row exists
    PERFORM public.ensure_sub_account_balance_row(NEW.canonical_user_id, v_currency_final);
    
    -- Get balance record
    SELECT id INTO v_bal_id
    FROM public.sub_account_balances
    WHERE canonical_user_id = NEW.canonical_user_id
      AND currency = v_currency_final
    LIMIT 1;

    -- Update balance
    UPDATE public.sub_account_balances b
    SET available_balance = b.available_balance + v_effect,
        last_updated = NOW()
    WHERE b.id = v_bal_id;
  END IF;

  -- Mark as posted
  NEW.posted_to_balance := true;
  IF NEW.completed_at IS NULL THEN
    NEW.completed_at := NOW();
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.post_user_transaction_to_balance() IS 
'Trigger function that posts completed transactions to sub_account_balance.
ONLY processes:
- payment_provider=balance (user paying from balance)
- payment_provider=onramp/coinbase_onramp (Coinbase Onramp top-ups)

SKIPS external crypto payments and instant_wallet_topup:
- base_account, coinbase_commerce, privy_base_wallet, etc.
- instant_wallet_topup (handled by /api/instant-topup endpoint via RPC)
These are already paid on-chain/externally or credited via endpoint RPC.';

-- ============================================================================
-- UPDATE: user_transactions_post_to_wallet()
-- ============================================================================

CREATE OR REPLACE FUNCTION public.user_transactions_post_to_wallet()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_delta numeric;
  v_before numeric;
  v_after numeric;
  v_curr text;
  v_desc text;
BEGIN
  -- Only act when status = completed and not yet posted
  IF NEW.status <> 'completed' OR COALESCE(NEW.posted_to_balance, false) IS TRUE THEN
    RETURN NEW;
  END IF;

  IF NEW.amount IS NULL OR NEW.amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  -- CRITICAL: Skip external crypto payments and instant wallet top-ups
  -- These payment providers mean the user paid externally (on-chain or via payment gateway)
  -- OR the endpoint already credited the balance via RPC
  IF NEW.payment_provider IN (
    'base_account',           -- Base Account SDK payments (on-chain USDC)
    'coinbase_commerce',      -- Coinbase Commerce payments
    'coinbase',              -- Coinbase Pay
    'privy_base_wallet',     -- Privy wallet payments
    'onchainkit',            -- OnchainKit payments
    'onchainkit_checkout',   -- OnchainKit checkout
    'instant_wallet_topup'   -- Instant wallet top-up (handled by /api/instant-topup endpoint)
  ) THEN
    -- Mark as posted to prevent reprocessing, but don't modify balance or create ledger entry
    NEW.posted_to_balance := true;
    NEW.completed_at := COALESCE(NEW.completed_at, now());
    RETURN NEW;
  END IF;

  -- ONLY process balance payments and onramp top-ups
  IF NEW.payment_provider NOT IN ('balance', 'onramp', 'coinbase_onramp') THEN
    -- Unknown/other payment provider - skip to be safe
    NEW.posted_to_balance := true;
    NEW.completed_at := COALESCE(NEW.completed_at, now());
    RETURN NEW;
  END IF;

  v_curr := COALESCE(NEW.currency, 'USDC');
  v_delta := public._wallet_delta_from_txn(NEW.type, NEW.amount);

  -- Apply to wallet
  SELECT balance_before, balance_after
    INTO v_before, v_after
  FROM public._apply_wallet_delta(NEW.canonical_user_id, v_curr, v_delta);

  -- Compose description
  v_desc := COALESCE(NEW.description,
            CASE WHEN lower(NEW.type) IN ('topup','top_up','top-up') THEN 'Wallet top up'
                 WHEN lower(NEW.type) IN ('entry','entry_payment','purchase') THEN 'Competition entry'
                 ELSE 'User transaction'
            END);

  -- Insert ledger row
  INSERT INTO public.balance_ledger (
    canonical_user_id,
    transaction_type,
    amount,
    currency,
    balance_before,
    balance_after,
    reference_id,
    description,
    created_at,
    top_up_tx_id
  ) VALUES (
    NEW.canonical_user_id,
    NEW.type,
    NEW.amount,
    v_curr,
    v_before,
    v_after,
    NEW.id::text,
    v_desc,
    now(),
    COALESCE(NEW.tx_id, NEW.payment_tx_hash)
  );

  -- Mark as posted
  NEW.posted_to_balance := true;
  NEW.completed_at := COALESCE(NEW.completed_at, now());
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.user_transactions_post_to_wallet() IS 
'Trigger function that sets balance_before/balance_after on user_transactions and creates balance_ledger entries.
ONLY processes:
- payment_provider=balance (user paying from balance)
- payment_provider=onramp/coinbase_onramp (Coinbase Onramp top-ups)

SKIPS external crypto payments and instant_wallet_topup:
- base_account, coinbase_commerce, privy_base_wallet, etc.
- instant_wallet_topup (handled by /api/instant-topup endpoint via RPC)
These are already paid on-chain/externally or credited via endpoint RPC.';
