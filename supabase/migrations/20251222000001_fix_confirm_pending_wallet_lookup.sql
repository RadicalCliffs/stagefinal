/*
  # Fix Wallet Lookup in confirm_pending_to_sold RPC

  ## Problem
  The `confirm_pending_to_sold` function tries to look up the user's wallet address
  by querying `privy_user_connections` WHERE `privy_user_id = v_reservation.user_id`.

  However, for Base auth users:
  - `v_reservation.user_id` contains the wallet address (e.g., 0x1234...) because
    that's what `baseUser.id` is set to in the frontend (AuthContext.tsx)
  - The `privy_user_id` column may contain a Privy DID (did:privy:xxx) for users
    who were originally Privy users, not the wallet address

  This causes the wallet lookup to fail, and tickets cannot be confirmed properly.

  ## Solution
  Update the wallet lookup query to check:
  1. `privy_user_id` (original behavior for Privy DIDs)
  2. `wallet_address` (for Base auth users where user_id IS the wallet address)
  3. `base_wallet_address` (alternative wallet address column)

  This ensures we can find the user regardless of how they authenticated.

  ## Impact
  - Base auth users will be able to reserve and confirm tickets
  - The system will work for both legacy Privy users and new Base auth users
*/

-- Drop and recreate the function with improved wallet lookup
CREATE OR REPLACE FUNCTION confirm_pending_to_sold(
  p_reservation_id UUID,
  p_transaction_hash TEXT DEFAULT NULL,
  p_payment_provider TEXT DEFAULT 'balance',
  p_wallet_address TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_reservation RECORD;
  v_join_uid UUID;
  v_ticket_num INTEGER;
  v_inserted_tickets INTEGER := 0;
  v_competition_uid TEXT;
  v_user_privy_wallet TEXT;
  v_is_wallet_address BOOLEAN;
  v_normalized_user_id TEXT;
BEGIN
  -- Step 1: Lock and fetch the pending reservation
  SELECT * INTO v_reservation
  FROM pending_tickets
  WHERE id = p_reservation_id
  FOR UPDATE SKIP LOCKED;

  -- Check if reservation exists
  IF v_reservation IS NULL THEN
    -- Check if it's already confirmed
    SELECT status INTO v_reservation
    FROM pending_tickets
    WHERE id = p_reservation_id;

    IF v_reservation.status = 'confirmed' THEN
      RETURN jsonb_build_object(
        'success', true,
        'message', 'Reservation already confirmed',
        'already_confirmed', true,
        'reservation_id', p_reservation_id
      );
    END IF;

    RETURN jsonb_build_object(
      'success', false,
      'error', 'Reservation not found or locked by another process'
    );
  END IF;

  -- Check current status
  IF v_reservation.status = 'confirmed' THEN
    RETURN jsonb_build_object(
      'success', true,
      'message', 'Reservation already confirmed',
      'already_confirmed', true,
      'reservation_id', p_reservation_id
    );
  END IF;

  IF v_reservation.status != 'pending' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Reservation status is ' || v_reservation.status || ', cannot confirm'
    );
  END IF;

  -- Check if reservation has expired
  IF v_reservation.expires_at < NOW() THEN
    -- Mark as expired
    UPDATE pending_tickets
    SET status = 'expired', updated_at = NOW()
    WHERE id = p_reservation_id;

    RETURN jsonb_build_object(
      'success', false,
      'error', 'Reservation has expired',
      'expired_at', v_reservation.expires_at
    );
  END IF;

  -- Step 2: Mark as 'confirming' to prevent race conditions
  UPDATE pending_tickets
  SET status = 'confirming', updated_at = NOW()
  WHERE id = p_reservation_id
    AND status = 'pending';

  -- Get competition UID for joincompetition compatibility
  SELECT uid INTO v_competition_uid
  FROM competitions
  WHERE id = v_reservation.competition_id;

  -- FIX: Improved wallet address lookup
  -- For Base auth users, v_reservation.user_id IS the wallet address (0x...)
  -- For legacy Privy users, v_reservation.user_id is a DID (did:privy:xxx)
  -- We need to look up the user by either identifier
  IF p_wallet_address IS NULL THEN
    -- Check if user_id looks like a wallet address (0x + 40 hex chars)
    v_is_wallet_address := v_reservation.user_id ~ '^0x[a-fA-F0-9]{40}$';

    IF v_is_wallet_address THEN
      -- User ID IS the wallet address (Base auth users)
      -- Use case-insensitive comparison for Ethereum addresses
      v_normalized_user_id := LOWER(v_reservation.user_id);

      -- First try: user_id IS the wallet, so use it directly
      v_user_privy_wallet := v_reservation.user_id;

      -- Verify the user exists in privy_user_connections
      -- Look up by wallet_address, base_wallet_address, or privy_user_id
      PERFORM 1 FROM privy_user_connections
      WHERE LOWER(wallet_address) = v_normalized_user_id
         OR LOWER(base_wallet_address) = v_normalized_user_id
         OR LOWER(privy_user_id) = v_normalized_user_id
      LIMIT 1;

      -- If user found, v_user_privy_wallet is already set correctly
      -- If not found, still use the reservation user_id (the wallet address)

    ELSE
      -- User ID is a Privy DID - look up their wallet address
      SELECT wallet_address INTO v_user_privy_wallet
      FROM privy_user_connections
      WHERE privy_user_id = v_reservation.user_id
      LIMIT 1;
    END IF;
  ELSE
    v_user_privy_wallet := p_wallet_address;
  END IF;

  -- Step 3: Insert ticket records into tickets table
  FOREACH v_ticket_num IN ARRAY v_reservation.ticket_numbers LOOP
    BEGIN
      INSERT INTO tickets (
        competition_id,
        ticket_number,
        privy_user_id,
        order_id,
        purchase_price,
        created_at
      ) VALUES (
        v_reservation.competition_id,
        v_ticket_num,
        v_reservation.user_id,
        p_reservation_id,
        v_reservation.ticket_price,
        NOW()
      )
      ON CONFLICT (competition_id, ticket_number) DO NOTHING;

      v_inserted_tickets := v_inserted_tickets + 1;
    EXCEPTION WHEN OTHERS THEN
      -- Log but continue - ticket may already exist
      RAISE NOTICE 'Could not insert ticket %: %', v_ticket_num, SQLERRM;
    END;
  END LOOP;

  -- Step 4: Create joincompetition entry
  v_join_uid := gen_random_uuid();

  INSERT INTO joincompetition (
    uid,
    competitionid,
    userid,
    privy_user_id,
    numberoftickets,
    ticketnumbers,
    amountspent,
    wallet_address,
    chain,
    transactionhash,
    purchasedate,
    created_at
  ) VALUES (
    v_join_uid,
    v_reservation.competition_id::TEXT,
    v_reservation.user_id,
    v_reservation.user_id,
    array_length(v_reservation.ticket_numbers, 1),
    array_to_string(v_reservation.ticket_numbers, ','),
    v_reservation.total_amount,
    v_user_privy_wallet,
    COALESCE(p_payment_provider, 'USDC'),
    COALESCE(p_transaction_hash, p_reservation_id::TEXT),
    NOW(),
    NOW()
  )
  ON CONFLICT DO NOTHING;

  -- Step 5: Mark pending_tickets as confirmed
  UPDATE pending_tickets
  SET
    status = 'confirmed',
    transaction_hash = COALESCE(p_transaction_hash, p_reservation_id::TEXT),
    payment_provider = p_payment_provider,
    confirmed_at = NOW(),
    updated_at = NOW()
  WHERE id = p_reservation_id;

  -- Return success with details
  RETURN jsonb_build_object(
    'success', true,
    'reservation_id', p_reservation_id,
    'join_competition_uid', v_join_uid,
    'ticket_numbers', v_reservation.ticket_numbers,
    'ticket_count', array_length(v_reservation.ticket_numbers, 1),
    'tickets_inserted', v_inserted_tickets,
    'total_amount', v_reservation.total_amount,
    'competition_id', v_reservation.competition_id,
    'user_id', v_reservation.user_id,
    'wallet_address', v_user_privy_wallet,
    'message', 'Successfully converted pending reservation to confirmed tickets'
  );

EXCEPTION WHEN OTHERS THEN
  -- Rollback the confirming status if something fails
  UPDATE pending_tickets
  SET status = 'pending', updated_at = NOW()
  WHERE id = p_reservation_id
    AND status = 'confirming';

  RETURN jsonb_build_object(
    'success', false,
    'error', 'Failed to confirm reservation: ' || SQLERRM,
    'retryable', true
  );
END;
$$;

COMMENT ON FUNCTION confirm_pending_to_sold IS
'Atomically converts a pending ticket reservation to sold tickets.
Moves ticket numbers to the tickets table, creates joincompetition entry,
and marks the pending row as confirmed - all in a single transaction.

FIXED: Improved wallet address lookup for Base auth users where user_id
is the wallet address, not a Privy DID. Uses case-insensitive matching
for Ethereum addresses.';

-- Ensure permissions are set
GRANT EXECUTE ON FUNCTION confirm_pending_to_sold(UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION confirm_pending_to_sold(UUID, TEXT, TEXT, TEXT) TO service_role;

-- Log migration success
DO $$
BEGIN
  RAISE NOTICE '==============================================';
  RAISE NOTICE 'Fix confirm_pending_to_sold wallet lookup';
  RAISE NOTICE '==============================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Problem: For Base auth users, user_id in pending_tickets';
  RAISE NOTICE '         contains wallet address (0x...), not Privy DID.';
  RAISE NOTICE '         The old code only looked up by privy_user_id column.';
  RAISE NOTICE '';
  RAISE NOTICE 'Solution: Check if user_id is a wallet address.';
  RAISE NOTICE '          If yes, use it directly as the wallet.';
  RAISE NOTICE '          If no (Privy DID), look up wallet from DB.';
  RAISE NOTICE '==============================================';
END $$;
