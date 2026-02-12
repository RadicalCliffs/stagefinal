-- ============================================================================
-- Add validation to limit ticket purchases to 999 per transaction
-- ============================================================================
--
-- Problem: Users can experience transaction failures when purchasing
-- around 2,000 tickets in a single transaction. To prevent this, we
-- add a hard limit of 999 tickets per purchase.
--
-- Users can still make multiple purchases to acquire more tickets,
-- but each individual transaction is capped at 999.
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
  v_existing_entry_uid TEXT;
  v_existing_tickets TEXT;
  v_existing_amount NUMERIC;
  v_existing_count INTEGER;
  v_merged_tickets TEXT;
  v_merged_array INTEGER[];
  v_existing_ticket_array INTEGER[];
  v_deduplicated_count INTEGER;
  v_requested_ticket_count INTEGER;
BEGIN
  -- =====================================================
  -- STEP 0: Sanitize idempotency key to UUID format
  -- =====================================================
  IF p_idempotency_key IS NOT NULL THEN
    BEGIN
      PERFORM p_idempotency_key::UUID;
      v_safe_idempotency_key := p_idempotency_key;
    EXCEPTION WHEN invalid_text_representation THEN
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
    RETURN jsonb_build_object('success', false, 'error', 'User identifier is required');
  END IF;

  IF p_competition_id IS NULL OR LENGTH(TRIM(p_competition_id)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Competition ID is required');
  END IF;

  IF p_ticket_price IS NULL OR p_ticket_price <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Ticket price must be positive');
  END IF;

  IF (p_ticket_count IS NULL AND (p_ticket_numbers IS NULL OR array_length(p_ticket_numbers, 1) IS NULL)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Must provide either ticket_count or ticket_numbers');
  END IF;

  IF (p_ticket_count IS NOT NULL AND p_ticket_numbers IS NOT NULL AND array_length(p_ticket_numbers, 1) > 0) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot provide both ticket_count and ticket_numbers');
  END IF;

  -- NEW: Validate ticket purchase limit (999 per transaction)
  v_requested_ticket_count := COALESCE(p_ticket_count, array_length(p_ticket_numbers, 1));
  IF v_requested_ticket_count > 999 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Cannot purchase more than 999 tickets per transaction',
      'error_code', 'TICKET_LIMIT_EXCEEDED',
      'requested_count', v_requested_ticket_count,
      'max_allowed', 999
    );
  END IF;

  -- =====================================================
  -- STEP 1b: Cast competition_id to UUID once
  -- =====================================================
  BEGIN
    v_competition_uuid := p_competition_id::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid competition ID format');
  END;

  -- =====================================================
  -- STEP 2: Normalize user identifier to canonical format
  -- =====================================================
  IF p_user_identifier ~ '^0x[a-fA-F0-9]{40}$' THEN
    v_canonical_user_id := 'prize:pid:' || LOWER(p_user_identifier);
  ELSIF p_user_identifier LIKE 'prize:pid:%' THEN
    v_canonical_user_id := LOWER(p_user_identifier);
  ELSE
    v_canonical_user_id := 'prize:pid:' || LOWER(p_user_identifier);
  END IF;

  -- =====================================================
  -- STEP 3: Check for idempotent duplicate (same txhash)
  -- =====================================================
  IF v_safe_idempotency_key IS NOT NULL THEN
    SELECT ticketnumbers, amountspent
    INTO v_ticket_numbers_str, v_total_cost
    FROM joincompetition
    WHERE competitionid = v_competition_uuid
      AND (userid = v_canonical_user_id OR userid = p_user_identifier)
      AND (transactionhash = v_safe_idempotency_key OR transactionhash = p_idempotency_key)
    LIMIT 1;

    IF FOUND THEN
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
  FOR UPDATE;

  IF NOT FOUND THEN
    IF p_user_identifier ~ '^0x[a-fA-F0-9]{40}$' THEN
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
    RETURN jsonb_build_object('success', false, 'error', 'Competition not found');
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
  -- For lucky dip (p_ticket_count given): randomly select from available pool
  -- For manual selection (p_ticket_numbers given): use provided numbers,
  --   but if any are taken, automatically replace them with random available
  --   tickets so the purchase never fails unless the competition is sold out.
  -- =====================================================

  -- First, build the set of all used/unavailable tickets
  SELECT array_agg(DISTINCT ticket_number)
  INTO v_used_tickets
  FROM tickets
  WHERE competition_id = v_competition_uuid AND ticket_number IS NOT NULL;

  v_used_tickets := COALESCE(v_used_tickets, ARRAY[]::INTEGER[]);

  -- Build available tickets pool
  v_available_tickets := ARRAY[]::INTEGER[];
  FOR v_i IN 1..v_competition_total_tickets LOOP
    IF NOT (v_i = ANY(v_used_tickets)) THEN
      v_available_tickets := array_append(v_available_tickets, v_i);
    END IF;
  END LOOP;

  IF p_ticket_numbers IS NOT NULL AND array_length(p_ticket_numbers, 1) > 0 THEN
    -- Specific ticket numbers provided (e.g. from a reservation).
    -- Validate each requested ticket: keep available ones, replace taken ones
    -- with random available tickets. This ensures the purchase always succeeds
    -- even if some reserved tickets were grabbed between reservation and purchase.
    v_final_tickets := ARRAY[]::INTEGER[];
    v_needed_count := 0;

    -- First pass: keep tickets that are still available
    FOR v_i IN 1..array_length(p_ticket_numbers, 1) LOOP
      IF p_ticket_numbers[v_i] = ANY(v_available_tickets) THEN
        v_final_tickets := array_append(v_final_tickets, p_ticket_numbers[v_i]);
      ELSE
        -- This ticket is no longer available, need a replacement
        v_needed_count := v_needed_count + 1;
      END IF;
    END LOOP;

    -- Second pass: replace unavailable tickets with random available ones
    IF v_needed_count > 0 THEN
      -- Remove already-selected tickets from available pool
      v_available_tickets := ARRAY(
        SELECT unnest(v_available_tickets)
        EXCEPT
        SELECT unnest(v_final_tickets)
      );

      IF COALESCE(array_length(v_available_tickets, 1), 0) < v_needed_count THEN
        -- Not enough replacements available = competition is effectively sold out
        -- for the requested quantity. Only fail here.
        RETURN jsonb_build_object(
          'success', false,
          'error', 'Not enough tickets available',
          'available_count', COALESCE(array_length(v_available_tickets, 1), 0) + array_length(v_final_tickets, 1),
          'requested_count', array_length(p_ticket_numbers, 1)
        );
      END IF;

      -- Randomly pick replacements from the remaining available pool
      FOR v_i IN 1..v_needed_count LOOP
        v_random_index := 1 + floor(random() * (array_length(v_available_tickets, 1) - v_i + 1))::INTEGER;
        v_ticket_number := v_available_tickets[v_random_index];
        v_final_tickets := array_append(v_final_tickets, v_ticket_number);
        -- Swap to end to avoid re-picking
        v_available_tickets[v_random_index] := v_available_tickets[array_length(v_available_tickets, 1) - v_i + 1];
      END LOOP;

      RAISE NOTICE 'Replaced % unavailable tickets with random available ones', v_needed_count;
    END IF;
  ELSE
    -- Lucky dip mode: randomly select from available pool
    v_final_tickets := ARRAY[]::INTEGER[];

    IF array_length(v_available_tickets, 1) IS NULL OR array_length(v_available_tickets, 1) < p_ticket_count THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Not enough tickets available',
        'available_count', COALESCE(array_length(v_available_tickets, 1), 0),
        'requested_count', p_ticket_count
      );
    END IF;

    v_needed_count := p_ticket_count;
    FOR v_i IN 1..v_needed_count LOOP
      v_random_index := 1 + floor(random() * (array_length(v_available_tickets, 1) - v_i + 1))::INTEGER;
      v_ticket_number := v_available_tickets[v_random_index];
      v_final_tickets := array_append(v_final_tickets, v_ticket_number);
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
  -- WRAPPED IN EXCEPTION HANDLER: non-blocking audit log
  -- =====================================================
  BEGIN
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
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'balance_ledger insert failed (non-blocking): %', SQLERRM;
  END;

  -- =====================================================
  -- STEP 10: Create or UPDATE competition entry
  -- CRITICAL FIX: Production has a UNIQUE constraint
  -- joincompetition_unique_user_competition on
  -- (canonical_user_id, competitionid). When a user buys
  -- additional tickets for the same competition, we must
  -- UPDATE the existing row instead of INSERT.
  --
  -- DEDUPLICATION: When merging ticket numbers, we ensure
  -- no duplicate ticket numbers appear in the final string.
  -- =====================================================
  v_entry_id := gen_random_uuid()::TEXT;
  v_ticket_numbers_str := array_to_string(v_final_tickets, ',');

  -- Check if user already has an entry for this competition
  SELECT uid, ticketnumbers, amountspent, numberoftickets
  INTO v_existing_entry_uid, v_existing_tickets, v_existing_amount, v_existing_count
  FROM joincompetition
  WHERE canonical_user_id = v_canonical_user_id
    AND competitionid = v_competition_uuid
  LIMIT 1;

  IF v_existing_entry_uid IS NOT NULL THEN
    -- User already has an entry: APPEND tickets and UPDATE totals
    -- DEDUPLICATE: Merge existing + new, remove duplicates
    RAISE NOTICE 'Existing entry found (uid=%): appending % new tickets with deduplication', v_existing_entry_uid, array_length(v_final_tickets, 1);

    -- Parse existing tickets into array
    IF v_existing_tickets IS NOT NULL AND LENGTH(TRIM(v_existing_tickets)) > 0 THEN
      SELECT array_agg(CAST(TRIM(n) AS INTEGER))
      INTO v_existing_ticket_array
      FROM unnest(string_to_array(v_existing_tickets, ',')) AS n
      WHERE TRIM(n) != '' AND TRIM(n) ~ '^\d+$';
    ELSE
      v_existing_ticket_array := ARRAY[]::INTEGER[];
    END IF;

    v_existing_ticket_array := COALESCE(v_existing_ticket_array, ARRAY[]::INTEGER[]);

    -- Merge and deduplicate: combine existing + new, keep only unique values
    SELECT array_agg(DISTINCT u ORDER BY u)
    INTO v_merged_array
    FROM (
      SELECT unnest(v_existing_ticket_array) AS u
      UNION
      SELECT unnest(v_final_tickets) AS u
    ) combined
    WHERE u IS NOT NULL;

    v_merged_array := COALESCE(v_merged_array, v_final_tickets);
    v_merged_tickets := array_to_string(v_merged_array, ',');
    v_deduplicated_count := array_length(v_merged_array, 1);

    BEGIN
      UPDATE joincompetition
      SET
        ticketnumbers = v_merged_tickets,
        numberoftickets = v_deduplicated_count,
        amountspent = COALESCE(v_existing_amount, 0) + v_total_cost,
        updated_at = NOW()
      WHERE canonical_user_id = v_canonical_user_id
        AND competitionid = v_competition_uuid;

      v_entry_id := v_existing_entry_uid;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'joincompetition UPDATE failed: %, refunding balance', SQLERRM;
      UPDATE sub_account_balances
      SET available_balance = v_current_balance, updated_at = NOW()
      WHERE canonical_user_id = v_canonical_user_id AND currency = 'USD';

      RETURN jsonb_build_object(
        'success', false,
        'error', 'Failed to update competition entry: ' || SQLERRM,
        'error_code', 'ENTRY_UPDATE_FAILED'
      );
    END;
  ELSE
    -- No existing entry: INSERT new row
    BEGIN
      INSERT INTO joincompetition (
        uid,
        userid,
        competitionid,
        ticketnumbers,
        numberoftickets,
        amountspent,
        transactionhash,
        canonical_user_id,
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
        v_canonical_user_id,
        NOW(),
        NOW()
      );
    EXCEPTION WHEN unique_violation THEN
      -- Race condition: another transaction inserted between our SELECT and INSERT.
      -- Handle by updating instead, with deduplication.
      RAISE NOTICE 'INSERT hit unique_violation, falling back to UPDATE with deduplication';

      SELECT uid, ticketnumbers, amountspent, numberoftickets
      INTO v_existing_entry_uid, v_existing_tickets, v_existing_amount, v_existing_count
      FROM joincompetition
      WHERE canonical_user_id = v_canonical_user_id
        AND competitionid = v_competition_uuid
      LIMIT 1;

      -- Parse existing tickets
      IF v_existing_tickets IS NOT NULL AND LENGTH(TRIM(v_existing_tickets)) > 0 THEN
        SELECT array_agg(CAST(TRIM(n) AS INTEGER))
        INTO v_existing_ticket_array
        FROM unnest(string_to_array(v_existing_tickets, ',')) AS n
        WHERE TRIM(n) != '' AND TRIM(n) ~ '^\d+$';
      ELSE
        v_existing_ticket_array := ARRAY[]::INTEGER[];
      END IF;

      v_existing_ticket_array := COALESCE(v_existing_ticket_array, ARRAY[]::INTEGER[]);

      -- Merge and deduplicate
      SELECT array_agg(DISTINCT u ORDER BY u)
      INTO v_merged_array
      FROM (
        SELECT unnest(v_existing_ticket_array) AS u
        UNION
        SELECT unnest(v_final_tickets) AS u
      ) combined
      WHERE u IS NOT NULL;

      v_merged_array := COALESCE(v_merged_array, v_final_tickets);
      v_merged_tickets := array_to_string(v_merged_array, ',');
      v_deduplicated_count := array_length(v_merged_array, 1);

      UPDATE joincompetition
      SET
        ticketnumbers = v_merged_tickets,
        numberoftickets = v_deduplicated_count,
        amountspent = COALESCE(v_existing_amount, 0) + v_total_cost,
        updated_at = NOW()
      WHERE canonical_user_id = v_canonical_user_id
        AND competitionid = v_competition_uuid;

      v_entry_id := COALESCE(v_existing_entry_uid, v_entry_id);
    WHEN OTHERS THEN
      -- Some other error - refund and report
      RAISE NOTICE 'joincompetition INSERT failed: %, refunding balance', SQLERRM;
      UPDATE sub_account_balances
      SET available_balance = v_current_balance, updated_at = NOW()
      WHERE canonical_user_id = v_canonical_user_id AND currency = 'USD';

      RETURN jsonb_build_object(
        'success', false,
        'error', 'Failed to create competition entry: ' || SQLERRM,
        'error_code', 'ENTRY_CREATION_FAILED'
      );
    END;
  END IF;

  -- =====================================================
  -- STEP 11: Create ticket records
  -- Also include canonical_user_id to prevent trigger issues
  -- Use ON CONFLICT to skip any duplicate ticket_number
  -- for this competition (prevents constraint errors)
  -- =====================================================
  BEGIN
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
      v_competition_uuid,
      unnest(v_final_tickets),
      v_canonical_user_id,
      v_canonical_user_id,
      'sold',
      COALESCE(v_safe_idempotency_key, v_entry_id),
      NOW()
    ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Failed to insert tickets: %', SQLERRM;
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
  'Atomic balance payment with deduplication and 999 ticket per transaction limit. Handles joincompetition_unique_user_competition constraint by upserting. Deduplicates ticket numbers when merging to prevent same number appearing more than once per row. Lucky dip mode only fails when competition is fully sold out.';
