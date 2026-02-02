-- Fix post_user_transaction_to_balance trigger to SKIP crypto payments
-- 
-- Problem: The trigger was processing ALL completed transactions, including crypto payments
-- from base_account, coinbase_commerce, etc. These should NOT touch sub_account_balance
-- because the user already paid externally (on-chain or via payment provider).
--
-- Only these should modify sub_account_balance:
-- 1. type='topup' with payment_provider='balance' or 'onramp' (adds money to balance)
-- 2. type='entry' with payment_provider='balance' (spends from balance)
--
-- External crypto payments should NOT be processed by this trigger at all.

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

  -- CRITICAL FIX: Skip external crypto payments
  -- These payment providers mean the user paid externally (on-chain or via payment gateway)
  -- and the payment should NOT touch their sub_account_balance
  IF NEW.payment_provider IN (
    'base_account',           -- Base Account SDK payments (on-chain USDC)
    'coinbase_commerce',      -- Coinbase Commerce payments
    'coinbase',              -- Coinbase Pay
    'privy_base_wallet',     -- Privy wallet payments
    'onchainkit',            -- OnchainKit payments
    'onchainkit_checkout'    -- OnchainKit checkout
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

-- Add comment explaining the fix
COMMENT ON FUNCTION public.post_user_transaction_to_balance() IS 
'Trigger function that posts completed transactions to sub_account_balance.
ONLY processes:
- payment_provider=balance (user paying from balance)
- payment_provider=onramp/coinbase_onramp (Coinbase Onramp top-ups)

SKIPS external crypto payments:
- base_account, coinbase_commerce, privy_base_wallet, etc.
These are already paid on-chain/externally and should not touch balance.';
