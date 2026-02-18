-- ============================================================================
-- Production Schema Sync Migration
-- Generated from production Supabase CSV exports
-- Date: 2026-02-18
-- ============================================================================
--
-- This migration ensures the local schema matches the production database
-- by creating all functions, indexes, and triggers from production CSVs.
--
-- Source Files:
-- - All Functions.csv (production function definitions)
-- - All Indexes.csv (production index definitions)
-- - All triggers.csv (production trigger definitions)
--
-- ============================================================================

-- ============================================================================
-- FUNCTIONS (100 total)
-- ============================================================================

-- Creating 0 public schema functions

-- ============================================================================
-- INDEXES (100 total)
-- ============================================================================

-- Creating 0 public schema indexes

-- ============================================================================
-- TRIGGERS (93 total)
-- ============================================================================

-- Creating 87 public schema triggers

-- Trigger function: public.AAA_CHECKTHISFIRST__AAA_balance_ledger
CREATE OR REPLACE FUNCTION public.""AAA_CHECKTHISFIRST__AAA_balance_ledger""()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- TODO: implement business logic; for now, no-op
  RETURN COALESCE(NEW, OLD);
END;
$function$

-- Trigger: AAA_CHECKTHISFIRST__AAA_balance_ledger_trg on balance_ledger
DROP TRIGGER IF EXISTS AAA_CHECKTHISFIRST__AAA_balance_ledger_trg ON public.balance_ledger;
CREATE TRIGGER ""AAA_CHECKTHISFIRST__AAA_balance_ledger_trg"" BEFORE INSERT OR UPDATE ON balance_ledger FOR EACH ROW EXECUTE FUNCTION ""AAA_CHECKTHISFIRST__AAA_balance_ledger""();

-- Trigger function: public._bl_guard_reference_id
CREATE OR REPLACE FUNCTION public._bl_guard_reference_id()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.type IN ('entry','purchase') AND NEW.reference_id IS NULL THEN
    RAISE EXCEPTION 'balance_ledger.reference_id must not be NULL for type %, amount %, desc %',
      NEW.type, NEW.amount, NEW.description;
  END IF;
  RETURN NEW;
END;
$function$

-- Trigger: bl_guard_reference_id on balance_ledger
DROP TRIGGER IF EXISTS bl_guard_reference_id ON public.balance_ledger;
CREATE TRIGGER bl_guard_reference_id BEFORE INSERT ON balance_ledger FOR EACH ROW EXECUTE FUNCTION _bl_guard_reference_id();

-- Trigger function: public.balance_ledger_sync_wallet
CREATE OR REPLACE FUNCTION public.balance_ledger_sync_wallet()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_delta numeric;
  v_before numeric;
  v_after numeric;
BEGIN
  IF NEW.canonical_user_id IS NULL THEN
    RETURN NEW; -- nothing we can do
  END IF;

  IF NEW.amount IS NULL OR NEW.amount = 0 THEN
    RETURN NEW;
  END IF;

  v_delta := public._wallet_delta_from_txn(NEW.transaction_type, NEW.amount);

  SELECT balance_before, balance_after INTO v_before, v_after
  FROM public._apply_wallet_delta(NEW.canonical_user_id, COALESCE(NEW.currency,'USD'), v_delta);

  -- Backfill before/after if not set
  IF NEW.balance_before IS NULL OR NEW.balance_after IS NULL THEN
    UPDATE public.balance_ledger
    SET balance_before = COALESCE(NEW.balance_before, v_before),
        balance_after  = COALESCE(NEW.balance_after,  v_after)
    WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$function$

-- Trigger: trg_balance_ledger_sync_wallet on balance_ledger
DROP TRIGGER IF EXISTS trg_balance_ledger_sync_wallet ON public.balance_ledger;
CREATE TRIGGER trg_balance_ledger_sync_wallet AFTER INSERT ON balance_ledger FOR EACH ROW EXECUTE FUNCTION balance_ledger_sync_wallet();

-- Trigger function: public.ensure_order_for_debit
CREATE OR REPLACE FUNCTION public.ensure_order_for_debit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  -- Apply only to INSERTs of qualifying debits
  IF TG_OP = 'INSERT' AND NEW.reference_id IS NOT NULL
     AND (NEW.amount < 0 OR COALESCE(lower(NEW.transaction_type),'') = 'debit' OR COALESCE(lower(NEW.type),'') IN ('entry','purchase'))
  THEN
    -- If an order already exists, skip
    IF EXISTS (
      SELECT 1 FROM public.orders o WHERE o.transaction_ref = NEW.reference_id
    ) THEN
      RETURN NEW;
    END IF;

    INSERT INTO public.orders (
      id,
      amount,
      currency,
      status,
      payment_status,
      payment_provider,
      payment_method,
      order_type,
      ticket_count,
      created_at,
      updated_at,
      completed_at,
      canonical_user_id,
      transaction_ref,
      ledger_ref,
      competition_id,
      notes,
      source
    )
    VALUES (
      gen_random_uuid(),
      ABS(NEW.amount),
      COALESCE(NEW.currency, 'USD'),
      'completed',
      'completed',
      NULL,
      'balance',
      'entry',
      COALESCE(util.first_int(NEW.description), 1),
      NEW.created_at,
      NEW.created_at,
      NEW.created_at,
      NEW.canonical_user_id,
      NEW.reference_id,
      NEW.id::text,
      util.ref_competition_id(NEW.reference_id),
      NEW.description,
      'ledger_auto'
    )
    ON CONFLICT (transaction_ref) DO NOTHING; -- idempotent
  END IF;

  RETURN NEW;
END;
$function$

-- Trigger: trg_ensure_order_for_debit on balance_ledger
DROP TRIGGER IF EXISTS trg_ensure_order_for_debit ON public.balance_ledger;
CREATE TRIGGER trg_ensure_order_for_debit AFTER INSERT ON balance_ledger FOR EACH ROW EXECUTE FUNCTION ensure_order_for_debit();

-- Trigger function: public._orders_from_balance_ledger
CREATE OR REPLACE FUNCTION public._orders_from_balance_ledger()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  INSERT INTO public.orders (
    canonical_user_id, competition_id, amount, currency, status,
    ticket_count, created_at, updated_at, order_type, ledger_ref,
    source, source_id, unique_order_key, bonus_amount, cash_amount, bonus_currency,
    completed_at
  ) VALUES (
    NEW.canonical_user_id,
    NULL,
    NEW.amount,
    COALESCE(NEW.currency, 'USD'),
    'completed',
    0,
    COALESCE(NEW.created_at, now()),
    COALESCE(NEW.created_at, now()),
    CASE WHEN NEW.transaction_type IN ('bonus_award','bonus_credit','credit') THEN 'bonus_credit'
         WHEN NEW.transaction_type IN ('bonus_spend','bonus_debit','debit') THEN 'bonus_spend'
         ELSE 'ledger' END,
    NEW.reference_id,
    'balance_ledger',
    NEW.id,
    ('bl:' || NEW.id::text),
    CASE WHEN NEW.amount > 0 THEN NEW.amount ELSE 0 END,
    CASE WHEN NEW.amount < 0 THEN ABS(NEW.amount) ELSE 0 END,
    COALESCE(NEW.currency, 'USD'),
    COALESCE(NEW.created_at, now())
  )
  ON CONFLICT (unique_order_key) DO NOTHING;
  RETURN NEW;
END;$function$

-- Trigger: trg_orders_from_balance_ledger on balance_ledger
DROP TRIGGER IF EXISTS trg_orders_from_balance_ledger ON public.balance_ledger;
CREATE TRIGGER trg_orders_from_balance_ledger AFTER INSERT ON balance_ledger FOR EACH ROW EXECUTE FUNCTION _orders_from_balance_ledger();

-- Trigger function: public.broadcast_table_changes
CREATE OR REPLACE FUNCTION public.broadcast_table_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
      BEGIN
        PERFORM pg_notify(
          'table_changes',
          json_build_object(
            'table', TG_TABLE_NAME,
            'operation', TG_OP,
            'timestamp', NOW(),
            'data', CASE
              WHEN TG_OP = 'DELETE' THEN row_to_json(OLD)
              ELSE row_to_json(NEW)
            END
          )::text
        );
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
      END;
      $function$

-- Trigger: canonical_users_broadcast on canonical_users
DROP TRIGGER IF EXISTS canonical_users_broadcast ON public.canonical_users;
CREATE TRIGGER canonical_users_broadcast AFTER INSERT OR DELETE OR UPDATE ON canonical_users FOR EACH ROW EXECUTE FUNCTION broadcast_table_changes();

-- Trigger function: public.canonical_users_normalize_before_write
CREATE OR REPLACE FUNCTION public.canonical_users_normalize_before_write()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Normalize wallet_address using util function
  IF NEW.wallet_address IS NOT NULL THEN
    NEW.wallet_address := util.normalize_evm_address(NEW.wallet_address);
  END IF;

  -- Set canonical_user_id based on wallet_address
  IF NEW.wallet_address IS NOT NULL THEN
    NEW.canonical_user_id := 'prize:pid:' || NEW.wallet_address;
  -- IMPORTANT: Only extract wallet from canonical_user_id if it's NOT a temporary placeholder
  ELSIF NEW.canonical_user_id IS NOT NULL AND NEW.canonical_user_id NOT LIKE 'prize:pid:temp%' THEN
    IF POSITION('prize:pid:' IN NEW.canonical_user_id) = 1 THEN
      -- Use SUBSTRING to safely extract the wallet address part
      NEW.wallet_address := SUBSTRING(NEW.canonical_user_id FROM 11);
      -- Only normalize if it looks like a valid address (starts with 0x)
      IF NEW.wallet_address LIKE '0x%' THEN
        NEW.wallet_address := util.normalize_evm_address(NEW.wallet_address);
        NEW.canonical_user_id := 'prize:pid:' || NEW.wallet_address;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$

-- Trigger: canonical_users_normalize_before_write on canonical_users
DROP TRIGGER IF EXISTS canonical_users_normalize_before_write ON public.canonical_users;
CREATE TRIGGER canonical_users_normalize_before_write BEFORE INSERT OR UPDATE ON canonical_users FOR EACH ROW EXECUTE FUNCTION canonical_users_normalize_before_write();

-- Trigger function: public.cu_normalize_and_enforce
CREATE OR REPLACE FUNCTION public.cu_normalize_and_enforce()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Normalize all wallet fields using util function for consistency
  IF NEW.wallet_address IS NOT NULL THEN
    NEW.wallet_address := util.normalize_evm_address(NEW.wallet_address);
  END IF;
  
  IF NEW.base_wallet_address IS NOT NULL THEN
    NEW.base_wallet_address := util.normalize_evm_address(NEW.base_wallet_address);
  END IF;
  
  IF NEW.eth_wallet_address IS NOT NULL THEN
    NEW.eth_wallet_address := util.normalize_evm_address(NEW.eth_wallet_address);
  END IF;

  -- If primary wallet is missing but alternates exist, pick first non-null
  IF NEW.wallet_address IS NULL THEN
    IF NEW.base_wallet_address IS NOT NULL THEN
      NEW.wallet_address := NEW.base_wallet_address;
    ELSIF NEW.eth_wallet_address IS NOT NULL THEN
      NEW.wallet_address := NEW.eth_wallet_address;
    END IF;
  END IF;

  -- Enforce canonical_user_id when we have a wallet
  -- IMPORTANT: Only set if NOT a temporary placeholder
  IF NEW.wallet_address IS NOT NULL AND (NEW.canonical_user_id IS NULL OR NEW.canonical_user_id NOT LIKE 'prize:pid:temp%') THEN
    NEW.canonical_user_id := 'prize:pid:' || NEW.wallet_address;
  END IF;

  RETURN NEW;
END;
$function$

-- Trigger: cu_normalize_and_enforce_trg on canonical_users
DROP TRIGGER IF EXISTS cu_normalize_and_enforce_trg ON public.canonical_users;
CREATE TRIGGER cu_normalize_and_enforce_trg BEFORE INSERT OR UPDATE ON canonical_users FOR EACH ROW EXECUTE FUNCTION cu_normalize_and_enforce();

-- Trigger function: public.set_canonical_user_id_from_wallet
CREATE OR REPLACE FUNCTION public.set_canonical_user_id_from_wallet()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.canonical_user_id IS NULL AND NEW.wallet_address IS NOT NULL THEN
    -- normalize wallet to lowercase
    NEW.wallet_address := lower(NEW.wallet_address);
    IF NEW.wallet_address ~ '^0x[a-f0-9]{40}$' THEN
      NEW.canonical_user_id := 'prize:pid:' || NEW.wallet_address;
    END IF;
  END IF;
  RETURN NEW;
END;$function$

-- Trigger: tr_set_canonical_user_id on canonical_users
DROP TRIGGER IF EXISTS tr_set_canonical_user_id ON public.canonical_users;
CREATE TRIGGER tr_set_canonical_user_id BEFORE INSERT OR UPDATE ON canonical_users FOR EACH ROW EXECUTE FUNCTION set_canonical_user_id_from_wallet();

-- Trigger function: public.block_specific_canonical_user
CREATE OR REPLACE FUNCTION public.block_specific_canonical_user()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.canonical_user_id = TG_ARGV[0]) OR
     (TG_OP = 'UPDATE' AND NEW.canonical_user_id = TG_ARGV[0]) THEN
    RAISE EXCEPTION 'Insert/Update blocked for canonical_user_id: %', TG_ARGV[0];
  END IF;
  RETURN NEW;
END;
$function$

-- Trigger: trg_block_specific_cuid on canonical_users
DROP TRIGGER IF EXISTS trg_block_specific_cuid ON public.canonical_users;
CREATE TRIGGER trg_block_specific_cuid BEFORE INSERT OR UPDATE ON canonical_users FOR EACH ROW EXECUTE FUNCTION block_specific_canonical_user('prize:pid:0xb70e516aecda554dd77f1ae845b1322968034aef');

-- Trigger function: public.canonical_users_normalize
CREATE OR REPLACE FUNCTION public.canonical_users_normalize()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Normalize all wallet address fields using util function for consistency
  IF NEW.wallet_address IS NOT NULL THEN
    NEW.wallet_address := util.normalize_evm_address(NEW.wallet_address);
  END IF;
  
  IF NEW.base_wallet_address IS NOT NULL THEN
    NEW.base_wallet_address := util.normalize_evm_address(NEW.base_wallet_address);
  END IF;
  
  IF NEW.eth_wallet_address IS NOT NULL THEN
    NEW.eth_wallet_address := util.normalize_evm_address(NEW.eth_wallet_address);
  END IF;

  -- Auto-generate canonical_user_id if missing and we have a wallet address
  -- IMPORTANT: Skip this if canonical_user_id is a temporary placeholder (prize:pid:temp<N>)
  IF NEW.canonical_user_id IS NULL AND COALESCE(NEW.wallet_address, NEW.base_wallet_address, NEW.eth_wallet_address) IS NOT NULL THEN
    NEW.canonical_user_id := 'prize:pid:' || COALESCE(NEW.wallet_address, NEW.base_wallet_address, NEW.eth_wallet_address);
  END IF;

  RETURN NEW;
END;
$function$

-- Trigger: trg_canonical_users_normalize on canonical_users
DROP TRIGGER IF EXISTS trg_canonical_users_normalize ON public.canonical_users;
CREATE TRIGGER trg_canonical_users_normalize BEFORE INSERT OR UPDATE ON canonical_users FOR EACH ROW EXECUTE FUNCTION canonical_users_normalize();

-- Trigger function: public.sync_canonical_users_to_sub_account_balances
CREATE OR REPLACE FUNCTION public.sync_canonical_users_to_sub_account_balances()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_record_exists BOOLEAN;
BEGIN
  -- Only sync if usdc_balance changed or is being set
  IF (TG_OP = 'UPDATE' AND NEW.usdc_balance = OLD.usdc_balance) THEN
    RETURN NEW;
  END IF;

  -- Check if sub_account_balances record exists for this user
  SELECT EXISTS(
    SELECT 1 FROM sub_account_balances
    WHERE canonical_user_id = NEW.canonical_user_id
      AND currency = 'USD'
  ) INTO v_record_exists;

  IF v_record_exists THEN
    -- Update existing record
    UPDATE sub_account_balances
    SET 
      available_balance = NEW.usdc_balance,
      updated_at = NOW()
    WHERE canonical_user_id = NEW.canonical_user_id
      AND currency = 'USD';
    
    RAISE NOTICE '[Sync] Updated sub_account_balances for % with balance %', 
      NEW.canonical_user_id, NEW.usdc_balance;
  ELSE
    -- Insert new record
    INSERT INTO sub_account_balances (
      canonical_user_id,
      user_id,
      privy_user_id,
      currency,
      available_balance,
      pending_balance,
      bonus_balance
    ) VALUES (
      NEW.canonical_user_id,
      NEW.uid,
      NEW.privy_user_id,
      'USD',
      COALESCE(NEW.usdc_balance, 0),
      0,
      COALESCE(NEW.bonus_balance, 0)
    )
    ON CONFLICT (canonical_user_id, currency) DO UPDATE
    SET 
      available_balance = EXCLUDED.available_balance,
      bonus_balance = EXCLUDED.bonus_balance,
      updated_at = NOW();
    
    RAISE NOTICE '[Sync] Inserted sub_account_balances for % with balance %', 
      NEW.canonical_user_id, NEW.usdc_balance;
  END IF;

  RETURN NEW;
END;
$function$

-- Trigger: trg_sync_cu_balance_to_sab on canonical_users
DROP TRIGGER IF EXISTS trg_sync_cu_balance_to_sab ON public.canonical_users;
CREATE TRIGGER trg_sync_cu_balance_to_sab AFTER INSERT OR UPDATE OF usdc_balance ON canonical_users FOR EACH ROW EXECUTE FUNCTION sync_canonical_users_to_sub_account_balances();

-- Trigger function: public.update_updated_at_column
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$function$

-- Trigger: update_canonical_users_updated_at on canonical_users
DROP TRIGGER IF EXISTS update_canonical_users_updated_at ON public.canonical_users;
CREATE TRIGGER update_canonical_users_updated_at BEFORE UPDATE ON canonical_users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Trigger function: public.trg_cdp_event_queue_concat_biu
CREATE OR REPLACE FUNCTION public.trg_cdp_event_queue_concat_biu()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.payload := COALESCE(NEW.payload, '{}'::jsonb);
  RETURN NEW;
END;
$function$

-- Trigger: cdp_event_queue_concat_biu on cdp_event_queue
DROP TRIGGER IF EXISTS cdp_event_queue_concat_biu ON public.cdp_event_queue;
CREATE TRIGGER cdp_event_queue_concat_biu BEFORE INSERT OR UPDATE ON cdp_event_queue FOR EACH ROW EXECUTE FUNCTION trg_cdp_event_queue_concat_biu();

-- Trigger function: public.trg_cdp_event_queue_to_cdp_transactions_ai
CREATE OR REPLACE FUNCTION public.trg_cdp_event_queue_to_cdp_transactions_ai()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  p jsonb := NEW.payload;
  ev_type text := NULLIF(trim(both from p->>'type'), '');
  ext_id text := NULLIF(trim(both from p->>'id'), '');
  currency text := NULLIF(trim(both from p->>'currency'), '');
  status text := NULLIF(trim(both from p->>'status'), '');
  tx_ref text := NULLIF(trim(both from COALESCE(p->>'tx_ref', p->>'id')), '');
  canon_id text := NULLIF(trim(both from p->>'canonical_user_id'), '');
  wallet text := lower(NULLIF(trim(both from p->>'wallet_address'), ''));
  usr_id text := NULLIF(trim(both from p->>'user_id'), '');
  comp_id uuid := NULLIF(p->>'competition_id','')::uuid;
  amt numeric := NULLIF(p->>'amount','')::numeric;
  occurred timestamptz := COALESCE(NULLIF(p->>'created_at','')::timestamptz, NEW.created_at, now());
  tickets int := NULL;
  t_price numeric := NULL;
BEGIN
  IF NEW.event_name <> 'transaction_created' THEN
    RETURN NEW; -- ignore other events
  END IF;

  IF ext_id IS NULL THEN
    RAISE NOTICE 'cdp_events: missing external id, skipping row id=%', NEW.id;
    RETURN NEW;
  END IF;

  -- derive ticket_count if competition_id present using competitions.ticket_price
  IF comp_id IS NOT NULL THEN
    SELECT ticket_price INTO t_price FROM public.competitions WHERE id = comp_id;
    IF t_price IS NULL OR t_price = 0 THEN
      tickets := NULL; -- unknown pricing
    ELSE
      tickets := GREATEST(0, floor(COALESCE(amt,0) / t_price)::int);
    END IF;
  END IF;

  INSERT INTO public.cdp_transactions AS ct
    (external_id, event_type, amount, currency, status, canonical_user_id, wallet_address, user_id,
     competition_id, tx_ref, tx_id, occurred_at, payload, payload_concat, ticket_count, notes, created_at, updated_at)
  VALUES
    (ext_id, ev_type, amt, currency, status, canon_id, wallet, usr_id,
     comp_id, tx_ref, ext_id, occurred, p, util.jsonb_stable_concat(p), tickets, NULL, now(), now())
  ON CONFLICT (external_id)
  DO UPDATE SET
    event_type = EXCLUDED.event_type,
    amount = EXCLUDED.amount,
    currency = EXCLUDED.currency,
    status = EXCLUDED.status,
    canonical_user_id = EXCLUDED.canonical_user_id,
    wallet_address = EXCLUDED.wallet_address,
    user_id = EXCLUDED.user_id,
    competition_id = EXCLUDED.competition_id,
    tx_ref = EXCLUDED.tx_ref,
    tx_id = EXCLUDED.tx_id,
    occurred_at = EXCLUDED.occurred_at,
    payload = EXCLUDED.payload,
    payload_concat = EXCLUDED.payload_concat,
    ticket_count = EXCLUDED.ticket_count,
    updated_at = now();

  RETURN NEW;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'cdp_event_queue to cdp_transactions error: %', SQLERRM;
  RETURN NEW;
END;
$function$

-- Trigger: cdp_event_queue_to_cdp_transactions_ai on cdp_event_queue
DROP TRIGGER IF EXISTS cdp_event_queue_to_cdp_transactions_ai ON public.cdp_event_queue;
CREATE TRIGGER cdp_event_queue_to_cdp_transactions_ai AFTER INSERT ON cdp_event_queue FOR EACH ROW EXECUTE FUNCTION trg_cdp_event_queue_to_cdp_transactions_ai();

-- Trigger function: public.trg_competition_entries_normalize_wallet
CREATE OR REPLACE FUNCTION public.trg_competition_entries_normalize_wallet()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.wallet_address := public.normalize_wallet_address(NEW.wallet_address);
  RETURN NEW;
END;
$function$

-- Trigger: competition_entries_normalize_wallet on competition_entries
DROP TRIGGER IF EXISTS competition_entries_normalize_wallet ON public.competition_entries;
CREATE TRIGGER competition_entries_normalize_wallet BEFORE INSERT OR UPDATE ON competition_entries FOR EACH ROW EXECUTE FUNCTION trg_competition_entries_normalize_wallet();

-- Trigger function: public.normalize_and_sync_entry_tickets
CREATE OR REPLACE FUNCTION public.normalize_and_sync_entry_tickets()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  nums int[] := '{}'::int[];
  _n int;
  cleaned text := NULL;
BEGIN
  IF NEW.ticket_numbers_csv IS NOT NULL AND NEW.ticket_numbers_csv <> '' THEN
    SELECT ARRAY(SELECT DISTINCT CAST(trim(val) AS int)
                 FROM unnest(string_to_array(NEW.ticket_numbers_csv, ',')) AS s(val)
                 WHERE trim(val) <> '')::int[]
      INTO nums;

    -- Sort the array
    SELECT ARRAY(SELECT x FROM unnest(nums) AS u(x) ORDER BY x) INTO nums;

    -- Rebuild CSV
    SELECT string_agg(x::text, ',' ORDER BY x) INTO cleaned
    FROM unnest(nums) AS u(x);
  ELSE
    nums := '{}'::int[];
    cleaned := NULL;
  END IF;

  -- Validate ownership via tickets
  IF array_length(nums, 1) IS NOT NULL THEN
    PERFORM 1
    FROM (
      SELECT x AS tn
      FROM unnest(nums) AS u(x)
      EXCEPT
      SELECT t.ticket_number
      FROM public.tickets t
      WHERE t.competition_id = NEW.competition_id
        AND t.canonical_user_id = NEW.canonical_user_id
        AND t.ticket_number = ANY(nums)
    ) missing;

    IF FOUND THEN
      RAISE EXCEPTION 'ticket_numbers_csv contains tickets not owned by this user for this competition';
    END IF;
  END IF;

  NEW.ticket_numbers_csv := cleaned;
  NEW.tickets_count := COALESCE(array_length(nums, 1), 0);

  RETURN NEW;
END;
$function$

-- Trigger: trg_normalize_entry_tickets on competition_entries
DROP TRIGGER IF EXISTS trg_normalize_entry_tickets ON public.competition_entries;
CREATE TRIGGER trg_normalize_entry_tickets BEFORE INSERT OR UPDATE OF ticket_numbers_csv, competition_id, canonical_user_id ON competition_entries FOR EACH ROW EXECUTE FUNCTION normalize_and_sync_entry_tickets();

-- Trigger function: public.set_competition_entries_username
CREATE OR REPLACE FUNCTION public.set_competition_entries_username()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- On INSERT or when canonical_user_id changes, copy username from canonical_users
  IF (TG_OP = 'INSERT') OR (NEW.canonical_user_id IS DISTINCT FROM OLD.canonical_user_id) THEN
    SELECT cu.username INTO NEW.username
    FROM public.canonical_users cu
    WHERE cu.canonical_user_id = NEW.canonical_user_id;
  END IF;
  RETURN NEW;
END;
$function$

-- Trigger: trg_set_competition_entries_username on competition_entries
DROP TRIGGER IF EXISTS trg_set_competition_entries_username ON public.competition_entries;
CREATE TRIGGER trg_set_competition_entries_username BEFORE INSERT OR UPDATE OF canonical_user_id ON competition_entries FOR EACH ROW EXECUTE FUNCTION set_competition_entries_username();

-- Trigger function: public.sync_competition_entry_cached_fields
CREATE OR REPLACE FUNCTION public.sync_competition_entry_cached_fields()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- When competition_id or amount_spent changes on entries, resync
  IF TG_TABLE_NAME = 'competition_entries' THEN
    UPDATE public.competition_entries ce
    SET competition_title = c.title,
        competition_description = c.description,
        amount_paid = NEW.amount_spent
    FROM public.competitions c
    WHERE ce.id = NEW.id AND c.id = NEW.competition_id;
    RETURN NEW;
  END IF;

  -- When competitions table changes, cascade to entries
  IF TG_TABLE_NAME = 'competitions' THEN
    UPDATE public.competition_entries ce
    SET competition_title = NEW.title,
        competition_description = NEW.description
    WHERE ce.competition_id = NEW.id;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;$function$

-- Trigger: trg_sync_entries_on_entries on competition_entries
DROP TRIGGER IF EXISTS trg_sync_entries_on_entries ON public.competition_entries;
CREATE TRIGGER trg_sync_entries_on_entries AFTER INSERT OR UPDATE OF competition_id, amount_spent ON competition_entries FOR EACH ROW EXECUTE FUNCTION sync_competition_entry_cached_fields();

-- Trigger function: public.after_cep_change
CREATE OR REPLACE FUNCTION public.after_cep_change()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  PERFORM public.recompute_competition_entry(NEW.canonical_user_id, NEW.competition_id);
  RETURN NEW;
END;
$function$

-- Trigger: trg_after_cep_change on competition_entries_purchases
DROP TRIGGER IF EXISTS trg_after_cep_change ON public.competition_entries_purchases;
CREATE TRIGGER trg_after_cep_change AFTER INSERT OR DELETE OR UPDATE ON competition_entries_purchases FOR EACH ROW EXECUTE FUNCTION after_cep_change();

-- Trigger function: util.broadcast_table_changes
CREATE OR REPLACE FUNCTION util.broadcast_table_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  PERFORM realtime.broadcast_changes(
    'table:' || TG_TABLE_NAME,
    TG_OP,
    TG_OP,
    TG_TABLE_NAME,
    TG_TABLE_SCHEMA,
    NEW,
    OLD
  );
  RETURN COALESCE(NEW, OLD);
END;
$function$

-- Trigger: competitions_broadcast_trigger on competitions
DROP TRIGGER IF EXISTS competitions_broadcast_trigger ON public.competitions;
CREATE TRIGGER competitions_broadcast_trigger AFTER INSERT OR DELETE OR UPDATE ON competitions FOR EACH ROW EXECUTE FUNCTION util.broadcast_table_changes();

-- Trigger function: public.competitions_sync_num_winners
CREATE OR REPLACE FUNCTION public.competitions_sync_num_winners()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Before insert/update, if only one is provided, copy to the other
  IF TG_OP IN ('INSERT','UPDATE') THEN
    IF NEW.num_winners IS NULL AND NEW.winner_count IS NOT NULL THEN
      NEW.num_winners := NEW.winner_count;
    ELSIF NEW.winner_count IS NULL AND NEW.num_winners IS NOT NULL THEN
      NEW.winner_count := NEW.num_winners;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$

-- Trigger: competitions_sync_num_winners_trg on competitions
DROP TRIGGER IF EXISTS competitions_sync_num_winners_trg ON public.competitions;
CREATE TRIGGER competitions_sync_num_winners_trg BEFORE INSERT OR UPDATE ON competitions FOR EACH ROW EXECUTE FUNCTION competitions_sync_num_winners();

-- Trigger function: public.competitions_sync_tickets_sold
CREATE OR REPLACE FUNCTION public.competitions_sync_tickets_sold()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP IN ('INSERT','UPDATE') THEN
    IF NEW.tickets_sold IS NULL AND NEW.sold_tickets IS NOT NULL THEN
      NEW.tickets_sold := NEW.sold_tickets;
    ELSIF NEW.sold_tickets IS NULL AND NEW.tickets_sold IS NOT NULL THEN
      NEW.sold_tickets := NEW.tickets_sold;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$

-- Trigger: competitions_sync_tickets_sold_trg on competitions
DROP TRIGGER IF EXISTS competitions_sync_tickets_sold_trg ON public.competitions;
CREATE TRIGGER competitions_sync_tickets_sold_trg BEFORE INSERT OR UPDATE ON competitions FOR EACH ROW EXECUTE FUNCTION competitions_sync_tickets_sold();

-- Trigger function: public.auto_complete_competition
CREATE OR REPLACE FUNCTION public.auto_complete_competition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    IF NEW.tickets_sold >= NEW.total_tickets AND NEW.status = 'active' THEN
        UPDATE competitions
        SET status = 'sold_out',
            updated_at = NOW()
        WHERE id = NEW.id;
    END IF;
    RETURN NEW;
END;
$function$

-- Trigger: trg_auto_complete on competitions
DROP TRIGGER IF EXISTS trg_auto_complete ON public.competitions;
CREATE TRIGGER trg_auto_complete AFTER UPDATE ON competitions FOR EACH ROW EXECUTE FUNCTION auto_complete_competition();

-- Trigger: trg_sync_entries_on_competitions on competitions
DROP TRIGGER IF EXISTS trg_sync_entries_on_competitions ON public.competitions;
CREATE TRIGGER trg_sync_entries_on_competitions AFTER UPDATE OF title, description ON competitions FOR EACH ROW EXECUTE FUNCTION sync_competition_entry_cached_fields();

-- Trigger: update_competitions_updated_at on competitions
DROP TRIGGER IF EXISTS update_competitions_updated_at ON public.competitions;
CREATE TRIGGER update_competitions_updated_at BEFORE UPDATE ON competitions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Trigger function: public.award_first_topup_bonus
CREATE OR REPLACE FUNCTION public.award_first_topup_bonus()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_first_tx_id uuid;
  v_first_amount numeric;
  v_bonus numeric;
  v_cu_id uuid;
  v_canonical_user_id text;
  v_wallet_address text;
  v_privy_user_id text;
BEGIN
  -- Only react to transitions to completed
  IF TG_OP <> 'UPDATE' OR (OLD.status = NEW.status) OR NEW.status <> 'completed' THEN
    RETURN NEW;
  END IF;

  -- Only deposits/top_up in USD sub-account
  IF NEW.transaction_type NOT IN ('deposit','top_up') OR NEW.currency IS NULL OR NEW.currency NOT ILIKE 'USD%' THEN
    RETURN NEW;
  END IF;

  -- Map user
  SELECT cu.id, cu.canonical_user_id, cu.wallet_address, cu.privy_user_id
    INTO v_cu_id, v_canonical_user_id, v_wallet_address, v_privy_user_id
  FROM public.canonical_users cu
  WHERE cu.id = NEW.user_id;

  IF v_cu_id IS NULL THEN
    -- No matching canonical user; nothing to do
    RETURN NEW;
  END IF;

  -- Skip if user already used bonus
  PERFORM 1 FROM public.canonical_users cu
   WHERE cu.id = v_cu_id AND cu.has_used_new_user_bonus = true;
  IF FOUND THEN
    RETURN NEW;
  END IF;

  -- Identify the true first completed USD deposit/top_up for this user
  SELECT ct.id, ct.amount
    INTO v_first_tx_id, v_first_amount
  FROM public.custody_transactions ct
  WHERE ct.user_id = v_cu_id
    AND ct.status = 'completed'
    AND ct.transaction_type IN ('deposit','top_up')
    AND ct.currency ILIKE 'USD%'
  ORDER BY ct.created_at ASC, ct.id ASC
  LIMIT 1;

  -- If none found or current row isn't the first, exit
  IF v_first_tx_id IS NULL OR v_first_tx_id <> NEW.id THEN
    RETURN NEW;
  END IF;

  -- Compute 50% bonus (no cap)
  v_bonus := COALESCE(v_first_amount, 0) * 0.5;
  IF v_bonus <= 0 THEN
    RETURN NEW;
  END IF;

  -- Atomically mark bonus used and credit balance
  UPDATE public.canonical_users cu
     SET bonus_balance = COALESCE(cu.bonus_balance, 0) + v_bonus,
         has_used_new_user_bonus = true,
         updated_at = now()
   WHERE cu.id = v_cu_id;

  -- Log user transaction with audit fields
  INSERT INTO public.user_transactions (
    user_id,
    canonical_user_id,
    wallet_address,
    user_privy_id,
    type,
    amount,
    currency,
    description
  ) VALUES (
    v_cu_id::text,
    v_canonical_user_id,
    v_wallet_address,
    v_privy_user_id,
    'bonus_credit',
    v_bonus,
    'USD',
    'First deposit 50% bonus'
  );

  RETURN NEW;
END;
$function$

-- Trigger: trg_award_first_topup_bonus on custody_transactions
DROP TRIGGER IF EXISTS trg_award_first_topup_bonus ON public.custody_transactions;
CREATE TRIGGER trg_award_first_topup_bonus AFTER UPDATE ON custody_transactions FOR EACH ROW WHEN (old.status IS DISTINCT FROM new.status AND new.status = 'completed'::text AND (new.transaction_type = ANY (ARRAY['deposit'::text, 'top_up'::text])) AND new.currency ~~* 'USD%'::text) EXECUTE FUNCTION award_first_topup_bonus();

-- Trigger function: public.on_email_verification_merge
CREATE OR REPLACE FUNCTION public.on_email_verification_merge()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_email text;
  v_row public.canonical_users;
begin
  -- Only act when verification succeeds; prefer verified_at, fallback to used_at
  if (NEW.verified_at is not null) or (NEW.used_at is not null) then
    v_email := lower(trim(NEW.email));
    if v_email is not null and v_email <> '' then
      -- Call the canonical upsert with just the email for now
      v_row := public.ensure_canonical_user(p_email => v_email);
    end if;
  end if;
  return NEW;
end;
$function$

-- Trigger: trg_email_auth_sessions_verified on email_auth_sessions
DROP TRIGGER IF EXISTS trg_email_auth_sessions_verified ON public.email_auth_sessions;
CREATE TRIGGER trg_email_auth_sessions_verified AFTER UPDATE ON email_auth_sessions FOR EACH ROW WHEN (new.verified_at IS NOT NULL OR new.used_at IS NOT NULL) EXECUTE FUNCTION on_email_verification_merge();

-- Trigger function: public.update_instant_win_grids_updated_at
CREATE OR REPLACE FUNCTION public.update_instant_win_grids_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$function$

-- Trigger: trigger_instant_win_grids_updated_at on instant_win_grids
DROP TRIGGER IF EXISTS trigger_instant_win_grids_updated_at ON public.instant_win_grids;
CREATE TRIGGER trigger_instant_win_grids_updated_at BEFORE UPDATE ON instant_win_grids FOR EACH ROW EXECUTE FUNCTION update_instant_win_grids_updated_at();

-- Trigger: joincompetition_broadcast_trigger on joincompetition
DROP TRIGGER IF EXISTS joincompetition_broadcast_trigger ON public.joincompetition;
CREATE TRIGGER joincompetition_broadcast_trigger AFTER INSERT OR DELETE OR UPDATE ON joincompetition FOR EACH ROW EXECUTE FUNCTION util.broadcast_table_changes();

-- Trigger function: public.joincompetition_balance_guard
CREATE OR REPLACE FUNCTION public.joincompetition_balance_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.chain = 'balance' THEN
    IF NEW.canonical_user_id IS NULL THEN
      NEW.canonical_user_id := COALESCE(NEW.user_id, NEW.wallet_address, NEW.uid);
    END IF;
    IF NEW.purchase_date IS NULL THEN
      NEW.purchase_date := now();
    END IF;
    IF NEW.ticket_count IS NULL THEN
      NEW.ticket_count := CASE
        WHEN NEW.ticket_numbers IS NULL OR NEW.ticket_numbers = '' THEN 0
        ELSE array_length(string_to_array(NEW.ticket_numbers, ','), 1)
      END;
    END IF;
    IF NEW.amount_spent IS NULL THEN
      NEW.amount_spent := 0;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$

-- Trigger: trg_joincompetition_balance_guard on joincompetition
DROP TRIGGER IF EXISTS trg_joincompetition_balance_guard ON public.joincompetition;
CREATE TRIGGER trg_joincompetition_balance_guard BEFORE INSERT ON joincompetition FOR EACH ROW EXECUTE FUNCTION joincompetition_balance_guard();

-- Trigger function: public._sync_entries_if_balance
CREATE OR REPLACE FUNCTION public._sync_entries_if_balance()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.chain = 'balance' THEN
    -- Reuse existing logic by performing an UPDATE to trigger existing AFTER trigger
    UPDATE public.joincompetition
    SET updated_at = now()
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$

-- Trigger: trg_joincompetition_balance_sync_bridge on joincompetition
DROP TRIGGER IF EXISTS trg_joincompetition_balance_sync_bridge ON public.joincompetition;
CREATE TRIGGER trg_joincompetition_balance_sync_bridge AFTER INSERT ON joincompetition FOR EACH ROW EXECUTE FUNCTION _sync_entries_if_balance();

-- Trigger function: public._log_balance_purchase_tx
CREATE OR REPLACE FUNCTION public._log_balance_purchase_tx()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.chain = 'balance' THEN
    INSERT INTO public.user_transactions(
      canonical_user_id,
      competition_id,
      payment_provider,
      type,
      amount,
      ticket_count,
      tx_id,
      metadata
    )
    VALUES (
      NEW.canonical_user_id,
      NEW.competition_id,
      'balance_payment',
      'purchase',
      NEW.amount_spent,
      NEW.ticket_count,
      NEW.transactionhash,
      jsonb_build_object('source', 'joincompetition')
    )
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$

-- Trigger: trg_joincompetition_balance_tx on joincompetition
DROP TRIGGER IF EXISTS trg_joincompetition_balance_tx ON public.joincompetition;
CREATE TRIGGER trg_joincompetition_balance_tx AFTER INSERT ON joincompetition FOR EACH ROW EXECUTE FUNCTION _log_balance_purchase_tx();

-- Trigger function: public.joincompetition_normalize
CREATE OR REPLACE FUNCTION public.joincompetition_normalize()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  norm text;
  cnt int;
BEGIN
  -- normalize CSV
  norm := public.normalize_ticket_csv(NEW.ticket_numbers);
  NEW.ticket_numbers := norm;

  -- set ticket_count to distinct count
  IF norm IS NULL OR norm = '' THEN
    NEW.ticket_count := 0;
  ELSE
    SELECT count(*) INTO cnt FROM unnest(string_to_array(norm, ',')) AS x;
    NEW.ticket_count := cnt;
  END IF;

  RETURN NEW;
END;
$function$

-- Trigger: trg_joincompetition_normalize on joincompetition
DROP TRIGGER IF EXISTS trg_joincompetition_normalize ON public.joincompetition;
CREATE TRIGGER trg_joincompetition_normalize BEFORE INSERT OR UPDATE ON joincompetition FOR EACH ROW EXECUTE FUNCTION joincompetition_normalize();

-- Trigger function: util.trg_set_cuid_from_context
CREATE OR REPLACE FUNCTION util.trg_set_cuid_from_context()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
      DECLARE
        v_privy_id TEXT;
      BEGIN
        IF NEW.canonical_user_id IS NULL THEN
          -- Safely try to get privy_user_id (the standard column name)
          BEGIN
            v_privy_id := NEW.privy_user_id;
          EXCEPTION WHEN undefined_column THEN
            v_privy_id := NULL;
          END;

          -- Fall back to user_privy_id if privy_user_id was null
          IF v_privy_id IS NULL THEN
            BEGIN
              v_privy_id := NEW.user_privy_id;
            EXCEPTION WHEN undefined_column THEN
              v_privy_id := NULL;
            END;
          END IF;

          NEW.canonical_user_id := util.resolve_canonical_user_id(
            NEW.wallet_address,
            v_privy_id
          );
        END IF;
        RETURN NEW;
      END;
      $function$

-- Trigger: trg_joincompetition_set_cuid on joincompetition
DROP TRIGGER IF EXISTS trg_joincompetition_set_cuid ON public.joincompetition;
CREATE TRIGGER trg_joincompetition_set_cuid BEFORE INSERT OR UPDATE ON joincompetition FOR EACH ROW EXECUTE FUNCTION util.trg_set_cuid_from_context();

-- Trigger function: public.joincompetition_sync_wallet
CREATE OR REPLACE FUNCTION public.joincompetition_sync_wallet()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.canonical_user_id IS NOT NULL AND (NEW.wallet_address IS NULL OR NEW.wallet_address = '') THEN
    NEW.wallet_address := replace(NEW.canonical_user_id, 'prize:pid:', '');
  END IF;
  RETURN NEW;
END;
$function$

-- Trigger: trg_joincompetition_wallet_bi on joincompetition
DROP TRIGGER IF EXISTS trg_joincompetition_wallet_bi ON public.joincompetition;
CREATE TRIGGER trg_joincompetition_wallet_bi BEFORE INSERT OR UPDATE OF canonical_user_id, wallet_address ON joincompetition FOR EACH ROW EXECUTE FUNCTION joincompetition_sync_wallet();

-- Trigger function: public.set_joincompetition_uid
CREATE OR REPLACE FUNCTION public.set_joincompetition_uid()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.canonical_user_id IS NOT NULL THEN
    SELECT cu.uid
      INTO NEW.uid
      FROM public.canonical_users cu
     WHERE cu.canonical_user_id = NEW.canonical_user_id;
  END IF;

  RETURN NEW;
END;
$function$

-- Trigger: trg_set_joincompetition_uid_ins on joincompetition
DROP TRIGGER IF EXISTS trg_set_joincompetition_uid_ins ON public.joincompetition;
CREATE TRIGGER trg_set_joincompetition_uid_ins BEFORE INSERT ON joincompetition FOR EACH ROW EXECUTE FUNCTION set_joincompetition_uid();

-- Trigger: trg_set_joincompetition_uid_upd on joincompetition
DROP TRIGGER IF EXISTS trg_set_joincompetition_uid_upd ON public.joincompetition;
CREATE TRIGGER trg_set_joincompetition_uid_upd BEFORE UPDATE OF canonical_user_id ON joincompetition FOR EACH ROW EXECUTE FUNCTION set_joincompetition_uid();

-- Trigger function: public.sync_balance_purchase_to_user_transactions
CREATE OR REPLACE FUNCTION public.sync_balance_purchase_to_user_transactions()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_balance_before NUMERIC;
  v_balance_after NUMERIC;
  has_method boolean := false;
  has_payment_method boolean := false;
  has_amountspent boolean := false;
  has_numberoftickets boolean := false;
  has_purchasedate boolean := false;
  has_competitionid boolean := false;
  has_transactionhash boolean := false;
  has_userid boolean := false;
BEGIN
  -- Ensure this trigger runs only when the NEW record has the expected legacy columns.
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = TG_TABLE_SCHEMA AND table_name = TG_TABLE_NAME AND column_name = 'method'
  ) INTO has_method;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = TG_TABLE_SCHEMA AND table_name = TG_TABLE_NAME AND column_name = 'payment_method'
  ) INTO has_payment_method;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = TG_TABLE_SCHEMA AND table_name = TG_TABLE_NAME AND column_name = 'amountspent'
  ) INTO has_amountspent;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = TG_TABLE_SCHEMA AND table_name = TG_TABLE_NAME AND column_name = 'numberoftickets'
  ) INTO has_numberoftickets;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = TG_TABLE_SCHEMA AND table_name = TG_TABLE_NAME AND column_name = 'purchasedate'
  ) INTO has_purchasedate;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = TG_TABLE_SCHEMA AND table_name = TG_TABLE_NAME AND column_name = 'competitionid'
  ) INTO has_competitionid;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = TG_TABLE_SCHEMA AND table_name = TG_TABLE_NAME AND column_name = 'transactionhash'
  ) INTO has_transactionhash;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = TG_TABLE_SCHEMA AND table_name = TG_TABLE_NAME AND column_name = 'userid'
  ) INTO has_userid;

  -- If any required columns are missing, skip to avoid runtime errors
  IF NOT (has_method AND has_payment_method AND has_amountspent AND has_numberoftickets AND has_purchasedate AND has_competitionid AND has_transactionhash AND has_userid) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Only process if this is a balance payment
  IF COALESCE(NEW.method, NEW.payment_method, '') = 'balance'
     OR COALESCE(NEW.payment_method, NEW.method, '') = 'balance_deduction'
  THEN
    SELECT available_balance INTO v_balance_after
    FROM sub_account_balances
    WHERE canonical_user_id = NEW.canonical_user_id
      AND currency = 'USD';

    v_balance_before := COALESCE(v_balance_after, 0) + COALESCE(ABS(NEW.amountspent), 0);

    INSERT INTO user_transactions (
      canonical_user_id,
      user_id,
      wallet_address,
      user_privy_id,
      competition_id,
      amount,
      currency,
      ticket_count,
      type,
      status,
      payment_status,
      payment_provider,
      method,
      balance_before,
      balance_after,
      tx_id,
      transaction_hash,
      created_at,
      completed_at
    ) VALUES (
      NEW.canonical_user_id,
      COALESCE(NEW.userid, NEW.canonical_user_id),
      NEW.wallet_address,
      NEW.privy_user_id,
      NEW.competitionid,
      -1 * ABS(COALESCE(NEW.amountspent, 0)),
      'USD',
      COALESCE(NEW.numberoftickets, 0),
      'entry',
      'completed',
      'completed',
      'balance',
      'balance_deduction',
      v_balance_before,
      v_balance_after,
      NEW.transactionhash,
      NEW.transactionhash,
      COALESCE(NEW.purchasedate, NOW()),
      COALESCE(NEW.purchasedate, NOW())
    )
    ON CONFLICT (tx_id)
    WHERE tx_id IS NOT NULL
    DO NOTHING;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$

-- Trigger: trg_sync_balance_purchase_to_user_transactions on joincompetition
DROP TRIGGER IF EXISTS trg_sync_balance_purchase_to_user_transactions ON public.joincompetition;
CREATE TRIGGER trg_sync_balance_purchase_to_user_transactions AFTER INSERT OR UPDATE ON joincompetition FOR EACH ROW EXECUTE FUNCTION sync_balance_purchase_to_user_transactions();

-- Trigger function: public.update_tickets_sold_on_join
CREATE OR REPLACE FUNCTION public.update_tickets_sold_on_join()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_total INT;
    v_sold INT;
BEGIN
    -- Lock the competition row, re-check capacity, then increment
    SELECT total_tickets, tickets_sold
      INTO v_total, v_sold
    FROM competitions
    WHERE id = NEW.competition_id
      AND deleted = false
    FOR UPDATE;

    IF v_total IS NULL THEN
        RAISE EXCEPTION 'Competition not found: %', NEW.competition_id;
    END IF;

    IF (v_sold + NEW.ticket_count) > v_total THEN
        RAISE EXCEPTION 'Not enough tickets available during finalize. Requested: %, Available: %, Limit: %',
            NEW.ticket_count, (v_total - v_sold), v_total;
    END IF;

    UPDATE competitions
    SET tickets_sold = tickets_sold + NEW.ticket_count,
        updated_at = NOW()
    WHERE id = NEW.competition_id;

    RETURN NEW;
END;
$function$

-- Trigger: trg_update_tickets_sold_join on joincompetition
DROP TRIGGER IF EXISTS trg_update_tickets_sold_join ON public.joincompetition;
CREATE TRIGGER trg_update_tickets_sold_join AFTER INSERT ON joincompetition FOR EACH ROW EXECUTE FUNCTION update_tickets_sold_on_join();

-- Trigger function: public.validate_joincompetition_tickets
CREATE OR REPLACE FUNCTION public.validate_joincompetition_tickets()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_available INT;
BEGIN
    -- Lock the competition row to prevent race conditions
    PERFORM 1
    FROM competitions c
    WHERE c.id = NEW.competition_id AND c.deleted = false
    FOR UPDATE;

    SELECT (c.total_tickets - c.tickets_sold)
      INTO v_available
    FROM competitions c
    WHERE c.id = NEW.competition_id AND c.deleted = false;

    IF v_available IS NULL THEN
        RAISE EXCEPTION 'Competition not found: %', NEW.competition_id;
    END IF;

    IF NEW.ticket_count > v_available THEN
        RAISE EXCEPTION 'Cannot purchase % tickets. Only % tickets available.',
            NEW.ticket_count, v_available;
    END IF;

    RETURN NEW;
END;
$function$

-- Trigger: trg_validate_joincompetition_tickets on joincompetition
DROP TRIGGER IF EXISTS trg_validate_joincompetition_tickets ON public.joincompetition;
CREATE TRIGGER trg_validate_joincompetition_tickets BEFORE INSERT ON joincompetition FOR EACH ROW EXECUTE FUNCTION validate_joincompetition_tickets();

-- Trigger function: public.update_joincompetition_updated_at
CREATE OR REPLACE FUNCTION public.update_joincompetition_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$function$

-- Trigger: trigger_joincompetition_updated_at on joincompetition
DROP TRIGGER IF EXISTS trigger_joincompetition_updated_at ON public.joincompetition;
CREATE TRIGGER trigger_joincompetition_updated_at BEFORE UPDATE ON joincompetition FOR EACH ROW EXECUTE FUNCTION update_joincompetition_updated_at();

-- Trigger function: public.trg_auto_assign_tickets
CREATE OR REPLACE FUNCTION public.trg_auto_assign_tickets()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Only act for valid orders with ticket_count > 0 and competition
  IF NEW.ticket_count > 0 AND NEW.competition_id IS NOT NULL THEN
    PERFORM public.assign_tickets_to_orders_unique(NULL);
  END IF;
  RETURN NEW;
END;
$function$

-- Trigger: orders_auto_assign_tickets on orders
DROP TRIGGER IF EXISTS orders_auto_assign_tickets ON public.orders;
CREATE TRIGGER orders_auto_assign_tickets AFTER INSERT OR UPDATE OF ticket_count, competition_id, purchase_at, created_at ON orders FOR EACH ROW EXECUTE FUNCTION trg_auto_assign_tickets();

-- Trigger: orders_broadcast on orders
DROP TRIGGER IF EXISTS orders_broadcast ON public.orders;
CREATE TRIGGER orders_broadcast AFTER INSERT OR DELETE OR UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION broadcast_table_changes();

-- Trigger function: public.orders_to_user_transactions
CREATE OR REPLACE FUNCTION public.orders_to_user_transactions()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') AND NEW.status = 'completed' THEN
    INSERT INTO public.user_transactions (
      user_id,
      canonical_user_id,
      type,
      amount,
      currency,
      competition_id,
      order_id,
      status,
      created_at
    ) VALUES (
      NULL,
      NEW.canonical_user_id,
      COALESCE(NULLIF(NEW.order_type, ''), 'purchase'),
      NEW.amount,
      COALESCE(NEW.currency, 'USD'),
      NEW.competition_id,
      NEW.id,
      'completed',
      COALESCE(NEW.updated_at, now())
    );
  END IF;
  RETURN NEW;
END;
$function$

-- Trigger: orders_to_user_transactions_trigger on orders
DROP TRIGGER IF EXISTS orders_to_user_transactions_trigger ON public.orders;
CREATE TRIGGER orders_to_user_transactions_trigger AFTER INSERT OR UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION orders_to_user_transactions();

-- Trigger function: public.auto_debit_on_balance_order
CREATE OR REPLACE FUNCTION public.auto_debit_on_balance_order()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_amount numeric;
  v_tx json;
BEGIN
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') AND
     (NEW.payment_method = 'balance' OR NEW.order_type = 'balance') AND
     (NEW.status ILIKE 'completed' OR COALESCE(NEW.payment_status,'') ILIKE 'paid%') THEN

    v_amount := COALESCE(NEW.amount_usd, NEW.amount);
    v_tx := public.debit_balance_and_confirm_tickets(
      NEW.user_id,
      NEW.id,
      NEW.competition_id,
      v_amount,
      md5(NEW.id::text || '-balance'),
      'USD'
    );
  END IF;
  RETURN NEW;
END;
$function$

-- Trigger: trg_auto_debit_on_balance_order on orders
DROP TRIGGER IF EXISTS trg_auto_debit_on_balance_order ON public.orders;
CREATE TRIGGER trg_auto_debit_on_balance_order AFTER INSERT OR UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION auto_debit_on_balance_order();

-- Trigger: payment_webhook_events_broadcast on payment_webhook_events
DROP TRIGGER IF EXISTS payment_webhook_events_broadcast ON public.payment_webhook_events;
CREATE TRIGGER payment_webhook_events_broadcast AFTER INSERT OR DELETE OR UPDATE ON payment_webhook_events FOR EACH ROW EXECUTE FUNCTION broadcast_table_changes();

-- Trigger function: public.payment_broadcast_trigger
CREATE OR REPLACE FUNCTION public.payment_broadcast_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  topic text;
BEGIN
  topic := 'user:' || NEW.owner_canonical_id || ':payments';
  PERFORM realtime.send(
    topic,
    'payment_status',
    jsonb_build_object(
      'reservation_id', NEW.reservation_id,
      'payment_id', NEW.id,
      'status', NEW.status,
      'error_code', NEW.error_code,
      'idempotency_key', NEW.idempotency_key
    ),
    true
  );
  RETURN NEW;
END;
$function$

-- Trigger: payments_broadcast on payments
DROP TRIGGER IF EXISTS payments_broadcast ON public.payments;
CREATE TRIGGER payments_broadcast AFTER INSERT OR UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION payment_broadcast_trigger();

-- Trigger function: public.set_payments_updated_at
CREATE OR REPLACE FUNCTION public.set_payments_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;$function$

-- Trigger: payments_set_updated_at on payments
DROP TRIGGER IF EXISTS payments_set_updated_at ON public.payments;
CREATE TRIGGER payments_set_updated_at BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION set_payments_updated_at();

-- Trigger function: public.expire_hold_if_needed
CREATE OR REPLACE FUNCTION public.expire_hold_if_needed()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.expires_at <= now() AND NEW.status = 'pending' THEN
    NEW.status := 'expired';
  END IF;
  RETURN NEW;
END $function$

-- Trigger: trg_expire_hold_on_write on pending_ticket_items
DROP TRIGGER IF EXISTS trg_expire_hold_on_write ON public.pending_ticket_items;
CREATE TRIGGER trg_expire_hold_on_write BEFORE INSERT OR UPDATE ON pending_ticket_items FOR EACH ROW EXECUTE FUNCTION expire_hold_if_needed();

-- Trigger function: public.auto_expire_reservations
CREATE OR REPLACE FUNCTION public.auto_expire_reservations()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_grace_period_minutes INTEGER := 15; -- Default grace period
  v_hold_minutes INTEGER;
  v_time_since_creation INTERVAL;
  v_should_expire BOOLEAN := FALSE;
BEGIN
  -- Called on INSERT or UPDATE
  -- Only process if expires_at is set and status is pending
  IF NEW.expires_at IS NOT NULL AND NEW.status = 'pending' THEN
    
    -- Get the hold_minutes value (default to 15 if not set)
    v_hold_minutes := COALESCE(NEW.hold_minutes, v_grace_period_minutes);
    
    -- Calculate time since creation
    v_time_since_creation := NOW() - NEW.created_at;
    
    -- Determine if reservation should expire
    -- CRITICAL: NEVER expire if within hold_minutes window
    -- This protects active reservations from premature expiration
    IF NEW.expires_at < NOW() THEN
      -- Check if we're past the grace period
      IF v_time_since_creation > (v_hold_minutes || ' minutes')::INTERVAL THEN
        v_should_expire := TRUE;
      END IF;
    END IF;
    
    -- Only mark as expired if truly past the grace period
    IF v_should_expire THEN
      NEW.status := 'expired';
      RAISE NOTICE 'Reservation % expired after % minutes (hold window: % minutes)', 
        NEW.id, 
        EXTRACT(EPOCH FROM v_time_since_creation) / 60,
        v_hold_minutes;
    ELSE
      -- Log that we're protecting this reservation
      IF NEW.expires_at < NOW() THEN
        RAISE NOTICE 'Reservation % protected from expiration (within %min grace period, age: %min)', 
          NEW.id,
          v_hold_minutes,
          EXTRACT(EPOCH FROM v_time_since_creation) / 60;
      END IF;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$function$

-- Trigger: check_reservation_expiry on pending_tickets
DROP TRIGGER IF EXISTS check_reservation_expiry ON public.pending_tickets;
CREATE TRIGGER check_reservation_expiry BEFORE INSERT OR UPDATE ON pending_tickets FOR EACH ROW EXECUTE FUNCTION auto_expire_reservations();

-- Trigger: pending_tickets_broadcast_trigger on pending_tickets
DROP TRIGGER IF EXISTS pending_tickets_broadcast_trigger ON public.pending_tickets;
CREATE TRIGGER pending_tickets_broadcast_trigger AFTER INSERT OR DELETE OR UPDATE ON pending_tickets FOR EACH ROW EXECUTE FUNCTION util.broadcast_table_changes();

-- Trigger function: public.trg_fn_confirm_pending_tickets
CREATE OR REPLACE FUNCTION public.trg_fn_confirm_pending_tickets()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  tnum int;
BEGIN
  IF (TG_OP = 'UPDATE') AND (OLD.confirmed_at IS NULL) AND (NEW.confirmed_at IS NOT NULL) THEN
    FOREACH tnum IN ARRAY COALESCE(NEW.ticket_numbers, ARRAY[]::int[]) LOOP
      INSERT INTO public.tickets (
        competition_id, ticket_number, status, purchased_at, order_id,
        canonical_user_id, wallet_address
      ) VALUES (
        NEW.competition_id, tnum, 'sold', NEW.confirmed_at, NULL,
        NEW.canonical_user_id,
        COALESCE(NEW.wallet_address,
                 (SELECT cu.wallet_address FROM public.canonical_users cu
                  WHERE cu.canonical_user_id = NEW.canonical_user_id))
      )
      ON CONFLICT (competition_id, ticket_number) DO UPDATE
      SET status = 'sold',
          purchased_at = EXCLUDED.purchased_at,
          canonical_user_id = EXCLUDED.canonical_user_id,
          wallet_address = EXCLUDED.wallet_address;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$function$

-- Trigger: trg_confirm_pending_tickets on pending_tickets
DROP TRIGGER IF EXISTS trg_confirm_pending_tickets ON public.pending_tickets;
CREATE TRIGGER trg_confirm_pending_tickets AFTER UPDATE ON pending_tickets FOR EACH ROW EXECUTE FUNCTION trg_fn_confirm_pending_tickets();

-- Trigger function: public.trg_sync_joincompetition_from_pending
CREATE OR REPLACE FUNCTION public.trg_sync_joincompetition_from_pending()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.transaction_hash IS NULL THEN
    RETURN NEW;
  END IF;

  -- Recompute aggregates for this tx
  PERFORM public.upsert_joincompetition_by_tx(NEW.transaction_hash);
  RETURN NEW;
END;
$function$

-- Trigger: trg_pending_sync_joincompetition on pending_tickets
DROP TRIGGER IF EXISTS trg_pending_sync_joincompetition ON public.pending_tickets;
CREATE TRIGGER trg_pending_sync_joincompetition AFTER INSERT OR UPDATE ON pending_tickets FOR EACH ROW EXECUTE FUNCTION trg_sync_joincompetition_from_pending();

-- Trigger function: public.pending_tickets_autofill_cuid
CREATE OR REPLACE FUNCTION public.pending_tickets_autofill_cuid()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF NEW.canonical_user_id IS NULL AND NEW.user_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.canonical_users cu
      WHERE cu.canonical_user_id = NEW.user_id
    ) THEN
      NEW.canonical_user_id := NEW.user_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$

-- Trigger: trg_pending_tickets_autofill_cuid on pending_tickets
DROP TRIGGER IF EXISTS trg_pending_tickets_autofill_cuid ON public.pending_tickets;
CREATE TRIGGER trg_pending_tickets_autofill_cuid BEFORE INSERT OR UPDATE OF user_id, canonical_user_id ON pending_tickets FOR EACH ROW EXECUTE FUNCTION pending_tickets_autofill_cuid();

-- Trigger function: public.pending_tickets_enforce_expiry
CREATE OR REPLACE FUNCTION public.pending_tickets_enforce_expiry()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.expires_at IS NULL THEN
    NEW.expires_at := COALESCE(NEW.created_at, now()) + interval '5 minutes';
  END IF;
  IF NEW.status = 'pending' AND now() > NEW.expires_at THEN
    NEW.status := 'expired';
    NEW.updated_at := now();
    NEW.note := coalesce(NEW.note, '') || CASE WHEN NEW.note IS NULL OR NEW.note = '' THEN '' ELSE ' | ' END ||
      'auto-expired by trigger at ' || to_char(now(), 'YYYY-MM-DD HH24:MI:SS TZ');
  END IF;
  RETURN NEW;
END;
$function$

-- Trigger: trg_pending_tickets_enforce_expiry_biu on pending_tickets
DROP TRIGGER IF EXISTS trg_pending_tickets_enforce_expiry_biu ON public.pending_tickets;
CREATE TRIGGER trg_pending_tickets_enforce_expiry_biu BEFORE INSERT OR UPDATE ON pending_tickets FOR EACH ROW EXECUTE FUNCTION pending_tickets_enforce_expiry();

-- Trigger: trg_pending_tickets_set_cuid on pending_tickets
DROP TRIGGER IF EXISTS trg_pending_tickets_set_cuid ON public.pending_tickets;
CREATE TRIGGER trg_pending_tickets_set_cuid BEFORE INSERT OR UPDATE ON pending_tickets FOR EACH ROW EXECUTE FUNCTION util.trg_set_cuid_from_context();

-- Trigger function: public.update_tickets_sold_on_pending
CREATE OR REPLACE FUNCTION public.update_tickets_sold_on_pending()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_total INT;
    v_sold INT;
BEGIN
    -- Lock the competition row, re-check capacity, then increment
    SELECT total_tickets, tickets_sold
      INTO v_total, v_sold
    FROM competitions
    WHERE id = NEW.competition_id
      AND deleted = false
    FOR UPDATE;

    IF v_total IS NULL THEN
        RAISE EXCEPTION 'Competition not found: %', NEW.competition_id;
    END IF;

    IF (v_sold + NEW.ticket_count) > v_total THEN
        RAISE EXCEPTION 'Not enough tickets available during pending finalize. Requested: %, Available: %, Limit: %',
            NEW.ticket_count, (v_total - v_sold), v_total;
    END IF;

    UPDATE competitions
    SET tickets_sold = tickets_sold + NEW.ticket_count,
        updated_at = NOW()
    WHERE id = NEW.competition_id;

    RETURN NEW;
END;
$function$

-- Trigger: trg_update_tickets_sold_pending on pending_tickets
DROP TRIGGER IF EXISTS trg_update_tickets_sold_pending ON public.pending_tickets;
CREATE TRIGGER trg_update_tickets_sold_pending AFTER INSERT ON pending_tickets FOR EACH ROW EXECUTE FUNCTION update_tickets_sold_on_pending();

-- Trigger function: public.validate_pending_tickets
CREATE OR REPLACE FUNCTION public.validate_pending_tickets()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_available INT;
BEGIN
    -- Lock the competition row to prevent race conditions
    PERFORM 1
    FROM competitions c
    WHERE c.id = NEW.competition_id AND c.deleted = false
    FOR UPDATE;

    SELECT (c.total_tickets - c.tickets_sold)
      INTO v_available
    FROM competitions c
    WHERE c.id = NEW.competition_id AND c.deleted = false;

    IF v_available IS NULL THEN
        RAISE EXCEPTION 'Competition not found: %', NEW.competition_id;
    END IF;

    IF NEW.ticket_count > v_available THEN
        RAISE EXCEPTION 'Cannot create pending ticket for % tickets. Only % available.',
            NEW.ticket_count, v_available;
    END IF;

    RETURN NEW;
END;
$function$

-- Trigger: trg_validate_pending_tickets on pending_tickets
DROP TRIGGER IF EXISTS trg_validate_pending_tickets ON public.pending_tickets;
CREATE TRIGGER trg_validate_pending_tickets BEFORE INSERT ON pending_tickets FOR EACH ROW EXECUTE FUNCTION validate_pending_tickets();

-- Trigger: update_pending_tickets_updated_at on pending_tickets
DROP TRIGGER IF EXISTS update_pending_tickets_updated_at ON public.pending_tickets;
CREATE TRIGGER update_pending_tickets_updated_at BEFORE UPDATE ON pending_tickets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Trigger function: public.call_profiles_processor_async
CREATE OR REPLACE FUNCTION public.call_profiles_processor_async()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  PERFORM net.http_post(
    url := current_setting('app.settings.supabase_url', true) || '/functions/v1/profiles-processor',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  RETURN NEW;
END;
$function$

-- Trigger: trg_profiles_after_upsert on profiles
DROP TRIGGER IF EXISTS trg_profiles_after_upsert ON public.profiles;
CREATE TRIGGER trg_profiles_after_upsert AFTER INSERT OR UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION call_profiles_processor_async();

-- Trigger function: public.reservation_broadcast_trigger
CREATE OR REPLACE FUNCTION public.reservation_broadcast_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  PERFORM realtime.broadcast_changes(
    'reservation:' || COALESCE(NEW.id, OLD.id)::text,
    TG_OP,
    TG_OP,
    TG_TABLE_NAME,
    TG_TABLE_SCHEMA,
    NEW,
    OLD
  );
  RETURN COALESCE(NEW, OLD);
END;
$function$

-- Trigger: reservations_broadcast on reservations
DROP TRIGGER IF EXISTS reservations_broadcast ON public.reservations;
CREATE TRIGGER reservations_broadcast AFTER INSERT OR DELETE OR UPDATE ON reservations FOR EACH ROW EXECUTE FUNCTION reservation_broadcast_trigger();

-- Trigger function: public.sub_account_bonus_trigger
CREATE OR REPLACE FUNCTION public.sub_account_bonus_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_prev numeric := COALESCE((CASE WHEN TG_OP = 'UPDATE' THEN OLD.available_balance ELSE NULL END), 0);
  v_new numeric := COALESCE(NEW.available_balance, 0);
BEGIN
  -- Only USD rows and only when crossing strictly above 3
  IF NEW.currency = 'USD' AND v_new > 3 AND COALESCE(v_prev, 0) <= 3 THEN
    PERFORM public.award_welcome_bonus(NEW.wallet_address, 3, 100);
  END IF;
  RETURN NEW;
END;
$function$

-- Trigger: sub_account_balances_award_insert on sub_account_balances
DROP TRIGGER IF EXISTS sub_account_balances_award_insert ON public.sub_account_balances;
CREATE TRIGGER sub_account_balances_award_insert AFTER INSERT ON sub_account_balances FOR EACH ROW EXECUTE FUNCTION sub_account_bonus_trigger();

-- Trigger: sub_account_balances_award_update on sub_account_balances
DROP TRIGGER IF EXISTS sub_account_balances_award_update ON public.sub_account_balances;
CREATE TRIGGER sub_account_balances_award_update AFTER UPDATE OF available_balance ON sub_account_balances FOR EACH ROW EXECUTE FUNCTION sub_account_bonus_trigger();

-- Trigger: sub_account_balances_broadcast_trigger on sub_account_balances
DROP TRIGGER IF EXISTS sub_account_balances_broadcast_trigger ON public.sub_account_balances;
CREATE TRIGGER sub_account_balances_broadcast_trigger AFTER INSERT OR DELETE OR UPDATE ON sub_account_balances FOR EACH ROW EXECUTE FUNCTION util.broadcast_table_changes();

-- Trigger function: public.normalize_sub_account_currency
CREATE OR REPLACE FUNCTION public.normalize_sub_account_currency()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Normalize currency to upper-case and trim
  IF NEW.currency IS NOT NULL THEN
    NEW.currency := upper(btrim(NEW.currency));
  END IF;

  -- Resolve canonical_user_id fallback to user_id if missing/empty
  IF (NEW.canonical_user_id IS NULL OR NEW.canonical_user_id = '') THEN
    IF (NEW.user_id IS NOT NULL AND NEW.user_id <> '') THEN
      NEW.canonical_user_id := NEW.user_id;
    END IF;
  END IF;

  -- Keep canonical_user_id_norm in sync if column exists
  IF NEW.canonical_user_id IS NOT NULL AND NEW.canonical_user_id <> '' THEN
    NEW.canonical_user_id_norm := NEW.canonical_user_id;
  END IF;

  -- Initialize pending_balance to 0 on insert if null
  IF TG_OP = 'INSERT' AND NEW.pending_balance IS NULL THEN
    NEW.pending_balance := 0;
  END IF;

  -- If no last_updated provided, set now() on insert
  IF TG_OP = 'INSERT' AND NEW.last_updated IS NULL THEN
    NEW.last_updated := now();
  END IF;

  RETURN NEW;
END;
$function$

-- Trigger: trg_normalize_sub_account_currency on sub_account_balances
DROP TRIGGER IF EXISTS trg_normalize_sub_account_currency ON public.sub_account_balances;
CREATE TRIGGER trg_normalize_sub_account_currency BEFORE INSERT OR UPDATE ON sub_account_balances FOR EACH ROW EXECUTE FUNCTION normalize_sub_account_currency();

-- Trigger function: public.sub_account_balances_sync_ids
CREATE OR REPLACE FUNCTION public.sub_account_balances_sync_ids()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- If user_id missing but canonical provided, mirror to user_id
  IF (NEW.user_id IS NULL OR NEW.user_id = '') AND (NEW.canonical_user_id IS NOT NULL AND NEW.canonical_user_id <> '') THEN
    NEW.user_id := NEW.canonical_user_id;
  END IF;

  -- If canonical still null after resolution, raise error
  IF (NEW.canonical_user_id IS NULL OR NEW.canonical_user_id = '') THEN
    RAISE EXCEPTION 'canonical_user_id (or user_id fallback) must be provided for sub_account_balances';
  END IF;

  RETURN NEW;
END;
$function$

-- Trigger: trg_sub_account_balances_sync_ids on sub_account_balances
DROP TRIGGER IF EXISTS trg_sub_account_balances_sync_ids ON public.sub_account_balances;
CREATE TRIGGER trg_sub_account_balances_sync_ids BEFORE INSERT OR UPDATE ON sub_account_balances FOR EACH ROW EXECUTE FUNCTION sub_account_balances_sync_ids();

-- Trigger function: public.sync_cu_usdc_from_sab
CREATE OR REPLACE FUNCTION public.sync_cu_usdc_from_sab()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$BEGIN

END;$function$

-- Trigger: trg_sync_cu_usdc_from_sab on sub_account_balances
DROP TRIGGER IF EXISTS trg_sync_cu_usdc_from_sab ON public.sub_account_balances;
CREATE TRIGGER trg_sync_cu_usdc_from_sab AFTER INSERT OR UPDATE OF available_balance, currency ON sub_account_balances FOR EACH ROW EXECUTE FUNCTION sync_cu_usdc_from_sab();

-- Trigger: update_sub_account_balances_updated_at on sub_account_balances
DROP TRIGGER IF EXISTS update_sub_account_balances_updated_at ON public.sub_account_balances;
CREATE TRIGGER update_sub_account_balances_updated_at BEFORE UPDATE ON sub_account_balances FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Trigger: tickets_broadcast_trigger on tickets
DROP TRIGGER IF EXISTS tickets_broadcast_trigger ON public.tickets;
CREATE TRIGGER tickets_broadcast_trigger AFTER INSERT OR DELETE OR UPDATE ON tickets FOR EACH ROW EXECUTE FUNCTION util.broadcast_table_changes();

-- Trigger function: public.bcast_ticket_changes
CREATE OR REPLACE FUNCTION public.bcast_ticket_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  PERFORM realtime.broadcast_changes(
    'competition:' || COALESCE(NEW.competition_id, OLD.competition_id)::text || ':tickets',
    TG_OP,
    TG_OP,
    TG_TABLE_NAME,
    TG_TABLE_SCHEMA,
    NEW,
    OLD
  );
  RETURN COALESCE(NEW, OLD);
END;
$function$

-- Trigger: trg_bcast_ticket_changes on tickets
DROP TRIGGER IF EXISTS trg_bcast_ticket_changes ON public.tickets;
CREATE TRIGGER trg_bcast_ticket_changes AFTER INSERT OR DELETE OR UPDATE ON tickets FOR EACH ROW EXECUTE FUNCTION bcast_ticket_changes();

-- Trigger function: public.trigger_check_competition_sold_out
CREATE OR REPLACE FUNCTION public.trigger_check_competition_sold_out()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.competition_id IS NOT NULL THEN
    PERFORM check_and_mark_competition_sold_out(NEW.competition_id);
  END IF;
  RETURN NEW;
END;
$function$

-- Trigger: trg_check_sold_out_on_ticket_insert on tickets
DROP TRIGGER IF EXISTS trg_check_sold_out_on_ticket_insert ON public.tickets;
CREATE TRIGGER trg_check_sold_out_on_ticket_insert AFTER INSERT ON tickets FOR EACH ROW EXECUTE FUNCTION trigger_check_competition_sold_out();

-- Trigger function: public.tickets_finalize_spend_trigger
CREATE OR REPLACE FUNCTION public.tickets_finalize_spend_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_finalized boolean;
  v_amount numeric;
  v_cuid text;
  v_provider text;
BEGIN
  -- Only act after insert or update to a finalized state
  v_finalized := (NEW.status IN ('sold','purchased')) AND NEW.payment_amount IS NOT NULL;
  IF NOT v_finalized THEN
    RETURN NEW;
  END IF;

  v_amount := NEW.payment_amount;
  v_cuid := public._ticket_cuid(NEW.user_id, NEW.canonical_user_id, NEW.wallet_address);
  v_provider := NEW.payment_provider; -- may be null; acceptable

  -- Ensure we only process once per ticket id
  -- Type-safe comparison: match by canonical_user_id when present, otherwise compare user_id::text
  PERFORM 1 FROM public.user_transactions ut
  WHERE ut.type = 'entry'
    AND ut.status = 'completed'
    AND ut.amount = v_amount
    AND (ut.order_id = NEW.order_id OR (NEW.order_id IS NULL AND ut.order_id IS NULL))
    AND (ut.description = NEW.id::text OR ut.description IS NULL)
    AND (
      (ut.canonical_user_id IS NOT NULL AND ut.canonical_user_id = v_cuid)
      OR (ut.canonical_user_id IS NULL AND ut.user_id IS NOT NULL AND ut.user_id::text = v_cuid)
    );
  IF FOUND THEN
    RETURN NEW;
  END IF;

  -- Insert transaction (v_cuid is canonical text id)
  PERFORM public._insert_user_spend_tx(v_cuid, v_amount, NEW.competition_id, NEW.order_id, NEW.id, v_provider, NEW.wallet_address);

  -- Deduct from balance using canonical id text
  PERFORM public._deduct_sub_account_balance(v_cuid, v_amount);

  RETURN NEW;
END;
$function$

-- Trigger: trg_tickets_finalize_spend on tickets
DROP TRIGGER IF EXISTS trg_tickets_finalize_spend ON public.tickets;
CREATE TRIGGER trg_tickets_finalize_spend AFTER INSERT OR UPDATE OF status, payment_amount ON tickets FOR EACH ROW EXECUTE FUNCTION tickets_finalize_spend_trigger();

-- Trigger: trg_tickets_set_cuid on tickets
DROP TRIGGER IF EXISTS trg_tickets_set_cuid ON public.tickets;
CREATE TRIGGER trg_tickets_set_cuid BEFORE INSERT OR UPDATE ON tickets FOR EACH ROW EXECUTE FUNCTION util.trg_set_cuid_from_context();

-- Trigger function: public.tickets_tx_id_fill
CREATE OR REPLACE FUNCTION public.tickets_tx_id_fill()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.tx_id IS NULL OR NEW.tx_id = '' THEN
    NEW.tx_id := public.gen_ticket_tx_id(
      NEW.id::uuid,
      NEW.competition_id::uuid,
      NEW.ticket_number::bigint,
      COALESCE(NEW.canonical_user_id, '')::text,
      COALESCE(NEW.wallet_address, '')::text,
      COALESCE(NEW.payment_provider, '')::text,
      COALESCE(NEW.payment_amount, 0)::numeric,
      COALESCE(NEW.payment_tx_hash, '')::text,
      COALESCE(NEW.created_at, now())::timestamptz
    );
  END IF;
  RETURN NEW;
END;$function$

-- Trigger: trg_tickets_txid_fill on tickets
DROP TRIGGER IF EXISTS trg_tickets_txid_fill ON public.tickets;
CREATE TRIGGER trg_tickets_txid_fill BEFORE INSERT ON tickets FOR EACH ROW EXECUTE FUNCTION tickets_tx_id_fill();

-- Trigger function: public._upsert_competition_entry_from_ticket
CREATE OR REPLACE FUNCTION public._upsert_competition_entry_from_ticket()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_cuid text;
  v_comp uuid;
  v_wallet text;
  v_price numeric;
  v_ts timestamptz := now();
  v_num int;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  -- Use NEW only
  v_cuid := COALESCE(NEW.canonical_user_id, NEW.user_id, NEW.wallet_address);
  v_comp := NEW.competition_id;
  v_wallet := COALESCE(NEW.wallet_address, replace(NEW.canonical_user_id, 'prize:pid:', ''));
  v_price := COALESCE(NEW.purchase_price, NEW.payment_amount, 0);
  v_num := NEW.ticket_number;

  IF v_cuid IS NULL OR v_comp IS NULL OR v_num IS NULL THEN
    RETURN NEW;
  END IF;

  -- Only act on finalized tickets
  IF COALESCE(NEW.status,'') NOT IN ('sold','purchased') THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.competition_entries AS ce (
    id, canonical_user_id, competition_id, wallet_address, tickets_count, ticket_numbers_csv, amount_spent, latest_purchase_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_cuid, v_comp, v_wallet, 1, v_num::text, v_price, COALESCE(NEW.purchase_date, NEW.purchased_at, NEW.created_at, v_ts), v_ts, v_ts
  )
  ON CONFLICT (canonical_user_id, competition_id)
  DO UPDATE SET
    tickets_count = ce.tickets_count + 1,
    amount_spent = COALESCE(ce.amount_spent,0) + v_price,
    ticket_numbers_csv = CASE
      WHEN ce.ticket_numbers_csv IS NULL OR ce.ticket_numbers_csv = '' THEN v_num::text
      ELSE ce.ticket_numbers_csv || ',' || v_num::text
    END,
    wallet_address = COALESCE(ce.wallet_address, v_wallet),
    latest_purchase_at = GREATEST(COALESCE(ce.latest_purchase_at, v_ts), COALESCE(NEW.purchase_date, NEW.purchased_at, NEW.created_at, v_ts)),
    updated_at = v_ts;

  RETURN NEW;
END;
$function$

-- Trigger: trg_tickets_upsert_entries on tickets
DROP TRIGGER IF EXISTS trg_tickets_upsert_entries ON public.tickets;
CREATE TRIGGER trg_tickets_upsert_entries AFTER INSERT OR UPDATE OF status, purchase_price, payment_amount, purchased_at, purchase_date, wallet_address, canonical_user_id, ticket_number ON tickets FOR EACH ROW WHEN (new.status = ANY (ARRAY['sold'::text, 'purchased'::text])) EXECUTE FUNCTION _upsert_competition_entry_from_ticket();

-- Trigger function: public.tickets_sync_wallet
CREATE OR REPLACE FUNCTION public.tickets_sync_wallet()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.canonical_user_id IS NOT NULL AND (NEW.wallet_address IS NULL OR NEW.wallet_address = '') THEN
    NEW.wallet_address := replace(NEW.canonical_user_id, 'prize:pid:', '');
  END IF;
  RETURN NEW;
END;
$function$

-- Trigger: trg_tickets_wallet_bi on tickets
DROP TRIGGER IF EXISTS trg_tickets_wallet_bi ON public.tickets;
CREATE TRIGGER trg_tickets_wallet_bi BEFORE INSERT OR UPDATE OF canonical_user_id, wallet_address ON tickets FOR EACH ROW EXECUTE FUNCTION tickets_sync_wallet();

-- Trigger function: public.set_updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$

-- Trigger: set_topup_providers_updated_at on topup_providers
DROP TRIGGER IF EXISTS set_topup_providers_updated_at ON public.topup_providers;
CREATE TRIGGER set_topup_providers_updated_at BEFORE UPDATE ON topup_providers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Trigger function: public.enforce_posted_to_balance
CREATE OR REPLACE FUNCTION public.enforce_posted_to_balance()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- External crypto entries NEVER post to internal balance
  IF NEW.type = 'entry'
     AND NEW.payment_provider IN ('base_account','coinbase_commerce','cdp_commerce') THEN
    NEW.posted_to_balance := false;
  END IF;
  RETURN NEW;
END;
$function$

-- Trigger: trg_enforce_posted_to_balance on user_transactions
DROP TRIGGER IF EXISTS trg_enforce_posted_to_balance ON public.user_transactions;
CREATE TRIGGER trg_enforce_posted_to_balance BEFORE INSERT OR UPDATE ON user_transactions FOR EACH ROW EXECUTE FUNCTION enforce_posted_to_balance();

-- Trigger function: public.commerce_post_to_balance
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
    -- Credit canonical_users.usdc_balance (or sub_account_balances if preferred)
    -- Here we credit canonical_users.usdc_balance as example. Adjust to your source of truth.
    IF NEW.canonical_user_id IS NULL THEN
      RAISE EXCEPTION 'Cannot post topup without canonical_user_id for tx %', NEW.id;
    END IF;

    UPDATE public.canonical_users cu
      SET usdc_balance = COALESCE(cu.usdc_balance, 0) + COALESCE(NEW.amount, 0),
          updated_at = now()
      WHERE cu.canonical_user_id = NEW.canonical_user_id;

    -- Mark posted
    NEW.posted_to_balance := true;
  END IF;

  RETURN NEW;
END;
$function$

-- Trigger: trg_user_tx_commerce_post on user_transactions
DROP TRIGGER IF EXISTS trg_user_tx_commerce_post ON public.user_transactions;
CREATE TRIGGER trg_user_tx_commerce_post AFTER INSERT OR UPDATE OF status, payment_provider, type ON user_transactions FOR EACH ROW EXECUTE FUNCTION commerce_post_to_balance();

-- Trigger function: public.users_autolink_canonical_before_ins
CREATE OR REPLACE FUNCTION public.users_autolink_canonical_before_ins()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_email text := nullif(lower(trim(new.email)), '');
  v_wallet text := nullif(lower(trim(new.wallet_address)), '');
  v_row public.canonical_users;
begin
  -- If canonical_user_id already provided, allow
  if new.canonical_user_id is not null and length(new.canonical_user_id) > 0 then
    return new;
  end if;

  -- Try to resolve via ensure_canonical_user using whatever is present
  v_row := public.ensure_canonical_user(
    p_email => v_email,
    p_wallet_address => v_wallet
  );

  new.canonical_user_id := v_row.canonical_user_id;

  if new.canonical_user_id is null then
    raise exception 'canonical_user_id could not be resolved for email=% wallet=%', v_email, v_wallet;
  end if;

  return new;
end;
$function$

-- Trigger: trg_users_autolink_before_ins on users
DROP TRIGGER IF EXISTS trg_users_autolink_before_ins ON public.users;
CREATE TRIGGER trg_users_autolink_before_ins BEFORE INSERT ON users FOR EACH ROW EXECUTE FUNCTION users_autolink_canonical_before_ins();

-- Trigger function: public.users_normalize_before_write
CREATE OR REPLACE FUNCTION public.users_normalize_before_write()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.wallet_address is not null then
    new.wallet_address := util.normalize_evm_address(new.wallet_address);
  end if;

  if new.wallet_address is not null then
    new.canonical_user_id := 'prize:pid:' || new.wallet_address;
  elsif new.canonical_user_id is not null then
    -- If only canonical provided, try to extract wallet
    if position('prize:pid:' in new.canonical_user_id) = 1 then
      new.wallet_address := replace(new.canonical_user_id, 'prize:pid:', '');
    end if;
  end if;

  return new;
end;
$function$

-- Trigger: users_normalize_before_write on users
DROP TRIGGER IF EXISTS users_normalize_before_write ON public.users;
CREATE TRIGGER users_normalize_before_write BEFORE INSERT OR UPDATE ON users FOR EACH ROW EXECUTE FUNCTION users_normalize_before_write();

-- Trigger function: public._audit_bad_winner_writes
CREATE OR REPLACE FUNCTION public._audit_bad_winner_writes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF NEW.user_id ~ '^prize:pid:[0-9a-f-]{36}$' OR NEW.wallet_address ~ '^[0-9a-f-]{36}$' THEN
    INSERT INTO public.admin_audit_log (id, action, target_type, target_id, details)
    VALUES (
      gen_random_uuid(),
      'bad_winner_write',
      'winners',
      NEW.id::text,
      jsonb_build_object(
        'reason','uuid_in_user_or_wallet',
        'user_id', NEW.user_id,
        'wallet_address', NEW.wallet_address,
        'application_name', current_setting('application_name', true),
        'db_user', current_user,
        'now', now()
      )
    );
  END IF;
  RETURN NEW;
END;
$function$

-- Trigger: trg_audit_bad_winner_writes on winners
DROP TRIGGER IF EXISTS trg_audit_bad_winner_writes ON public.winners;
CREATE TRIGGER trg_audit_bad_winner_writes BEFORE INSERT OR UPDATE ON winners FOR EACH ROW EXECUTE FUNCTION _audit_bad_winner_writes();

-- Trigger function: public.bcast_winner_changes
CREATE OR REPLACE FUNCTION public.bcast_winner_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  PERFORM realtime.broadcast_changes(
    'competition:' || COALESCE(NEW.competition_id, OLD.competition_id)::text || ':winners',
    TG_OP,
    TG_OP,
    TG_TABLE_NAME,
    TG_TABLE_SCHEMA,
    NEW,
    OLD
  );
  RETURN COALESCE(NEW, OLD);
END;
$function$

-- Trigger: trg_bcast_winner_changes on winners
DROP TRIGGER IF EXISTS trg_bcast_winner_changes ON public.winners;
CREATE TRIGGER trg_bcast_winner_changes AFTER INSERT OR DELETE OR UPDATE ON winners FOR EACH ROW EXECUTE FUNCTION bcast_winner_changes();

-- Trigger function: public.winners_sync_wallet_from_user_id
CREATE OR REPLACE FUNCTION public.winners_sync_wallet_from_user_id()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.user_id IS NOT NULL AND NEW.user_id LIKE 'prize:pid:%' AND (NEW.wallet_address IS NULL OR NEW.wallet_address = '') THEN
    NEW.wallet_address := replace(NEW.user_id, 'prize:pid:', '');
  END IF;
  RETURN NEW;
END;
$function$

-- Trigger: trg_winners_wallet_bi on winners
DROP TRIGGER IF EXISTS trg_winners_wallet_bi ON public.winners;
CREATE TRIGGER trg_winners_wallet_bi BEFORE INSERT OR UPDATE OF user_id, wallet_address ON winners FOR EACH ROW EXECUTE FUNCTION winners_sync_wallet_from_user_id();

-- Trigger: winners_broadcast_trigger on winners
DROP TRIGGER IF EXISTS winners_broadcast_trigger ON public.winners;
CREATE TRIGGER winners_broadcast_trigger AFTER INSERT OR DELETE OR UPDATE ON winners FOR EACH ROW EXECUTE FUNCTION util.broadcast_table_changes();

-- Trigger function: public.winners_normalize_before_write
CREATE OR REPLACE FUNCTION public.winners_normalize_before_write()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  candidate_uuid uuid;
  cu RECORD;
BEGIN
  -- Normalize user_id if it's a prize:pid:<uuid> or a raw uuid mistakenly placed
  IF NEW.user_id IS NOT NULL THEN
    IF NEW.user_id ~ '^prize:pid:[0-9a-f\-]{36}$' THEN
      candidate_uuid := split_part(NEW.user_id, 'prize:pid:', 2)::uuid;
    ELSIF NEW.user_id ~ '^[0-9a-f\-]{36}$' THEN
      candidate_uuid := NEW.user_id::uuid;
    END IF;
  END IF;

  -- If not found in user_id, check wallet_address for a raw uuid
  IF candidate_uuid IS NULL AND NEW.wallet_address IS NOT NULL AND NEW.wallet_address ~ '^[0-9a-f\-]{36}$' THEN
    candidate_uuid := NEW.wallet_address::uuid;
  END IF;

  -- If we discovered a UUID connector, map it to canonical_users
  IF candidate_uuid IS NOT NULL THEN
    SELECT cu.* INTO cu FROM public.canonical_users cu WHERE cu.id = candidate_uuid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'No canonical_user found for UUID %', candidate_uuid USING ERRCODE = '23503';
    END IF;

    -- Overwrite fields from canonical_users
    NEW.user_id := cu.canonical_user_id; -- TEXT id
    IF cu.username IS NOT NULL THEN
      NEW.username := cu.username;
    END IF;
    IF cu.wallet_address ~ '^0x[0-9a-fA-F]{6,}$' THEN
      NEW.wallet_address := cu.wallet_address;
    END IF;
  END IF;

  -- Final validations
  -- user_id must be TEXT canonical style (not a bare uuid or prize:pid:uuid)
  IF NEW.user_id IS NULL OR NEW.user_id ~ '^[0-9a-f\-]{36}$' OR NEW.user_id ~ '^prize:pid:[0-9a-f\-]{36}$' THEN
    RAISE EXCEPTION 'user_id must be canonical TEXT (not UUID). Provided: %', COALESCE(NEW.user_id, 'NULL') USING ERRCODE = '22000';
  END IF;

  -- If wallet_address present but not 0x… format, error
  IF NEW.wallet_address IS NOT NULL AND NEW.wallet_address !~ '^0x[0-9a-fA-F]{6,}$' THEN
    RAISE EXCEPTION 'wallet_address must look like 0x… hex. Provided: %', NEW.wallet_address USING ERRCODE = '22000';
  END IF;

  RETURN NEW;
END;
$function$

-- Trigger: winners_normalize_biu on winners
DROP TRIGGER IF EXISTS winners_normalize_biu ON public.winners;
CREATE TRIGGER winners_normalize_biu BEFORE INSERT OR UPDATE ON winners FOR EACH ROW EXECUTE FUNCTION winners_normalize_before_write();

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
