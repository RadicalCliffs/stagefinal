-- =====================================================
-- FIX: Balance Payment Missing Source and Metadata
-- =====================================================
-- ISSUE: Balance payment entries not showing on dashboard
-- 
-- ROOT CAUSE:
--   The execute_balance_payment function creates balance_ledger entries
--   but is missing two critical fields required by get_user_competition_entries RPC:
--   1. source = 'purchase' (RPC filters on this)
--   2. metadata JSONB with competition_id, ticket_count, ticket_numbers, etc.
--
-- SOLUTION:
--   Update the balance_ledger INSERT in execute_balance_payment to include
--   source and metadata fields so dashboard queries can find these entries.
--
-- Date: 2026-01-27
-- =====================================================

BEGIN;

-- Drop and recreate execute_balance_payment with the fixed balance_ledger insert
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
    RETURN v_existing_result;
  END IF;

  -- =====================================================
  -- STEP 2: Resolve user identity
  -- =====================================================

  -- Normalize identifier for searching
  v_search_wallet := NULL;
  IF p_user_identifier ~* '^0x[a-fA-F0-9]{40}$' THEN
    v_search_wallet := LOWER(p_user_identifier);
  END IF;

  -- Try to resolve user from canonical_users
  SELECT id, canonical_user_id, privy_user_id, wallet_address, base_wallet_address
  INTO v_user_uuid, v_canonical_user_id, v_privy_user_id, v_wallet_address, v_search_wallet
  FROM public.canonical_users
  WHERE id::TEXT = p_user_identifier
    OR canonical_user_id = p_user_identifier
    OR privy_user_id = p_user_identifier
    OR LOWER(wallet_address) = COALESCE(v_search_wallet, 'NOMATCH')
    OR LOWER(base_wallet_address) = COALESCE(v_search_wallet, 'NOMATCH')
  LIMIT 1;

  IF v_canonical_user_id IS NULL THEN
    -- Fallback: create canonical_user_id from identifier
    IF p_user_identifier LIKE 'prize:pid:%' THEN
      v_canonical_user_id := p_user_identifier;
    ELSIF p_user_identifier LIKE 'did:privy:%' THEN
      v_canonical_user_id := 'prize:pid:' || p_user_identifier;
    ELSIF p_user_identifier ~* '^0x[a-fA-F0-9]{40}$' THEN
      v_canonical_user_id := 'prize:pid:' || LOWER(p_user_identifier);
      v_wallet_address := LOWER(p_user_identifier);
    ELSE
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Could not resolve user identity',
        'error_code', 'USER_NOT_FOUND'
      );
    END IF;
  END IF;

  -- =====================================================
  -- STEP 3: Get competition details and validate
  -- =====================================================

  SELECT status, title
  INTO v_competition_status, v_competition_title
  FROM public.competitions
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
      'error', format('Competition is %s and not accepting entries', v_competition_status),
      'error_code', 'COMPETITION_NOT_ACTIVE'
    );
  END IF;

  -- =====================================================
  -- STEP 4: Get user's current balance
  -- =====================================================

  -- Try sub_account_balances first
  SELECT balance INTO v_current_balance
  FROM public.sub_account_balances
  WHERE canonical_user_id = v_canonical_user_id
    AND currency = 'USD';

  IF v_current_balance IS NOT NULL THEN
    v_balance_source := 'sub_account';
  ELSE
    -- Fallback to wallet_balances
    SELECT balance INTO v_current_balance
    FROM public.wallet_balances
    WHERE canonical_user_id = v_canonical_user_id;

    IF v_current_balance IS NOT NULL THEN
      v_balance_source := 'wallet';
    ELSE
      v_current_balance := 0;
      v_balance_source := 'none';
    END IF;
  END IF;

  -- =====================================================
  -- STEP 5: Check sufficient balance
  -- =====================================================

  IF v_current_balance < p_amount THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Insufficient balance. Have: $%s, Need: $%s', v_current_balance, p_amount),
      'error_code', 'INSUFFICIENT_BALANCE',
      'current_balance', v_current_balance,
      'required_amount', p_amount
    );
  END IF;

  -- =====================================================
  -- STEP 6: Debit the balance
  -- =====================================================

  v_new_balance := v_current_balance - p_amount;

  IF v_balance_source = 'sub_account' THEN
    UPDATE public.sub_account_balances
    SET balance = v_new_balance,
        updated_at = NOW()
    WHERE canonical_user_id = v_canonical_user_id
      AND currency = 'USD';

    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    IF v_row_count = 0 THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Failed to debit balance',
        'error_code', 'BALANCE_UPDATE_FAILED'
      );
    END IF;
  ELSIF v_balance_source = 'wallet' THEN
    UPDATE public.wallet_balances
    SET balance = v_new_balance,
        updated_at = NOW()
    WHERE canonical_user_id = v_canonical_user_id;

    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    IF v_row_count = 0 THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Failed to debit balance',
        'error_code', 'BALANCE_UPDATE_FAILED'
      );
    END IF;
  ELSE
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No balance record found',
      'error_code', 'NO_BALANCE_RECORD'
    );
  END IF;

  -- =====================================================
  -- STEP 7: Assign ticket numbers
  -- =====================================================

  SELECT max_tickets INTO v_max_tickets
  FROM public.competitions
  WHERE id = p_competition_id;

  IF v_max_tickets IS NULL THEN
    v_max_tickets := 10000; -- Default fallback
  END IF;

  -- Get already used tickets
  SELECT COALESCE(array_agg(ticket_number), ARRAY[]::INTEGER[])
  INTO v_used_tickets
  FROM public.tickets
  WHERE competition_id = p_competition_id
    AND status IN ('sold', 'reserved');

  -- Assign tickets
  IF p_selected_tickets IS NOT NULL AND array_length(p_selected_tickets, 1) > 0 THEN
    -- Validate selected tickets
    FOR i IN 1..array_length(p_selected_tickets, 1) LOOP
      IF p_selected_tickets[i] = ANY(v_used_tickets) THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', format('Ticket %s is already taken', p_selected_tickets[i]),
          'error_code', 'TICKET_NOT_AVAILABLE'
        );
      END IF;
    END LOOP;
    v_ticket_numbers := p_selected_tickets;
  ELSE
    -- Auto-assign random available tickets
    v_ticket_numbers := ARRAY[]::INTEGER[];
    FOR i IN 1..p_ticket_count LOOP
      DECLARE
        v_random_ticket INTEGER;
        v_attempts INTEGER := 0;
      BEGIN
        LOOP
          v_random_ticket := floor(random() * v_max_tickets)::INTEGER + 1;
          v_attempts := v_attempts + 1;

          IF NOT (v_random_ticket = ANY(v_used_tickets)) AND NOT (v_random_ticket = ANY(v_ticket_numbers)) THEN
            v_ticket_numbers := array_append(v_ticket_numbers, v_random_ticket);
            v_used_tickets := array_append(v_used_tickets, v_random_ticket);
            EXIT;
          END IF;

          IF v_attempts > 1000 THEN
            RETURN jsonb_build_object(
              'success', false,
              'error', 'Could not find available tickets',
              'error_code', 'NO_TICKETS_AVAILABLE'
            );
          END IF;
        END LOOP;
      END;
    END LOOP;
  END IF;

  -- =====================================================
  -- STEP 8: Create tickets
  -- =====================================================

  FOR i IN 1..array_length(v_ticket_numbers, 1) LOOP
    INSERT INTO public.tickets (
      competition_id,
      ticket_number,
      status,
      purchased_by,
      purchased_at,
      user_id,
      canonical_user_id,
      wallet_address,
      payment_provider,
      purchase_price
    ) VALUES (
      p_competition_id,
      v_ticket_numbers[i],
      'sold',
      v_canonical_user_id,
      NOW(),
      COALESCE(v_user_uuid::TEXT, v_canonical_user_id),
      v_canonical_user_id,
      v_wallet_address,
      'balance',
      (p_amount / p_ticket_count)
    );
  END LOOP;

  -- =====================================================
  -- STEP 9: Create joincompetition entry
  -- =====================================================

  v_entry_uid := gen_random_uuid();
  v_transaction_id := gen_random_uuid();

  INSERT INTO public.joincompetition (
    id,
    userid,
    canonical_user_id,
    wallet_address,
    competitionid,
    ticketnumbers,
    numberoftickets,
    amountspent,
    purchasedate,
    status,
    transactionhash,
    created_at,
    updated_at
  ) VALUES (
    v_entry_uid,
    v_canonical_user_id,
    v_canonical_user_id,
    COALESCE(v_wallet_address, v_search_wallet),
    p_competition_id::TEXT,
    array_to_string(v_ticket_numbers, ','),
    p_ticket_count,
    p_amount,
    NOW(),
    'confirmed',
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
  -- STEP 11: Create balance_ledger audit entry (FIXED WITH SOURCE AND METADATA)
  -- =====================================================

  INSERT INTO balance_ledger (
    user_id,
    canonical_user_id,
    transaction_type,
    amount,
    currency,
    balance_before,
    balance_after,
    reference_id,
    description,
    source,              -- ✅ ADDED: Required for dashboard queries
    transaction_id,
    metadata,            -- ✅ ADDED: Required for dashboard queries
    created_at
  ) VALUES (
    v_user_uuid,
    v_canonical_user_id,
    'debit',
    -p_amount,  -- Negative for debit
    'USD',
    v_current_balance,
    v_new_balance,
    v_entry_uid::TEXT,
    format('Purchase %s tickets for %s', p_ticket_count, COALESCE(v_competition_title, 'competition')),
    'purchase',          -- ✅ CRITICAL: RPC filters on source = 'purchase'
    v_transaction_id,
    jsonb_build_object(  -- ✅ CRITICAL: Dashboard needs this metadata
      'competition_id', p_competition_id::TEXT,
      'ticket_count', p_ticket_count,
      'ticket_numbers', array_to_string(v_ticket_numbers, ','),
      'canonical_user_id', v_canonical_user_id,
      'wallet_address', COALESCE(v_wallet_address, v_search_wallet),
      'payment_provider', 'balance',
      'transaction_hash', v_transaction_id::TEXT,
      'order_id', v_entry_uid::TEXT
    ),
    NOW()
  );

  -- =====================================================
  -- STEP 12: Clear reservation if provided
  -- =====================================================

  IF p_reservation_id IS NOT NULL THEN
    UPDATE public.pending_tickets
    SET status = 'confirmed',
        confirmed_at = NOW()
    WHERE reservation_id = p_reservation_id
      AND status = 'pending';
  END IF;

  -- =====================================================
  -- STEP 13: Store idempotency result
  -- =====================================================

  DECLARE
    v_success_result JSONB;
  BEGIN
    v_success_result := jsonb_build_object(
      'success', true,
      'transaction_id', v_transaction_id,
      'entry_id', v_entry_uid,
      'ticket_numbers', v_ticket_numbers,
      'amount_debited', p_amount,
      'new_balance', v_new_balance,
      'balance_source', v_balance_source
    );

    INSERT INTO public.payment_idempotency (
      idempotency_key,
      result,
      created_at,
      expires_at
    ) VALUES (
      v_final_idempotency_key,
      v_success_result,
      NOW(),
      NOW() + INTERVAL '24 hours'
    )
    ON CONFLICT (idempotency_key) DO UPDATE
    SET result = EXCLUDED.result,
        expires_at = EXCLUDED.expires_at;

    RETURN v_success_result;
  END;

EXCEPTION
  WHEN OTHERS THEN
    -- Log error and return failure
    RETURN jsonb_build_object(
      'success', false,
      'error', SQLERRM,
      'error_code', 'INTERNAL_ERROR'
    );
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION execute_balance_payment(TEXT, UUID, NUMERIC, INTEGER, INTEGER[], TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION execute_balance_payment(TEXT, UUID, NUMERIC, INTEGER, INTEGER[], TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION execute_balance_payment(TEXT, UUID, NUMERIC, INTEGER, INTEGER[], TEXT, TEXT) TO service_role;

COMMENT ON FUNCTION execute_balance_payment IS
'Execute a balance payment for competition entry.
FIXED: Now includes source=''purchase'' and metadata in balance_ledger insert
so that dashboard queries can find these entries.';

COMMIT;
