-- ============================================================================
-- FIX: Ensure idempotency key is UUID-safe in purchase_tickets_with_balance
-- ============================================================================
-- The idempotency key (p_idempotency_key) is stored in:
--   - balance_ledger.reference_id (TEXT)
--   - joincompetition.transactionhash (TEXT)
--   - tickets.tx_id (TEXT)
-- All are TEXT columns, but production database triggers may attempt to cast
-- reference_id or transactionhash to UUID, causing:
--   "invalid input syntax for type uuid: ..."
--
-- Fix: Sanitize p_idempotency_key at the start of the function.
-- If it's not a valid UUID, replace it with a generated UUID to ensure
-- compatibility with any trigger logic.
-- ============================================================================

DROP FUNCTION IF EXISTS purchase_tickets_with_balance(TEXT, TEXT, NUMERIC, INTEGER, INTEGER[], TEXT);

CREATE OR REPLACE FUNCTION purchase_tickets_with_balance(
  p_user_identifier TEXT,
  p_competition_id TEXT,
  p_ticket_price NUMERIC,
  p_ticket_count INTEGER DEFAULT NULL,
  p_ticket_numbers INTEGER[] DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_canonical_user_id TEXT;
  v_user_uuid TEXT;
  v_current_balance NUMERIC;
  v_total_cost NUMERIC;
  v_new_balance NUMERIC;
  v_final_tickets INTEGER[];
  v_competition_total_tickets INTEGER;
  v_competition_status TEXT;
  v_entry_id TEXT;
  v_ticket_numbers_str TEXT;
  v_used_tickets INTEGER[];
  v_available_tickets INTEGER[];
  v_needed_count INTEGER;
  v_i INTEGER;
  v_random_index INTEGER;
  v_ticket_number INTEGER;
  v_competition_uuid UUID;
  v_safe_idempotency_key TEXT;
BEGIN
  -- =====================================================
  -- STEP 0: Sanitize idempotency key to UUID format
  -- =====================================================
  -- Production triggers on balance_ledger and joincompetition may
  -- cast reference_id/transactionhash to UUID. Ensure the key is
  -- a valid UUID to prevent "invalid input syntax for type uuid" errors.

  IF p_idempotency_key IS NOT NULL THEN
    BEGIN
      -- Test if the key is a valid UUID by attempting a cast
      PERFORM p_idempotency_key::UUID;
      v_safe_idempotency_key := p_idempotency_key;
    EXCEPTION WHEN invalid_text_representation THEN
      -- Not a valid UUID - generate a new one
      v_safe_idempotency_key := gen_random_uuid()::TEXT;
      RAISE NOTICE 'Non-UUID idempotency key replaced: % -> %', LEFT(p_idempotency_key, 20), v_safe_idempotency_key;
    END;
  ELSE
    v_safe_idempotency_key := NULL;
  END IF;

  -- =====================================================
  -- STEP 1: Validate inputs
  -- =====================================================

  IF p_user_identifier IS NULL OR LENGTH(TRIM(p_user_identifier)) = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'User identifier is required'
    );
  END IF;

  IF p_competition_id IS NULL OR LENGTH(TRIM(p_competition_id)) = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Competition ID is required'
    );
  END IF;

  IF p_ticket_price IS NULL OR p_ticket_price <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Ticket price must be positive'
    );
  END IF;

  -- Must provide either ticket_count OR ticket_numbers (not both, not neither)
  IF (p_ticket_count IS NULL AND (p_ticket_numbers IS NULL OR array_length(p_ticket_numbers, 1) IS NULL)) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Must provide either ticket_count or ticket_numbers'
    );
  END IF;

  IF (p_ticket_count IS NOT NULL AND p_ticket_numbers IS NOT NULL AND array_length(p_ticket_numbers, 1) > 0) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Cannot provide both ticket_count and ticket_numbers'
    );
  END IF;

  -- =====================================================
  -- STEP 1b: Cast competition_id to UUID once
  -- =====================================================
  BEGIN
    v_competition_uuid := p_competition_id::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid competition ID format'
    );
  END;

  -- =====================================================
  -- STEP 2: Normalize user identifier to canonical format
  -- =====================================================

  -- Convert to lowercase if it's a wallet address
  IF p_user_identifier ~ '^0x[a-fA-F0-9]{40}$' THEN
    v_canonical_user_id := 'prize:pid:' || LOWER(p_user_identifier);
  ELSIF p_user_identifier LIKE 'prize:pid:%' THEN
    v_canonical_user_id := LOWER(p_user_identifier);
  ELSE
    -- For other formats (Privy DIDs, UUIDs), wrap in prize:pid:
    v_canonical_user_id := 'prize:pid:' || LOWER(p_user_identifier);
  END IF;

  -- =====================================================
  -- STEP 3: Check for idempotent duplicate
  -- =====================================================

  IF v_safe_idempotency_key IS NOT NULL THEN
    -- Check if we already processed this exact request
    -- Also check the original key in case it was stored before sanitization
    SELECT ticketnumbers, amountspent
    INTO v_ticket_numbers_str, v_total_cost
    FROM joincompetition
    WHERE competitionid = v_competition_uuid
      AND (userid = v_canonical_user_id OR userid = p_user_identifier)
      AND (transactionhash = v_safe_idempotency_key OR transactionhash = p_idempotency_key)
    LIMIT 1;

    IF FOUND THEN
      -- Already processed - return success with existing data
      SELECT available_balance INTO v_current_balance
      FROM sub_account_balances
      WHERE canonical_user_id = v_canonical_user_id AND currency = 'USD'
      LIMIT 1;

      RETURN jsonb_build_object(
        'success', true,
        'idempotent', true,
        'ticket_numbers', string_to_array(v_ticket_numbers_str, ',')::INTEGER[],
        'total_cost', v_total_cost,
        'available_balance', COALESCE(v_current_balance, 0),
        'message', 'Already processed'
      );
    END IF;
  END IF;

  -- =====================================================
  -- STEP 4: Get and lock user balance
  -- =====================================================

  SELECT available_balance, id
  INTO v_current_balance, v_user_uuid
  FROM sub_account_balances
  WHERE canonical_user_id = v_canonical_user_id AND currency = 'USD'
  FOR UPDATE; -- Lock row for atomic update

  IF NOT FOUND THEN
    -- Try to find user by wallet address (case-insensitive)
    IF p_user_identifier ~ '^0x[a-fA-F0-9]{40}$' THEN
      -- Look up user by wallet address in canonical_users
      SELECT sab.available_balance, sab.id
      INTO v_current_balance, v_user_uuid
      FROM sub_account_balances sab
      JOIN canonical_users cu ON cu.canonical_user_id = sab.canonical_user_id
      WHERE (LOWER(cu.wallet_address) = LOWER(p_user_identifier)
         OR LOWER(cu.base_wallet_address) = LOWER(p_user_identifier)
         OR LOWER(cu.eth_wallet_address) = LOWER(p_user_identifier))
        AND sab.currency = 'USD'
      LIMIT 1
      FOR UPDATE;
    END IF;

    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'User balance not found. Please top up your account first.',
        'error_code', 'NO_BALANCE_RECORD'
      );
    END IF;
  END IF;

  -- =====================================================
  -- STEP 5: Verify competition is active
  -- =====================================================

  SELECT total_tickets, status
  INTO v_competition_total_tickets, v_competition_status
  FROM competitions
  WHERE id = v_competition_uuid;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Competition not found'
    );
  END IF;

  IF v_competition_status != 'active' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Competition is not active',
      'competition_status', v_competition_status
    );
  END IF;

  -- =====================================================
  -- STEP 6: Determine final ticket numbers
  -- =====================================================

  IF p_ticket_numbers IS NOT NULL AND array_length(p_ticket_numbers, 1) > 0 THEN
    -- User selected specific tickets
    v_final_tickets := p_ticket_numbers;
  ELSE
    -- Lucky dip - allocate random available tickets
    v_final_tickets := ARRAY[]::INTEGER[];

    -- Get all used tickets (tickets.competition_id is UUID)
    SELECT array_agg(DISTINCT ticket_number)
    INTO v_used_tickets
    FROM tickets
    WHERE competition_id = v_competition_uuid AND ticket_number IS NOT NULL;

    -- Build array of available tickets (1 to total_tickets, excluding used)
    v_available_tickets := ARRAY[]::INTEGER[];
    FOR v_i IN 1..v_competition_total_tickets LOOP
      IF v_used_tickets IS NULL OR NOT (v_i = ANY(v_used_tickets)) THEN
        v_available_tickets := array_append(v_available_tickets, v_i);
      END IF;
    END LOOP;

    -- Check if we have enough available tickets
    IF array_length(v_available_tickets, 1) < p_ticket_count THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Not enough tickets available',
        'available_count', COALESCE(array_length(v_available_tickets, 1), 0),
        'requested_count', p_ticket_count
      );
    END IF;

    -- Randomly select tickets using Fisher-Yates shuffle
    v_needed_count := p_ticket_count;
    FOR v_i IN 1..v_needed_count LOOP
      v_random_index := 1 + floor(random() * (array_length(v_available_tickets, 1) - v_i + 1))::INTEGER;
      v_ticket_number := v_available_tickets[v_random_index];
      v_final_tickets := array_append(v_final_tickets, v_ticket_number);

      -- Swap selected with last unselected
      v_available_tickets[v_random_index] := v_available_tickets[array_length(v_available_tickets, 1) - v_i + 1];
    END LOOP;
  END IF;

  -- =====================================================
  -- STEP 7: Calculate total cost and check balance
  -- =====================================================

  v_total_cost := p_ticket_price * array_length(v_final_tickets, 1);

  IF v_current_balance < v_total_cost THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Insufficient balance',
      'error_code', 'INSUFFICIENT_BALANCE',
      'required', v_total_cost,
      'available', v_current_balance
    );
  END IF;

  v_new_balance := v_current_balance - v_total_cost;

  -- =====================================================
  -- STEP 8: Deduct balance atomically
  -- =====================================================

  UPDATE sub_account_balances
  SET
    available_balance = v_new_balance,
    updated_at = NOW()
  WHERE canonical_user_id = v_canonical_user_id AND currency = 'USD';

  -- =====================================================
  -- STEP 9: Create balance ledger entry for audit
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
    -v_total_cost,
    'USD',
    v_current_balance,
    v_new_balance,
    COALESCE(v_safe_idempotency_key, gen_random_uuid()::TEXT),
    'Purchase ' || array_length(v_final_tickets, 1) || ' tickets for competition',
    NOW()
  );

  -- =====================================================
  -- STEP 10: Create competition entry
  -- =====================================================

  v_entry_id := gen_random_uuid()::TEXT;
  v_ticket_numbers_str := array_to_string(v_final_tickets, ',');

  INSERT INTO joincompetition (
    uid,
    userid,
    competitionid,
    ticketnumbers,
    numberoftickets,
    amountspent,
    transactionhash,
    created_at,
    updated_at
  ) VALUES (
    v_entry_id::UUID,
    v_canonical_user_id,
    v_competition_uuid,
    v_ticket_numbers_str,
    array_length(v_final_tickets, 1),
    v_total_cost,
    COALESCE(v_safe_idempotency_key, v_entry_id),
    NOW(),
    NOW()
  );

  -- =====================================================
  -- STEP 11: Create ticket records
  -- =====================================================

  -- Insert individual ticket records for tracking
  -- Use DO block to handle potential schema differences
  BEGIN
    -- Try inserting with canonical_user_id column if it exists
    EXECUTE format('
      INSERT INTO tickets (
        competition_id,
        ticket_number,
        user_id,
        canonical_user_id,
        status,
        tx_id,
        created_at
      )
      SELECT
        $1::UUID,
        unnest($2::INTEGER[]),
        $3,
        $4,
        ''sold'',
        $5,
        NOW()
    ')
    USING p_competition_id, v_final_tickets, v_canonical_user_id, v_canonical_user_id, COALESCE(v_safe_idempotency_key, v_entry_id);
  EXCEPTION WHEN OTHERS THEN
    -- If canonical_user_id column doesn't exist, try without it
    BEGIN
      INSERT INTO tickets (
        competition_id,
        ticket_number,
        user_id,
        status,
        tx_id,
        created_at
      )
      SELECT
        v_competition_uuid,
        unnest(v_final_tickets),
        v_canonical_user_id,
        'sold',
        COALESCE(v_safe_idempotency_key, v_entry_id),
        NOW();
    EXCEPTION WHEN OTHERS THEN
      -- Ticket table insert failed, but entry is created (joincompetition is source of truth)
      -- Log the error but don't fail the transaction
      RAISE NOTICE 'Failed to insert tickets: %', SQLERRM;
    END;
  END;

  -- =====================================================
  -- STEP 12: Return success
  -- =====================================================

  RETURN jsonb_build_object(
    'success', true,
    'entry_id', v_entry_id,
    'ticket_numbers', v_final_tickets,
    'ticket_count', array_length(v_final_tickets, 1),
    'total_cost', v_total_cost,
    'previous_balance', v_current_balance,
    'available_balance', v_new_balance,
    'competition_id', p_competition_id
  );

EXCEPTION
  WHEN OTHERS THEN
    -- Catch any unexpected errors
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Internal error: ' || SQLERRM,
      'error_code', 'INTERNAL_ERROR'
    );
END;
$$;

-- =====================================================
-- SECURITY: Restrict to service_role only
-- =====================================================

REVOKE ALL ON FUNCTION purchase_tickets_with_balance(TEXT, TEXT, NUMERIC, INTEGER, INTEGER[], TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purchase_tickets_with_balance(TEXT, TEXT, NUMERIC, INTEGER, INTEGER[], TEXT) TO service_role;

COMMENT ON FUNCTION purchase_tickets_with_balance IS
  'Atomic balance payment: checks balance, deducts, allocates tickets. Sanitizes idempotency key to UUID format for trigger compatibility.';
