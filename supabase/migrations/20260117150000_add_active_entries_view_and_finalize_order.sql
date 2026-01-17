-- =====================================================
-- CREATE v_joincompetition_active VIEW AND finalize_order RPC
-- =====================================================
-- This migration creates:
-- 1. v_joincompetition_active view - Stable read interface for active competition entries
--    that removes privy_user_id dependency and provides consistent access
-- 2. finalize_order() RPC - Atomic checkout function that deducts wallet balance
--    and finalizes ticket purchases in a single transaction
-- =====================================================

-- ============================================================================
-- Part 1: Create v_joincompetition_active View
-- ============================================================================
-- This view provides a stable interface to read active competition entries
-- without depending on the brittle privy_user_id column.
-- It uses canonical identifiers (canonical_user_id, uid, walletaddress) instead.

CREATE OR REPLACE VIEW public.v_joincompetition_active AS
SELECT
  jc.id,
  jc.uid,
  jc.userid,
  jc.walletaddress,
  jc.competitionid,
  jc.numberoftickets,
  jc.ticketnumbers,
  jc.amountspent,
  jc.purchasedate,
  jc.buytime,
  jc.transactionhash,
  jc.chain,
  jc.created_at,
  -- Include competition details for convenience
  c.title as competition_title,
  c.status as competition_status,
  c.draw_date as competition_draw_date
FROM joincompetition jc
LEFT JOIN competitions c ON c.uid = jc.competitionid
WHERE
  -- Only include entries for active or completed competitions
  c.status IN ('active', 'completed', 'drawing', 'drawn')
  -- Exclude test/invalid entries
  AND jc.numberoftickets > 0
  AND jc.ticketnumbers IS NOT NULL;

-- Add comment for documentation
COMMENT ON VIEW public.v_joincompetition_active IS 'Stable view for active competition entries. Use this instead of direct joincompetition queries.';

-- Grant permissions on the view
GRANT SELECT ON public.v_joincompetition_active TO authenticated;
GRANT SELECT ON public.v_joincompetition_active TO anon;
GRANT SELECT ON public.v_joincompetition_active TO service_role;

-- ============================================================================
-- Part 2: Create finalize_order() RPC Function
-- ============================================================================
-- This function provides atomic checkout that:
-- 1. Verifies the reservation exists and hasn't expired
-- 2. Computes total = unit_price * ticket_count
-- 3. Deducts user wallet balance from canonical_users
-- 4. Inserts order with non-null amount
-- 5. Inserts order_tickets for each ticket number
-- 6. Inserts tickets table entries
-- 7. Inserts user_transaction with non-null amount
-- 8. Marks pending_tickets as confirmed/consumed
-- All in a single atomic transaction.

CREATE OR REPLACE FUNCTION public.finalize_order(
  p_reservation_id UUID,
  p_user_id TEXT,
  p_competition_id UUID,
  p_unit_price NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reservation RECORD;
  v_total_amount NUMERIC;
  v_user_balance NUMERIC;
  v_order_id UUID;
  v_transaction_id UUID;
  v_ticket_num INTEGER;
  v_competition_uid TEXT;
  v_canonical_user_id TEXT;
  v_wallet_address TEXT;
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
        'message', 'Order already finalized',
        'already_confirmed', true,
        'reservation_id', p_reservation_id
      );
    END IF;

    RETURN jsonb_build_object(
      'success', false,
      'error', 'Reservation not found or locked by another process'
    );
  END IF;

  -- Check if already confirmed
  IF v_reservation.status = 'confirmed' THEN
    RETURN jsonb_build_object(
      'success', true,
      'message', 'Order already finalized',
      'already_confirmed', true,
      'reservation_id', p_reservation_id
    );
  END IF;

  -- Check if reservation is pending
  IF v_reservation.status != 'pending' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Reservation status is ' || v_reservation.status || ', cannot finalize'
    );
  END IF;

  -- Check if reservation has expired
  IF v_reservation.expires_at < NOW() THEN
    UPDATE pending_tickets
    SET status = 'expired', updated_at = NOW()
    WHERE id = p_reservation_id;

    RETURN jsonb_build_object(
      'success', false,
      'error', 'Reservation has expired'
    );
  END IF;

  -- Step 2: Compute total amount
  v_total_amount := p_unit_price * array_length(v_reservation.ticket_numbers, 1);

  -- Ensure total amount is non-null and positive
  IF v_total_amount IS NULL OR v_total_amount <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid total amount calculated'
    );
  END IF;

  -- Step 3: Resolve user identity and get wallet address
  -- Handle different user ID formats
  IF p_user_id LIKE 'prize:pid:0x%' THEN
    v_canonical_user_id := p_user_id;
    v_wallet_address := LOWER(SUBSTRING(p_user_id FROM 11));
  ELSIF p_user_id LIKE '0x%' AND LENGTH(p_user_id) = 42 THEN
    v_wallet_address := LOWER(p_user_id);
    v_canonical_user_id := 'prize:pid:' || v_wallet_address;
  ELSE
    v_canonical_user_id := p_user_id;
    v_wallet_address := p_user_id;
  END IF;

  -- Step 4: Get user balance and verify sufficient funds
  SELECT usdc_balance INTO v_user_balance
  FROM canonical_users
  WHERE id = v_canonical_user_id
     OR LOWER(wallet_address) = v_wallet_address
     OR LOWER(base_wallet_address) = v_wallet_address
     OR LOWER(eth_wallet_address) = v_wallet_address
  LIMIT 1;

  IF v_user_balance IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'User not found'
    );
  END IF;

  IF v_user_balance < v_total_amount THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Insufficient balance',
      'balance', v_user_balance,
      'required', v_total_amount
    );
  END IF;

  -- Step 5: Deduct balance from user
  UPDATE canonical_users
  SET usdc_balance = usdc_balance - v_total_amount,
      updated_at = NOW()
  WHERE id = v_canonical_user_id
     OR LOWER(wallet_address) = v_wallet_address
     OR LOWER(base_wallet_address) = v_wallet_address
     OR LOWER(eth_wallet_address) = v_wallet_address;

  -- Step 6: Get competition UID for foreign key
  SELECT uid INTO v_competition_uid
  FROM competitions
  WHERE id = p_competition_id;

  IF v_competition_uid IS NULL THEN
    RAISE EXCEPTION 'Competition not found';
  END IF;

  -- Step 7: Create order record with non-null amount
  v_order_id := gen_random_uuid();
  INSERT INTO orders (
    id,
    user_id,
    competition_id,
    ticket_count,
    amount_usd,
    payment_status,
    payment_method,
    order_type,
    created_at,
    updated_at
  ) VALUES (
    v_order_id,
    v_canonical_user_id,
    v_competition_uid,
    array_length(v_reservation.ticket_numbers, 1),
    v_total_amount,
    'completed',
    'balance',
    'competition_purchase',
    NOW(),
    NOW()
  );

  -- Step 8: Insert order_tickets for each ticket number
  FOREACH v_ticket_num IN ARRAY v_reservation.ticket_numbers
  LOOP
    INSERT INTO order_tickets (
      order_id,
      ticket_number,
      created_at
    ) VALUES (
      v_order_id,
      v_ticket_num,
      NOW()
    );
  END LOOP;

  -- Step 9: Insert tickets (confirmed tickets) with conflict handling
  FOREACH v_ticket_num IN ARRAY v_reservation.ticket_numbers
  LOOP
    INSERT INTO tickets (
      uid,
      userid,
      competitionid,
      ticketnumber,
      purchasedate,
      transactionhash,
      walletaddress,
      created_at
    ) VALUES (
      gen_random_uuid(),
      v_canonical_user_id,
      v_competition_uid,
      v_ticket_num,
      NOW(),
      'balance_payment_' || v_order_id::text,
      v_wallet_address,
      NOW()
    )
    ON CONFLICT DO NOTHING;  -- Handle duplicate ticket numbers gracefully
  END LOOP;

  -- Step 10: Create user_transaction record with non-null amount
  v_transaction_id := gen_random_uuid();
  INSERT INTO user_transactions (
    id,
    user_id,
    order_id,
    competition_id,
    amount,
    ticket_count,
    status,
    payment_status,
    currency,
    network,
    created_at,
    updated_at,
    completed_at
  ) VALUES (
    v_transaction_id,
    v_canonical_user_id,
    v_order_id::text,
    v_competition_uid,
    v_total_amount,
    array_length(v_reservation.ticket_numbers, 1),
    'completed',
    'completed',
    'USD',
    'balance',
    NOW(),
    NOW(),
    NOW()
  );

  -- Step 11: Mark pending_tickets as confirmed/consumed
  UPDATE pending_tickets
  SET
    status = 'confirmed',
    confirmed_at = NOW(),
    updated_at = NOW(),
    transaction_hash = 'balance_payment_' || v_order_id::text
  WHERE id = p_reservation_id;

  -- Step 12: Return success with order details
  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order_id,
    'transaction_id', v_transaction_id,
    'amount_charged', v_total_amount,
    'ticket_count', array_length(v_reservation.ticket_numbers, 1),
    'remaining_balance', v_user_balance - v_total_amount
  );

EXCEPTION
  WHEN OTHERS THEN
    -- Roll back will happen automatically
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Transaction failed: ' || SQLERRM
    );
END;
$$;

-- Add comment for documentation
COMMENT ON FUNCTION public.finalize_order IS 'Atomic checkout function that deducts wallet balance and finalizes ticket purchase. Use after reserve_tickets.';

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.finalize_order(UUID, TEXT, UUID, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_order(UUID, TEXT, UUID, NUMERIC) TO service_role;

-- ============================================================================
-- Part 3: Create helper function to release/cancel reservations (optional)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.release_reservation(
  p_reservation_id UUID,
  p_user_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reservation RECORD;
BEGIN
  -- Lock and fetch the reservation
  SELECT * INTO v_reservation
  FROM pending_tickets
  WHERE id = p_reservation_id
    AND user_id = p_user_id
  FOR UPDATE SKIP LOCKED;

  -- Check if reservation exists
  IF v_reservation IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Reservation not found or already locked'
    );
  END IF;

  -- Only cancel if it's still pending
  IF v_reservation.status != 'pending' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Reservation is already ' || v_reservation.status
    );
  END IF;

  -- Mark as cancelled
  UPDATE pending_tickets
  SET
    status = 'cancelled',
    updated_at = NOW()
  WHERE id = p_reservation_id;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Reservation cancelled successfully'
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Failed to cancel reservation: ' || SQLERRM
    );
END;
$$;

-- Add comment
COMMENT ON FUNCTION public.release_reservation IS 'Cancels a pending ticket reservation, making tickets available again.';

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.release_reservation(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_reservation(UUID, TEXT) TO service_role;
