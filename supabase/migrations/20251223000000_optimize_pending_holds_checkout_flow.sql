/*
  # Optimized Pending Holds on Checkout

  This migration implements the complete pending holds system for checkout:

  1. **Pending Creation**: When user starts checkout, a pending_tickets record is created
     with chosen numbers and an expires_at (default 15 minutes). The availability view
     already excludes these tickets.

  2. **Atomic Conversion RPC**: On payment success, a single RPC call converts pending
     to sold by moving numbers to tickets table and marking pending row as confirmed.

  3. **Availability Reinsert**: On cancel/timeout, setting status to 'cancelled' or
     letting expires_at pass automatically makes tickets available again (the view
     v_competition_available_now already handles this dynamically).

  ## Key Components:
  - `confirm_pending_to_sold()` - Single RPC for atomic conversion
  - `cancel_pending_reservation()` - RPC to explicitly cancel a reservation
  - `cleanup_expired_pending_tickets()` - Enhanced cleanup function
  - Trigger to automatically handle status transitions
*/

-- ============================================================================
-- Part 1: Atomic Conversion RPC - Convert Pending to Sold in Single Transaction
-- ============================================================================

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

  -- Get user's wallet address if not provided
  IF p_wallet_address IS NULL THEN
    SELECT wallet_address INTO v_user_privy_wallet
    FROM privy_user_connections
    WHERE privy_user_id = v_reservation.user_id
    LIMIT 1;
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
    walletaddress,
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
Returns detailed result including ticket numbers and amounts.';

GRANT EXECUTE ON FUNCTION confirm_pending_to_sold(UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION confirm_pending_to_sold(UUID, TEXT, TEXT, TEXT) TO service_role;


-- ============================================================================
-- Part 2: Cancel Pending Reservation RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION cancel_pending_reservation(
  p_reservation_id UUID,
  p_user_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_reservation RECORD;
BEGIN
  -- Fetch the reservation
  SELECT * INTO v_reservation
  FROM pending_tickets
  WHERE id = p_reservation_id;

  IF v_reservation IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Reservation not found'
    );
  END IF;

  -- Verify user ownership if user_id provided
  IF p_user_id IS NOT NULL AND v_reservation.user_id != p_user_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Unauthorized: reservation belongs to another user'
    );
  END IF;

  -- Check if already cancelled or confirmed
  IF v_reservation.status = 'cancelled' THEN
    RETURN jsonb_build_object(
      'success', true,
      'message', 'Reservation was already cancelled',
      'already_cancelled', true
    );
  END IF;

  IF v_reservation.status = 'confirmed' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Cannot cancel a confirmed reservation'
    );
  END IF;

  -- Cancel the reservation
  UPDATE pending_tickets
  SET
    status = 'cancelled',
    updated_at = NOW()
  WHERE id = p_reservation_id;

  -- Tickets automatically become available again via v_competition_available_now view

  RETURN jsonb_build_object(
    'success', true,
    'reservation_id', p_reservation_id,
    'ticket_numbers', v_reservation.ticket_numbers,
    'ticket_count', array_length(v_reservation.ticket_numbers, 1),
    'message', 'Reservation cancelled. Tickets are now available again.'
  );
END;
$$;

COMMENT ON FUNCTION cancel_pending_reservation IS
'Cancels a pending ticket reservation, making the tickets available for others.
Optionally verifies user ownership if user_id is provided.';

GRANT EXECUTE ON FUNCTION cancel_pending_reservation(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION cancel_pending_reservation(UUID, TEXT) TO service_role;


-- ============================================================================
-- Part 3: Enhanced Expired Tickets Cleanup Function
-- ============================================================================

-- Drop existing function to allow return type change
DROP FUNCTION IF EXISTS cleanup_expired_pending_tickets();

CREATE OR REPLACE FUNCTION cleanup_expired_pending_tickets()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_expired_count INTEGER;
  v_total_tickets_released INTEGER := 0;
  v_rec RECORD;
BEGIN
  -- Mark expired pending tickets as 'expired'
  WITH expired_reservations AS (
    UPDATE pending_tickets
    SET status = 'expired', updated_at = NOW()
    WHERE status = 'pending'
      AND expires_at < NOW()
    RETURNING id, ticket_numbers
  )
  SELECT
    COUNT(*) as count,
    COALESCE(SUM(array_length(ticket_numbers, 1)), 0) as total_tickets
  INTO v_expired_count, v_total_tickets_released
  FROM expired_reservations;

  RETURN jsonb_build_object(
    'success', true,
    'expired_reservations', v_expired_count,
    'tickets_released', v_total_tickets_released,
    'cleanup_time', NOW()
  );
END;
$$;

COMMENT ON FUNCTION cleanup_expired_pending_tickets IS
'Marks all expired pending reservations as expired.
Tickets automatically become available via the availability view.
Can be called by a cron job or edge function.';

GRANT EXECUTE ON FUNCTION cleanup_expired_pending_tickets() TO service_role;


-- ============================================================================
-- Part 4: Get User's Active Pending Reservation
-- ============================================================================

CREATE OR REPLACE FUNCTION get_user_pending_reservation(
  p_user_id TEXT,
  p_competition_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_reservation RECORD;
BEGIN
  -- Find active pending reservation for user + competition
  SELECT * INTO v_reservation
  FROM pending_tickets
  WHERE user_id = p_user_id
    AND competition_id = p_competition_id
    AND status = 'pending'
    AND expires_at > NOW()
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_reservation IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'has_reservation', false
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'has_reservation', true,
    'reservation_id', v_reservation.id,
    'ticket_numbers', v_reservation.ticket_numbers,
    'ticket_count', v_reservation.ticket_count,
    'total_amount', v_reservation.total_amount,
    'expires_at', v_reservation.expires_at,
    'seconds_remaining', EXTRACT(EPOCH FROM (v_reservation.expires_at - NOW()))::INTEGER,
    'created_at', v_reservation.created_at
  );
END;
$$;

COMMENT ON FUNCTION get_user_pending_reservation IS
'Returns the active pending reservation for a user on a specific competition.
Includes time remaining until expiration.';

GRANT EXECUTE ON FUNCTION get_user_pending_reservation(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_pending_reservation(TEXT, UUID) TO service_role;


-- ============================================================================
-- Part 5: Trigger for Automatic Pending Ticket Status Updates (Optional)
-- ============================================================================

-- Create a trigger function that can be used to automatically cleanup
-- This is optional since the view handles availability dynamically
CREATE OR REPLACE FUNCTION trigger_pending_tickets_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Log status changes for debugging/auditing
  IF OLD.status != NEW.status THEN
    RAISE NOTICE 'Pending ticket % status changed: % -> %',
      NEW.id, OLD.status, NEW.status;
  END IF;

  -- Auto-set updated_at
  NEW.updated_at := NOW();

  RETURN NEW;
END;
$$;

-- Drop existing trigger if any
DROP TRIGGER IF EXISTS trg_pending_tickets_status_change ON pending_tickets;

-- Create the trigger
CREATE TRIGGER trg_pending_tickets_status_change
  BEFORE UPDATE ON pending_tickets
  FOR EACH ROW
  EXECUTE FUNCTION trigger_pending_tickets_status_change();


-- ============================================================================
-- Part 6: Add Index for Faster Expiration Checks
-- ============================================================================

-- Index for efficient expired ticket lookup
CREATE INDEX IF NOT EXISTS idx_pending_tickets_pending_expires
  ON pending_tickets(expires_at)
  WHERE status = 'pending';

-- Index for user's active reservations lookup
CREATE INDEX IF NOT EXISTS idx_pending_tickets_user_active
  ON pending_tickets(user_id, competition_id, status)
  WHERE status = 'pending';


-- ============================================================================
-- Part 7: Verify Status Constraint Includes All Required Statuses
-- ============================================================================

-- Ensure the status column accepts 'confirming' status
DO $$
BEGIN
  -- Try to drop the existing constraint
  ALTER TABLE pending_tickets DROP CONSTRAINT IF EXISTS valid_status;

  -- Add updated constraint including 'confirming' status
  ALTER TABLE pending_tickets
    ADD CONSTRAINT valid_status
    CHECK (status IN ('pending', 'confirming', 'confirmed', 'expired', 'cancelled'));

  RAISE NOTICE 'Updated pending_tickets status constraint to include confirming';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not update constraint: %. Constraint may already be correct.', SQLERRM;
END $$;


-- ============================================================================
-- Migration Complete Notice
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '============================================================';
  RAISE NOTICE 'Optimized Pending Holds Checkout Flow Migration Complete';
  RAISE NOTICE '============================================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Created/Updated RPCs:';
  RAISE NOTICE '  - confirm_pending_to_sold(reservation_id, tx_hash, provider, wallet)';
  RAISE NOTICE '    Atomic conversion: pending -> tickets + joincompetition + confirmed';
  RAISE NOTICE '';
  RAISE NOTICE '  - cancel_pending_reservation(reservation_id, user_id)';
  RAISE NOTICE '    Explicit cancellation, releases tickets immediately';
  RAISE NOTICE '';
  RAISE NOTICE '  - cleanup_expired_pending_tickets()';
  RAISE NOTICE '    Batch cleanup of expired reservations';
  RAISE NOTICE '';
  RAISE NOTICE '  - get_user_pending_reservation(user_id, competition_id)';
  RAISE NOTICE '    Check if user has active pending reservation';
  RAISE NOTICE '';
  RAISE NOTICE 'Checkout Flow:';
  RAISE NOTICE '  1. User selects tickets -> reserve_tickets_atomically()';
  RAISE NOTICE '  2. Pending record created with expires_at';
  RAISE NOTICE '  3. Availability view excludes pending tickets';
  RAISE NOTICE '  4. On payment success -> confirm_pending_to_sold()';
  RAISE NOTICE '  5. On cancel/timeout -> cancel_pending_reservation() or auto-expire';
  RAISE NOTICE '============================================================';
END $$;
