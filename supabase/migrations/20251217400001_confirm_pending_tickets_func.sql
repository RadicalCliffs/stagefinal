-- PART 5: ATOMIC CONFIRM PENDING TICKETS FUNCTION

CREATE OR REPLACE FUNCTION confirm_pending_tickets_atomic(
  p_reservation_id UUID,
  p_transaction_hash TEXT DEFAULT NULL,
  p_payment_provider TEXT DEFAULT NULL
)
RETURNS JSONB AS $func$
DECLARE
  v_reservation RECORD;
  v_competition RECORD;
  v_ticket_num INTEGER;
  v_tickets_created INTEGER := 0;
  v_instant_wins JSONB := '[]'::JSONB;
  v_prize RECORD;
  v_user_wallet TEXT;
  v_result JSONB;
BEGIN
  -- STEP 1: Lock and fetch reservation atomically
  SELECT * INTO v_reservation
  FROM pending_tickets
  WHERE id = p_reservation_id
  FOR UPDATE NOWAIT;

  IF v_reservation IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Reservation not found',
      'code', 'NOT_FOUND'
    );
  END IF;

  -- STEP 2: Check if already confirmed (idempotency)
  IF v_reservation.status = 'confirmed' THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_confirmed', true,
      'reservation_id', p_reservation_id,
      'ticket_numbers', v_reservation.ticket_numbers,
      'message', 'Already confirmed'
    );
  END IF;

  -- STEP 3: Validate status is pending or confirming
  IF v_reservation.status NOT IN ('pending', 'confirming') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Reservation is ' || v_reservation.status,
      'code', 'INVALID_STATUS'
    );
  END IF;

  -- STEP 4: Check expiry
  IF v_reservation.expires_at < NOW() THEN
    UPDATE pending_tickets SET status = 'expired', updated_at = NOW()
    WHERE id = p_reservation_id;

    RETURN jsonb_build_object(
      'success', false,
      'error', 'Reservation has expired',
      'code', 'EXPIRED'
    );
  END IF;

  -- STEP 5: Mark as confirming (atomic lock)
  UPDATE pending_tickets
  SET status = 'confirming',
      allocation_attempts = COALESCE(allocation_attempts, 0) + 1,
      last_allocation_attempt = NOW(),
      updated_at = NOW()
  WHERE id = p_reservation_id AND status IN ('pending', 'confirming');

  -- STEP 6: Get competition details
  SELECT * INTO v_competition
  FROM competitions
  WHERE id = v_reservation.competition_id;

  IF v_competition IS NULL THEN
    UPDATE pending_tickets SET status = 'cancelled', updated_at = NOW()
    WHERE id = p_reservation_id;

    RETURN jsonb_build_object(
      'success', false,
      'error', 'Competition not found',
      'code', 'COMPETITION_NOT_FOUND'
    );
  END IF;

  -- STEP 7: Get user wallet
  SELECT wallet_address INTO v_user_wallet
  FROM privy_user_connections
  WHERE privy_user_id = v_reservation.user_id
  LIMIT 1;

  -- STEP 8: Insert tickets (skip duplicates)
  FOREACH v_ticket_num IN ARRAY v_reservation.ticket_numbers
  LOOP
    BEGIN
      INSERT INTO tickets (
        competition_id,
        ticket_number,
        privy_user_id,
        order_id,
        pending_ticket_id,
        purchase_price,
        created_at
      ) VALUES (
        v_reservation.competition_id,
        v_ticket_num,
        v_reservation.user_id,
        p_transaction_hash,
        p_reservation_id,
        v_reservation.ticket_price,
        NOW()
      );
      v_tickets_created := v_tickets_created + 1;
    EXCEPTION WHEN unique_violation THEN
      -- Ticket already exists, skip (idempotency)
      NULL;
    END;
  END LOOP;

  -- STEP 9: Check for instant wins if applicable
  IF v_competition.is_instant_win THEN
    FOREACH v_ticket_num IN ARRAY v_reservation.ticket_numbers
    LOOP
      SELECT * INTO v_prize
      FROM "Prize_Instantprizes"
      WHERE "competitionId" = v_reservation.competition_id
        AND "winningTicket" = v_ticket_num
        AND "winningWalletAddress" IS NULL;

      IF v_prize IS NOT NULL THEN
        -- Claim the prize
        UPDATE "Prize_Instantprizes"
        SET "winningWalletAddress" = v_user_wallet,
            "winningUserId" = v_reservation.user_id,
            privy_user_id = v_reservation.user_id,
            "wonAt" = NOW(),
            claimed_at = NOW()
        WHERE "UID" = v_prize."UID"
          AND "winningWalletAddress" IS NULL;

        IF FOUND THEN
          v_instant_wins := v_instant_wins || jsonb_build_object(
            'ticket_number', v_ticket_num,
            'prize', v_prize.prize,
            'prize_id', v_prize."UID"
          );

          -- Mark ticket as winner
          UPDATE tickets
          SET is_winner = true, prize_tier = v_prize.prize
          WHERE competition_id = v_reservation.competition_id
            AND ticket_number = v_ticket_num;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- STEP 10: Update tickets_sold counter
  UPDATE competitions
  SET tickets_sold = COALESCE(tickets_sold, 0) + array_length(v_reservation.ticket_numbers, 1),
      updated_at = NOW()
  WHERE id = v_reservation.competition_id;

  -- STEP 11: Mark reservation as confirmed
  UPDATE pending_tickets
  SET status = 'confirmed',
      transaction_hash = COALESCE(p_transaction_hash, transaction_hash),
      payment_provider = COALESCE(p_payment_provider, payment_provider),
      confirmed_at = NOW(),
      updated_at = NOW()
  WHERE id = p_reservation_id;

  -- Build result
  v_result := jsonb_build_object(
    'success', true,
    'reservation_id', p_reservation_id,
    'competition_id', v_reservation.competition_id,
    'ticket_numbers', v_reservation.ticket_numbers,
    'tickets_created', v_tickets_created,
    'total_amount', v_reservation.total_amount
  );

  IF jsonb_array_length(v_instant_wins) > 0 THEN
    v_result := v_result || jsonb_build_object('instant_wins', v_instant_wins);
  END IF;

  RETURN v_result;

EXCEPTION WHEN lock_not_available THEN
  -- Another process is confirming this reservation
  RETURN jsonb_build_object(
    'success', false,
    'error', 'Reservation is being processed by another request',
    'code', 'LOCK_CONFLICT'
  );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;
