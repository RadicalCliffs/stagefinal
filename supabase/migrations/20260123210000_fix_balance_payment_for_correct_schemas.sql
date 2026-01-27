-- =====================================================
-- FIX BALANCE PAYMENT RPC FOR CORRECT TABLE SCHEMAS
-- =====================================================
-- This migration replaces the previous adaptive RPC with one that uses
-- the CORRECT schema based on user-confirmed table definitions.
--
-- CORRECT TABLE SCHEMAS (from user's actual database):
--
-- user_transactions:
--   id, user_id, canonical_user_id, wallet_address, type (entry/topup),
--   amount, currency, balance_before, balance_after, competition_id,
--   order_id, description, status, created_at, user_privy_id, metadata,
--   provider, tx_ref, payment_provider, payment_status, ticket_count,
--   updated_at, completed_at, tx_id, network, method
--
-- balance_ledger:
--   id, canonical_user_id, transaction_type, amount, currency,
--   balance_before, balance_after, reference_id, description, created_at
--
-- tickets:
--   id, competition_id, ticket_number, status, purchased_by, purchased_at,
--   order_id, created_at, user_id, purchase_price, is_active, is_winner,
--   privy_user_id, canonical_user_id, wallet_address, payment_provider, tx_id
--
-- joincompetition:
--   id, userid, wallet_address, competitionid, ticketnumbers, purchasedate,
--   status, created_at, uid, chain, transactionhash, numberoftickets,
--   amountspent, canonical_user_id, privy_user_id
--
-- Date: 2026-01-23
-- =====================================================

BEGIN;

-- =====================================================
-- PART 1: Drop the old adaptive function
-- =====================================================

DROP FUNCTION IF EXISTS execute_balance_payment(TEXT, UUID, NUMERIC, INTEGER, INTEGER[], TEXT, TEXT) CASCADE;

-- =====================================================
-- PART 2: Create the corrected RPC function
-- =====================================================

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
    MD5(
      p_user_identifier || '::' ||
      p_competition_id::TEXT || '::' ||
      p_amount::TEXT || '::' ||
      p_ticket_count::TEXT || '::' ||
      COALESCE(array_to_string(p_selected_tickets, ','), '')
    )
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
    v_canonical_user_id := p_user_identifier;
  ELSE
    v_canonical_user_id := p_user_identifier;
  END IF;

  -- Try to find the user in canonical_users
  SELECT
    cu.canonical_user_id,
    cu.id,
    COALESCE(LOWER(cu.wallet_address), LOWER(cu.base_wallet_address), LOWER(cu.eth_wallet_address)),
    cu.privy_user_id
  INTO v_canonical_user_id, v_user_uuid, v_wallet_address, v_privy_user_id
  FROM canonical_users cu
  WHERE
    cu.canonical_user_id = p_user_identifier
    OR cu.canonical_user_id = v_canonical_user_id
    OR cu.canonical_user_id = LOWER(v_canonical_user_id)
    OR (v_search_wallet IS NOT NULL AND (
      LOWER(cu.wallet_address) = v_search_wallet
      OR LOWER(cu.base_wallet_address) = v_search_wallet
      OR LOWER(cu.eth_wallet_address) = v_search_wallet
      OR LOWER(cu.smart_wallet_address) = v_search_wallet
    ))
    OR cu.privy_user_id = p_user_identifier
    OR cu.privy_user_id = v_privy_user_id
    OR (p_user_identifier ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND cu.id = p_user_identifier::uuid)
  LIMIT 1;

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
  -- STEP 4: Get and lock user balance
  -- =====================================================

  -- Try sub_account_balances first
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
      OR (v_user_uuid IS NOT NULL AND user_id = v_user_uuid::text)
    )
  ORDER BY
    CASE
      WHEN canonical_user_id = v_canonical_user_id THEN 0
      WHEN canonical_user_id = LOWER(v_canonical_user_id) THEN 1
      ELSE 2
    END
  LIMIT 1
  FOR UPDATE;

  IF v_balance_record_id IS NOT NULL THEN
    v_balance_source := 'sub_account_balances';
  END IF;

  -- Try canonical_users.usdc_balance if not found
  IF v_balance_source = 'none' AND v_user_uuid IS NOT NULL THEN
    SELECT COALESCE(usdc_balance, 0)
    INTO v_temp_balance
    FROM canonical_users
    WHERE id = v_user_uuid
    FOR UPDATE;

    IF v_temp_balance IS NOT NULL AND v_temp_balance > 0 THEN
      v_current_balance := v_temp_balance;
      v_balance_source := 'canonical_users';
    END IF;
  END IF;

  -- Final fallback: aggressive canonical_users lookup
  IF v_balance_source = 'none' THEN
    SELECT cu.id, COALESCE(cu.usdc_balance, 0)
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

    IF v_temp_balance IS NOT NULL AND v_temp_balance > 0 THEN
      v_current_balance := v_temp_balance;
      v_balance_source := 'canonical_users';
    END IF;
  END IF;

  -- If no balance found anywhere
  IF v_balance_source = 'none' OR v_current_balance <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No balance record found for user. Please top up your account first.',
      'error_code', 'NO_BALANCE_RECORD',
      'user_identifier', p_user_identifier,
      'canonical_user_id', v_canonical_user_id,
      'balance_found', v_current_balance
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

  -- Get used tickets from tickets table (CORRECT schema)
  SELECT ARRAY_AGG(ticket_number)
  INTO v_used_tickets
  FROM tickets
  WHERE competition_id = p_competition_id
    AND status IN ('sold', 'purchased', 'reserved');

  -- Also get from joincompetition as additional source
  IF v_used_tickets IS NULL THEN
    v_used_tickets := ARRAY[]::INTEGER[];
  END IF;

  -- Merge with joincompetition entries
  WITH jc_tickets AS (
    SELECT DISTINCT ticket_num::INTEGER AS ticket_num
    FROM joincompetition jc,
    LATERAL unnest(string_to_array(jc.ticketnumbers, ',')) AS ticket_num
    WHERE jc.competitionid = p_competition_id
      AND ticket_num ~ '^\d+$'
  )
  SELECT ARRAY_AGG(DISTINCT num)
  INTO v_used_tickets
  FROM (
    SELECT UNNEST(v_used_tickets) AS num
    UNION
    SELECT ticket_num AS num FROM jc_tickets
  ) combined;

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
  -- STEP 6: Select tickets
  -- =====================================================

  v_ticket_numbers := ARRAY[]::INTEGER[];

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
  -- STEP 7: Debit balance
  -- =====================================================

  v_new_balance := ROUND(v_current_balance - p_amount, 2);

  IF v_balance_record_id IS NOT NULL THEN
    UPDATE sub_account_balances
    SET available_balance = v_new_balance,
        last_updated = NOW()
    WHERE id = v_balance_record_id;
  ELSE
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

  -- Sync to canonical_users
  IF v_user_uuid IS NOT NULL THEN
    UPDATE canonical_users
    SET usdc_balance = v_new_balance
    WHERE id = v_user_uuid;
  END IF;

  -- =====================================================
  -- STEP 8: Create tickets (CORRECT schema)
  -- =====================================================

  v_entry_uid := gen_random_uuid();
  v_transaction_id := gen_random_uuid();

  -- Insert into tickets table with CORRECT column names
  INSERT INTO tickets (
    competition_id,
    ticket_number,
    status,
    user_id,
    canonical_user_id,
    wallet_address,
    purchase_price,
    purchased_at,
    payment_provider,
    tx_id,
    created_at
  )
  SELECT
    p_competition_id,
    num,
    'sold',
    v_canonical_user_id,
    v_canonical_user_id,
    v_wallet_address,
    ROUND(p_amount / p_ticket_count, 2),  -- price per ticket
    NOW(),
    'balance',
    v_transaction_id::TEXT,
    NOW()
  FROM UNNEST(v_ticket_numbers) AS num;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;

  IF v_row_count <> p_ticket_count THEN
    RAISE EXCEPTION 'Failed to create all tickets. Created: %, Expected: %', v_row_count, p_ticket_count;
  END IF;

  -- =====================================================
  -- STEP 9: Create entry in joincompetition
  -- =====================================================

  INSERT INTO joincompetition (
    id,
    competitionid,
    userid,
    canonical_user_id,
    privy_user_id,
    numberoftickets,
    ticketnumbers,
    amountspent,
    wallet_address,
    chain,
    transactionhash,
    purchasedate,
    created_at,
    status
  ) VALUES (
    v_entry_uid,
    p_competition_id,
    v_canonical_user_id,
    v_canonical_user_id,
    v_privy_user_id,
    p_ticket_count,
    array_to_string(v_ticket_numbers, ','),
    p_amount,
    COALESCE(v_wallet_address, v_search_wallet),
    'balance',
    v_transaction_id::TEXT,
    NOW(),
    NOW(),
    'sold'
  );

  -- =====================================================
  -- STEP 10: Create user_transactions record (CORRECT schema)
  -- =====================================================

  INSERT INTO user_transactions (
    id,
    user_id,
    canonical_user_id,
    wallet_address,
    type,
    amount,
    currency,
    balance_before,
    balance_after,
    competition_id,
    description,
    status,
    payment_status,
    payment_provider,
    ticket_count,
    tx_id,
    metadata,
    created_at,
    updated_at,
    completed_at
  ) VALUES (
    v_transaction_id,
    v_canonical_user_id,
    v_canonical_user_id,
    COALESCE(v_wallet_address, v_search_wallet),
    'entry',
    p_amount,
    'USD',
    v_current_balance,
    v_new_balance,
    p_competition_id,
    format('Purchase %s tickets for %s', p_ticket_count, COALESCE(v_competition_title, 'competition')),
    'completed',
    'completed',
    'balance',
    p_ticket_count,
    v_transaction_id::TEXT,
    jsonb_build_object(
      'ticket_numbers', v_ticket_numbers,
      'entry_uid', v_entry_uid
    ),
    NOW(),
    NOW(),
    NOW()
  );

  -- =====================================================
  -- STEP 11: Create balance_ledger audit entry (CORRECT schema)
  -- =====================================================

  INSERT INTO balance_ledger (
    canonical_user_id,
    transaction_type,
    amount,
    currency,
    balance_before,
    balance_after,
    reference_id,
    description,
    created_at
  ) VALUES (
    v_canonical_user_id,
    'debit',
    -p_amount,  -- Negative for debit
    'USD',
    v_current_balance,
    v_new_balance,
    v_entry_uid::TEXT,
    format('Purchase %s tickets for %s', p_ticket_count, COALESCE(v_competition_title, 'competition')),
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
'Balance payment RPC using CORRECT table schemas. Handles all user ID formats, atomic operations, and idempotency.';

-- =====================================================
-- VALIDATION
-- =====================================================

DO $$
DECLARE
  func_exists BOOLEAN;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'execute_balance_payment'
  ) INTO func_exists;

  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'BALANCE PAYMENT RPC (CORRECT SCHEMAS) - MIGRATION COMPLETE';
  RAISE NOTICE '=====================================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Function created: %', func_exists;
  RAISE NOTICE '';
  RAISE NOTICE 'Using CORRECT table schemas:';
  RAISE NOTICE '  - tickets: competition_id, ticket_number, status, user_id, canonical_user_id, etc.';
  RAISE NOTICE '  - user_transactions: user_id, type (entry/topup), amount, balance_before/after, etc.';
  RAISE NOTICE '  - balance_ledger: canonical_user_id, transaction_type, amount, currency, etc.';
  RAISE NOTICE '  - joincompetition: userid, competitionid, ticketnumbers, amountspent, etc.';
  RAISE NOTICE '';
  RAISE NOTICE 'Features:';
  RAISE NOTICE '  - Handles ALL user ID formats automatically';
  RAISE NOTICE '  - Atomic transaction (all-or-nothing)';
  RAISE NOTICE '  - Idempotent (same request = same result)';
  RAISE NOTICE '=====================================================';
END $$;

COMMIT;
