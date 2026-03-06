-- ============================================================================
-- NUCLEAR OPTION: Bypass the slow trigger entirely for balance payments
-- ============================================================================
-- Problem: Even with optimizations, the trigger chain is too slow for 999 tickets
-- Solution: Create a dedicated RPC that does ONLY what's needed, no triggers
-- ============================================================================

-- Create a fast confirmation function that bypasses triggers
CREATE OR REPLACE FUNCTION confirm_pending_fast(
  p_pending_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_pending RECORD;
  v_wallet TEXT;
  v_inserted INT;
BEGIN
  -- Get the pending ticket (no lock needed, we're just reading)
  SELECT * INTO v_pending
  FROM pending_tickets
  WHERE id = p_pending_id
    AND status = 'pending';
    
  IF v_pending IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Reservation not found or already confirmed');
  END IF;

  -- Get wallet
  v_wallet := COALESCE(
    v_pending.wallet_address,
    (SELECT wallet_address FROM canonical_users WHERE canonical_user_id = v_pending.canonical_user_id LIMIT 1)
  );

  -- Insert tickets in ONE batch (no trigger overhead)
  WITH inserted AS (
    INSERT INTO tickets (
      competition_id,
      ticket_number,
      status,
      purchased_at,
      canonical_user_id,
      wallet_address
    )
    SELECT
      v_pending.competition_id,
      ticket_num,
      'sold',
      NOW(),
      v_pending.canonical_user_id,
      v_wallet
    FROM unnest(v_pending.ticket_numbers) AS ticket_num
    ON CONFLICT (competition_id, ticket_number) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted FROM inserted;

  -- Update joincompetition (simple append, no parsing)
  INSERT INTO joincompetition (
    uid,
    canonical_user_id,
    competition_id,
    ticket_numbers,
    ticket_count,
    amount_spent,
    transactionhash,
    purchase_date,
    updated_at
  )
  VALUES (
    gen_random_uuid(),
    v_pending.canonical_user_id,
    v_pending.competition_id,
    array_to_string(v_pending.ticket_numbers, ','),
    array_length(v_pending.ticket_numbers, 1),
    v_pending.total_amount,
    COALESCE(v_pending.transaction_hash, v_pending.id::TEXT),
    NOW(),
    NOW()
  )
  ON CONFLICT (canonical_user_id, competition_id) DO UPDATE
  SET 
    ticket_numbers = joincompetition.ticket_numbers || ',' || EXCLUDED.ticket_numbers,
    ticket_count = joincompetition.ticket_count + EXCLUDED.ticket_count,
    amount_spent = joincompetition.amount_spent + EXCLUDED.amount_spent;

  -- Deduct balance
  UPDATE sub_account_balances
  SET 
    available_balance = available_balance - v_pending.total_amount,
    last_updated = NOW()
  WHERE canonical_user_id = v_pending.canonical_user_id
    AND currency = 'USD';

  -- Mark as confirmed (this will still fire triggers but we already did the work)
  UPDATE pending_tickets
  SET 
    status = 'confirmed',
    confirmed_at = NOW(),
    updated_at = NOW()
  WHERE id = p_pending_id;

  RETURN jsonb_build_object(
    'success', true,
    'tickets_created', v_inserted,
    'reservation_id', p_pending_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION confirm_pending_fast(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION confirm_pending_fast(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION confirm_pending_fast(UUID) TO anon;

SELECT 'SUCCESS: Fast confirmation function created - use this instead of UPDATE!' AS status;
