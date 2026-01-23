-- =====================================================
-- GODLIKE BALANCE PAYMENT RPC
-- =====================================================
-- This migration creates a single, unified, bulletproof RPC for balance payments
-- that handles ALL user ID formats, bypasses RLS issues, and ensures idempotency.
--
-- The frontend calls this single RPC and it JUST WORKS.
--
-- Key features:
-- 1. Service-level access (SECURITY DEFINER with service role grants)
-- 2. Handles all user ID formats: prize:pid:0x..., 0x..., did:privy:..., UUID
-- 3. Atomic transaction with automatic rollback on failure
-- 4. Idempotent via idempotency_key - same request returns same result
-- 5. Creates entries in ALL relevant tables in one shot
-- 6. Returns detailed success/error info for debugging
--
-- Date: 2026-01-23
-- =====================================================

BEGIN;

-- =====================================================
-- PART 1: Create idempotency tracking table
-- =====================================================

CREATE TABLE IF NOT EXISTS public.payment_idempotency (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT UNIQUE NOT NULL,
  user_id TEXT NOT NULL,
  competition_id UUID,
  amount NUMERIC NOT NULL,
  ticket_count INTEGER NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '24 hours')
);

CREATE INDEX IF NOT EXISTS idx_payment_idempotency_key ON public.payment_idempotency(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_payment_idempotency_expires ON public.payment_idempotency(expires_at);

-- Grant access
GRANT SELECT, INSERT, UPDATE ON public.payment_idempotency TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.payment_idempotency TO authenticated;

-- =====================================================
-- PART 2: Create the GODLIKE unified payment RPC
-- =====================================================

DROP FUNCTION IF EXISTS execute_balance_payment(TEXT, UUID, NUMERIC, INTEGER, INTEGER[], TEXT, TEXT) CASCADE;

CREATE OR REPLACE FUNCTION execute_balance_payment(
  p_user_identifier TEXT,        -- Any format: wallet, prize:pid:, did:privy:, etc.
  p_competition_id UUID,         -- Competition to purchase tickets for
  p_amount NUMERIC,              -- Total amount to debit
  p_ticket_count INTEGER,        -- Number of tickets to create
  p_selected_tickets INTEGER[] DEFAULT NULL,  -- Optional specific ticket numbers
  p_idempotency_key TEXT DEFAULT NULL,        -- For duplicate request protection
  p_reservation_id TEXT DEFAULT NULL          -- Optional pending_tickets reservation
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- User resolution
  v_canonical_user_id TEXT;
  v_wallet_address TEXT;
  v_user_uuid UUID;
  v_privy_user_id TEXT;

  -- Balance tracking
  v_current_balance NUMERIC := 0;
  v_new_balance NUMERIC;
  v_balance_record_id UUID;
  v_balance_source TEXT := 'none';

  -- Ticket assignment
  v_ticket_numbers INTEGER[];
  v_max_tickets INTEGER;
  v_used_tickets INTEGER[];
  v_entry_uid UUID;
  v_transaction_id UUID;

  -- Idempotency
  v_existing_result JSONB;
  v_final_idempotency_key TEXT;

  -- Competition info
  v_competition_status TEXT;
  v_competition_title TEXT;

  -- Temp variables
  v_row_count INTEGER;
  v_search_wallet TEXT;
  v_temp_balance NUMERIC;
BEGIN
  -- =====================================================
  -- STEP 0: Input validation
  -- =====================================================

  IF p_user_identifier IS NULL OR TRIM(p_user_identifier) = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'User identifier is required',
      'error_code', 'INVALID_USER'
    );
  END IF;

  IF p_competition_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Competition ID is required',
      'error_code', 'INVALID_COMPETITION'
    );
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Amount must be greater than 0',
      'error_code', 'INVALID_AMOUNT'
    );
  END IF;

  IF p_ticket_count IS NULL OR p_ticket_count <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Ticket count must be greater than 0',
      'error_code', 'INVALID_TICKET_COUNT'
    );
  END IF;

  -- =====================================================
  -- STEP 1: Check idempotency
  -- =====================================================

  v_final_idempotency_key := COALESCE(
    p_idempotency_key,
    MD5(p_user_identifier || '::' || p_competition_id::TEXT || '::' || p_amount::TEXT || '::' || p_ticket_count::TEXT || '::' || NOW()::TEXT)
  );

  -- Check for existing request with same idempotency key
  SELECT result INTO v_existing_result
  FROM public.payment_idempotency
  WHERE idempotency_key = v_final_idempotency_key
    AND expires_at > NOW();

  IF v_existing_result IS NOT NULL THEN
    -- Return cached result (idempotent)
    RETURN v_existing_result || jsonb_build_object('idempotent', true);
  END IF;

  -- =====================================================
  -- STEP 2: Resolve user identity (handle ALL formats)
  -- =====================================================

  -- Normalize the identifier
  p_user_identifier := TRIM(p_user_identifier);

  -- Extract wallet address from various formats
  IF p_user_identifier LIKE 'prize:pid:0x%' THEN
    v_canonical_user_id := p_user_identifier;
    v_search_wallet := LOWER(SUBSTRING(p_user_identifier FROM 11));
  ELSIF p_user_identifier LIKE '0x%' AND LENGTH(p_user_identifier) = 42 THEN
    v_search_wallet := LOWER(p_user_identifier);
    v_canonical_user_id := 'prize:pid:' || v_search_wallet;
  ELSIF p_user_identifier LIKE 'did:privy:%' THEN
    v_privy_user_id := p_user_identifier;
    v_canonical_user_id := p_user_identifier; -- Will try to resolve below
  ELSE
    v_canonical_user_id := p_user_identifier;
  END IF;

  -- Try to find the user in canonical_users with aggressive matching
  SELECT
    cu.canonical_user_id,
    cu.uid,
    COALESCE(LOWER(cu.wallet_address), LOWER(cu.base_wallet_address), LOWER(cu.eth_wallet_address)),
    cu.privy_user_id
  INTO v_canonical_user_id, v_user_uuid, v_wallet_address, v_privy_user_id
  FROM canonical_users cu
  WHERE
    -- Match by canonical_user_id
    cu.canonical_user_id = p_user_identifier
    OR cu.canonical_user_id = v_canonical_user_id
    OR cu.canonical_user_id = LOWER(v_canonical_user_id)
    -- Match by wallet address (case-insensitive)
    OR (v_search_wallet IS NOT NULL AND (
      LOWER(cu.wallet_address) = v_search_wallet
      OR LOWER(cu.base_wallet_address) = v_search_wallet
      OR LOWER(cu.eth_wallet_address) = v_search_wallet
      OR LOWER(cu.smart_wallet_address) = v_search_wallet
    ))
    -- Match by privy_user_id
    OR cu.privy_user_id = p_user_identifier
    OR cu.privy_user_id = v_privy_user_id
    -- Match by uid if it's a UUID
    OR (p_user_identifier ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND cu.uid::TEXT = p_user_identifier)
  LIMIT 1;

  -- If still no canonical_user_id, use the best available
  IF v_canonical_user_id IS NULL THEN
    IF v_search_wallet IS NOT NULL THEN
      v_canonical_user_id := 'prize:pid:' || v_search_wallet;
    ELSE
      v_canonical_user_id := p_user_identifier;
    END IF;
  END IF;

  -- =====================================================
  -- STEP 3: Check competition status
  -- =====================================================

  SELECT status, title, total_tickets
  INTO v_competition_status, v_competition_title, v_max_tickets
  FROM competitions
  WHERE id = p_competition_id;

  IF v_competition_status IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Competition not found',
      'error_code', 'COMPETITION_NOT_FOUND'
    );
  END IF;

  IF v_competition_status NOT IN ('active', 'live') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Competition is not active (status: %s)', v_competition_status),
      'error_code', 'COMPETITION_NOT_ACTIVE'
    );
  END IF;

  -- =====================================================
  -- STEP 4: Get and lock user balance (with aggressive lookup)
  -- =====================================================

  -- Try sub_account_balances first (primary balance table)
  SELECT id, COALESCE(available_balance, 0)
  INTO v_balance_record_id, v_current_balance
  FROM sub_account_balances
  WHERE currency = 'USD'
    AND (
      canonical_user_id = v_canonical_user_id
      OR canonical_user_id = LOWER(v_canonical_user_id)
      OR (v_search_wallet IS NOT NULL AND canonical_user_id = 'prize:pid:' || v_search_wallet)
      OR user_id = p_user_identifier
      OR user_id = v_canonical_user_id
      OR privy_user_id = p_user_identifier
      OR privy_user_id = v_privy_user_id
    )
  ORDER BY
    CASE
      WHEN canonical_user_id = v_canonical_user_id THEN 0
      WHEN canonical_user_id = LOWER(v_canonical_user_id) THEN 1
      ELSE 2
    END
  LIMIT 1
  FOR UPDATE;  -- Lock the row for atomic update

  IF v_balance_record_id IS NOT NULL THEN
    v_balance_source := 'sub_account_balances';
  END IF;

  -- If not found, try wallet_balances
  IF v_balance_record_id IS NULL THEN
    SELECT COALESCE(balance, 0)
    INTO v_temp_balance
    FROM wallet_balances
    WHERE
      canonical_user_id = v_canonical_user_id
      OR canonical_user_id = LOWER(v_canonical_user_id)
      OR (v_search_wallet IS NOT NULL AND (
        LOWER(wallet_address) = v_search_wallet
        OR LOWER(base_wallet_address) = v_search_wallet
      ))
      OR user_id = p_user_identifier
      OR privy_user_id = p_user_identifier
    LIMIT 1
    FOR UPDATE;

    IF v_temp_balance IS NOT NULL THEN
      v_current_balance := v_temp_balance;
      v_balance_source := 'wallet_balances';
    END IF;
  END IF;

  -- If still not found, try canonical_users.usdc_balance
  IF v_balance_source = 'none' AND v_user_uuid IS NOT NULL THEN
    SELECT COALESCE(usdc_balance, 0)
    INTO v_temp_balance
    FROM canonical_users
    WHERE uid = v_user_uuid
    FOR UPDATE;

    IF v_temp_balance IS NOT NULL THEN
      v_current_balance := v_temp_balance;
      v_balance_source := 'canonical_users';
    END IF;
  END IF;

  -- Final fallback: aggressive canonical_users lookup
  IF v_balance_source = 'none' THEN
    SELECT cu.uid, COALESCE(cu.usdc_balance, 0)
    INTO v_user_uuid, v_temp_balance
    FROM canonical_users cu
    WHERE
      cu.canonical_user_id = v_canonical_user_id
      OR (v_search_wallet IS NOT NULL AND (
        LOWER(cu.wallet_address) = v_search_wallet
        OR LOWER(cu.base_wallet_address) = v_search_wallet
      ))
      OR cu.privy_user_id = p_user_identifier
    LIMIT 1
    FOR UPDATE;

    IF v_temp_balance IS NOT NULL THEN
      v_current_balance := v_temp_balance;
      v_balance_source := 'canonical_users';
    END IF;
  END IF;

  -- If no balance found anywhere
  IF v_balance_source = 'none' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No balance record found for user. Please top up your account first.',
      'error_code', 'NO_BALANCE_RECORD',
      'user_identifier', p_user_identifier,
      'canonical_user_id', v_canonical_user_id
    );
  END IF;

  -- Check sufficient balance
  IF v_current_balance < p_amount THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Insufficient balance. You have $%.2f but need $%.2f', v_current_balance, p_amount),
      'error_code', 'INSUFFICIENT_BALANCE',
      'current_balance', v_current_balance,
      'required_amount', p_amount
    );
  END IF;

  -- =====================================================
  -- STEP 5: Get available tickets
  -- =====================================================

  -- Get already sold tickets
  SELECT ARRAY_AGG(ticket_number)
  INTO v_used_tickets
  FROM tickets
  WHERE competition_id = p_competition_id;

  v_used_tickets := COALESCE(v_used_tickets, ARRAY[]::INTEGER[]);

  -- Check if enough tickets available
  IF v_max_tickets - COALESCE(array_length(v_used_tickets, 1), 0) < p_ticket_count THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Not enough tickets available',
      'error_code', 'INSUFFICIENT_TICKETS',
      'available', v_max_tickets - COALESCE(array_length(v_used_tickets, 1), 0),
      'requested', p_ticket_count
    );
  END IF;

  -- =====================================================
  -- STEP 6: Select tickets (prefer user selection, then random)
  -- =====================================================

  v_ticket_numbers := ARRAY[]::INTEGER[];

  -- If user specified tickets, try to use them
  IF p_selected_tickets IS NOT NULL AND array_length(p_selected_tickets, 1) > 0 THEN
    FOR i IN 1..array_length(p_selected_tickets, 1) LOOP
      IF NOT (p_selected_tickets[i] = ANY(v_used_tickets))
         AND p_selected_tickets[i] >= 1
         AND p_selected_tickets[i] <= v_max_tickets THEN
        v_ticket_numbers := array_append(v_ticket_numbers, p_selected_tickets[i]);
        IF array_length(v_ticket_numbers, 1) >= p_ticket_count THEN
          EXIT;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- Fill remaining with random selection
  IF COALESCE(array_length(v_ticket_numbers, 1), 0) < p_ticket_count THEN
    WITH all_tickets AS (
      SELECT generate_series(1, v_max_tickets) AS num
    ),
    available AS (
      SELECT num FROM all_tickets
      WHERE num NOT IN (SELECT UNNEST(v_used_tickets))
        AND num NOT IN (SELECT UNNEST(v_ticket_numbers))
      ORDER BY random()
      LIMIT (p_ticket_count - COALESCE(array_length(v_ticket_numbers, 1), 0))
    )
    SELECT array_agg(num) INTO v_ticket_numbers
    FROM (
      SELECT UNNEST(v_ticket_numbers) AS num
      UNION ALL
      SELECT num FROM available
    ) combined;
  END IF;

  IF COALESCE(array_length(v_ticket_numbers, 1), 0) < p_ticket_count THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Could not allocate enough tickets',
      'error_code', 'ALLOCATION_FAILED',
      'allocated', COALESCE(array_length(v_ticket_numbers, 1), 0),
      'requested', p_ticket_count
    );
  END IF;

  -- =====================================================
  -- STEP 7: Debit balance (update ALL balance tables atomically)
  -- =====================================================

  v_new_balance := ROUND(v_current_balance - p_amount, 2);

  -- Update sub_account_balances
  IF v_balance_record_id IS NOT NULL THEN
    UPDATE sub_account_balances
    SET available_balance = v_new_balance,
        last_updated = NOW()
    WHERE id = v_balance_record_id;
  ELSE
    -- Create record if it doesn't exist
    INSERT INTO sub_account_balances (
      canonical_user_id,
      user_id,
      currency,
      available_balance,
      pending_balance,
      last_updated
    ) VALUES (
      v_canonical_user_id,
      COALESCE(v_user_uuid::TEXT, v_canonical_user_id),
      'USD',
      v_new_balance,
      0,
      NOW()
    )
    ON CONFLICT (canonical_user_id, currency)
    DO UPDATE SET
      available_balance = v_new_balance,
      last_updated = NOW();
  END IF;

  -- Sync to wallet_balances
  UPDATE wallet_balances
  SET balance = v_new_balance,
      updated_at = NOW()
  WHERE canonical_user_id = v_canonical_user_id
     OR (v_search_wallet IS NOT NULL AND (
       LOWER(wallet_address) = v_search_wallet
       OR LOWER(base_wallet_address) = v_search_wallet
     ));

  -- Sync to canonical_users
  IF v_user_uuid IS NOT NULL THEN
    UPDATE canonical_users
    SET usdc_balance = v_new_balance
    WHERE uid = v_user_uuid;
  END IF;

  -- =====================================================
  -- STEP 8: Create tickets in database
  -- =====================================================

  v_entry_uid := gen_random_uuid();
  v_transaction_id := gen_random_uuid();

  INSERT INTO tickets (
    competition_id,
    user_id,
    ticket_number,
    created_at
  )
  SELECT
    p_competition_id,
    v_canonical_user_id,
    num,
    NOW()
  FROM UNNEST(v_ticket_numbers) AS num;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;

  IF v_row_count <> p_ticket_count THEN
    -- Rollback will happen automatically
    RAISE EXCEPTION 'Failed to create all tickets. Created: %, Expected: %', v_row_count, p_ticket_count;
  END IF;

  -- =====================================================
  -- STEP 9: Create entry in joincompetition
  -- =====================================================

  INSERT INTO joincompetition (
    uid,
    competitionid,
    userid,
    canonical_user_id,
    numberoftickets,
    ticketnumbers,
    amountspent,
    walletaddress,
    chain,
    transactionhash,
    purchasedate,
    created_at
  ) VALUES (
    v_entry_uid,
    p_competition_id,
    v_canonical_user_id,
    v_canonical_user_id,
    p_ticket_count,
    array_to_string(v_ticket_numbers, ','),
    p_amount,
    v_wallet_address,
    'balance',
    v_transaction_id::TEXT,
    NOW(),
    NOW()
  );

  -- =====================================================
  -- STEP 10: Create user_transactions record
  -- =====================================================

  INSERT INTO user_transactions (
    id,
    user_id,
    canonical_user_id,
    wallet_address,
    competition_id,
    amount,
    currency,
    status,
    payment_status,
    payment_provider,
    transaction_type,
    metadata,
    created_at,
    completed_at
  ) VALUES (
    v_transaction_id,
    v_canonical_user_id,
    v_canonical_user_id,
    v_wallet_address,
    p_competition_id,
    p_amount,
    'USD',
    'completed',
    'completed',
    'balance',
    'entry',
    jsonb_build_object(
      'ticket_count', p_ticket_count,
      'ticket_numbers', v_ticket_numbers,
      'entry_uid', v_entry_uid,
      'previous_balance', v_current_balance,
      'new_balance', v_new_balance
    ),
    NOW(),
    NOW()
  );

  -- =====================================================
  -- STEP 11: Create balance_ledger audit entry
  -- =====================================================

  INSERT INTO balance_ledger (
    canonical_user_id,
    user_id,
    transaction_type,
    amount,
    balance_type,
    source,
    currency,
    balance_before,
    balance_after,
    reference_id,
    description,
    metadata,
    created_at
  ) VALUES (
    v_canonical_user_id,
    v_user_uuid,
    'debit',
    -p_amount,
    'real',
    'ticket_purchase',
    'USD',
    v_current_balance,
    v_new_balance,
    v_entry_uid::TEXT,
    format('Purchase %s tickets for %s', p_ticket_count, COALESCE(v_competition_title, 'competition')),
    jsonb_build_object(
      'competition_id', p_competition_id,
      'ticket_count', p_ticket_count,
      'ticket_numbers', v_ticket_numbers
    ),
    NOW()
  );

  -- =====================================================
  -- STEP 12: Clear reservation if provided
  -- =====================================================

  IF p_reservation_id IS NOT NULL AND p_reservation_id <> '' AND p_reservation_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    UPDATE pending_tickets
    SET status = 'confirmed',
        confirmed_at = NOW()
    WHERE id = p_reservation_id::UUID
      AND status = 'pending';
  END IF;

  -- =====================================================
  -- STEP 13: Store result for idempotency
  -- =====================================================

  DECLARE
    v_result JSONB;
  BEGIN
    v_result := jsonb_build_object(
      'success', true,
      'entry_uid', v_entry_uid,
      'transaction_id', v_transaction_id,
      'tickets_created', p_ticket_count,
      'ticket_numbers', v_ticket_numbers,
      'amount_debited', p_amount,
      'previous_balance', v_current_balance,
      'new_balance', v_new_balance,
      'competition_id', p_competition_id,
      'competition_title', v_competition_title,
      'balance_source', v_balance_source,
      'canonical_user_id', v_canonical_user_id
    );

    -- Store for idempotency
    INSERT INTO payment_idempotency (
      idempotency_key,
      user_id,
      competition_id,
      amount,
      ticket_count,
      result
    ) VALUES (
      v_final_idempotency_key,
      v_canonical_user_id,
      p_competition_id,
      p_amount,
      p_ticket_count,
      v_result
    )
    ON CONFLICT (idempotency_key) DO NOTHING;

    RETURN v_result;
  END;

EXCEPTION
  WHEN OTHERS THEN
    -- Transaction automatically rolled back
    RETURN jsonb_build_object(
      'success', false,
      'error', SQLERRM,
      'error_code', SQLSTATE,
      'error_detail', format('Error in balance payment: %s', SQLERRM)
    );
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION execute_balance_payment(TEXT, UUID, NUMERIC, INTEGER, INTEGER[], TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION execute_balance_payment(TEXT, UUID, NUMERIC, INTEGER, INTEGER[], TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION execute_balance_payment(TEXT, UUID, NUMERIC, INTEGER, INTEGER[], TEXT, TEXT) TO anon;

COMMENT ON FUNCTION execute_balance_payment IS
'GODLIKE balance payment RPC - handles ALL user ID formats, atomic operations, and idempotency.
Frontend calls this single RPC and it JUST WORKS.';

-- =====================================================
-- PART 3: Cleanup old idempotency records (cron job helper)
-- =====================================================

CREATE OR REPLACE FUNCTION cleanup_expired_idempotency()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM payment_idempotency
  WHERE expires_at < NOW();

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN v_deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION cleanup_expired_idempotency() TO service_role;

-- =====================================================
-- VALIDATION
-- =====================================================

DO $$
DECLARE
  func_exists BOOLEAN;
  table_exists BOOLEAN;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'execute_balance_payment'
  ) INTO func_exists;

  SELECT EXISTS(
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'payment_idempotency'
  ) INTO table_exists;

  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'GODLIKE BALANCE PAYMENT RPC - MIGRATION COMPLETE';
  RAISE NOTICE '=====================================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Function created: %', func_exists;
  RAISE NOTICE 'Idempotency table created: %', table_exists;
  RAISE NOTICE '';
  RAISE NOTICE 'Usage:';
  RAISE NOTICE '  SELECT execute_balance_payment(';
  RAISE NOTICE '    user_identifier,    -- ANY format: wallet, prize:pid:, did:privy:, UUID';
  RAISE NOTICE '    competition_id,     -- UUID';
  RAISE NOTICE '    amount,             -- NUMERIC (e.g., 10.00)';
  RAISE NOTICE '    ticket_count,       -- INTEGER';
  RAISE NOTICE '    selected_tickets,   -- INTEGER[] (optional)';
  RAISE NOTICE '    idempotency_key,    -- TEXT (optional)';
  RAISE NOTICE '    reservation_id      -- TEXT (optional)';
  RAISE NOTICE '  );';
  RAISE NOTICE '';
  RAISE NOTICE 'Features:';
  RAISE NOTICE '  - Handles ALL user ID formats automatically';
  RAISE NOTICE '  - Atomic transaction (all-or-nothing)';
  RAISE NOTICE '  - Idempotent (same request = same result)';
  RAISE NOTICE '  - Updates ALL balance tables in sync';
  RAISE NOTICE '  - Creates entries in tickets, joincompetition, user_transactions';
  RAISE NOTICE '  - Detailed error messages for debugging';
  RAISE NOTICE '=====================================================';
END $$;

COMMIT;
