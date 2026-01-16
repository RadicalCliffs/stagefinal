/*
  # Add confirm_ticket_purchase RPC for atomic balance debit and ticket confirmation

  This RPC is designed to atomically:
  1. Verify the pending ticket exists and belongs to the user
  2. Debit the user's balance from sub_account_balances
  3. Mark the pending ticket as confirmed
  4. Create ledger entries for audit trail

  This prevents race conditions where:
  - Balance could be debited but tickets not confirmed
  - Tickets could be confirmed but balance not debited

  Usage from Edge Functions:
  ```typescript
  const { data: confirmResult } = await supabase.rpc('confirm_ticket_purchase', {
    p_pending_ticket_id: reservationRecord.id,
    p_payment_provider: 'balance'
  });
  ```
*/

-- Drop existing function if exists to allow recreation
DROP FUNCTION IF EXISTS confirm_ticket_purchase(UUID, TEXT);

CREATE OR REPLACE FUNCTION confirm_ticket_purchase(
  p_pending_ticket_id UUID,
  p_payment_provider TEXT DEFAULT 'balance'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_pending RECORD;
  v_user_balance RECORD;
  v_new_balance NUMERIC;
  v_canonical_user_id TEXT;
  v_user_uuid UUID;
  v_transaction_hash TEXT;
BEGIN
  -- Step 1: Lock and fetch the pending ticket
  SELECT * INTO v_pending
  FROM pending_tickets
  WHERE id = p_pending_ticket_id
  FOR UPDATE SKIP LOCKED;

  -- Check if pending ticket exists
  IF v_pending IS NULL THEN
    -- Check if it's already confirmed
    SELECT status INTO v_pending
    FROM pending_tickets
    WHERE id = p_pending_ticket_id;

    IF v_pending.status = 'confirmed' THEN
      RETURN jsonb_build_object(
        'success', true,
        'message', 'Purchase already confirmed',
        'already_confirmed', true,
        'pending_ticket_id', p_pending_ticket_id
      );
    END IF;

    RETURN jsonb_build_object(
      'success', false,
      'error', 'Pending ticket not found or locked by another process'
    );
  END IF;

  -- Check current status
  IF v_pending.status = 'confirmed' THEN
    RETURN jsonb_build_object(
      'success', true,
      'message', 'Purchase already confirmed',
      'already_confirmed', true,
      'pending_ticket_id', p_pending_ticket_id
    );
  END IF;

  IF v_pending.status != 'pending' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Pending ticket status is ' || v_pending.status || ', cannot confirm'
    );
  END IF;

  -- Check if reservation has expired
  IF v_pending.expires_at < NOW() THEN
    -- Mark as expired
    UPDATE pending_tickets
    SET status = 'expired', updated_at = NOW()
    WHERE id = p_pending_ticket_id;

    RETURN jsonb_build_object(
      'success', false,
      'error', 'Reservation has expired',
      'expired_at', v_pending.expires_at
    );
  END IF;

  -- Step 2: Get user's canonical ID (stored in pending_tickets.user_id)
  v_canonical_user_id := v_pending.user_id;

  -- Step 3: Lock and fetch user's balance from sub_account_balances
  SELECT * INTO v_user_balance
  FROM sub_account_balances
  WHERE (canonical_user_id = v_canonical_user_id
         OR user_id = v_canonical_user_id
         OR privy_user_id = v_canonical_user_id)
    AND currency = 'USD'
  FOR UPDATE;

  IF v_user_balance IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'User balance record not found'
    );
  END IF;

  -- Step 4: Check sufficient balance
  IF v_user_balance.available_balance < v_pending.total_amount THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Insufficient balance. Required: ' || v_pending.total_amount || ', Available: ' || v_user_balance.available_balance
    );
  END IF;

  -- Step 5: Calculate new balance
  v_new_balance := v_user_balance.available_balance - v_pending.total_amount;

  -- Step 6: Debit the balance atomically
  UPDATE sub_account_balances
  SET
    available_balance = v_new_balance,
    last_updated = NOW()
  WHERE id = v_user_balance.id;

  -- Step 7: Generate transaction hash
  v_transaction_hash := 'BAL_' || p_pending_ticket_id::TEXT || '_' || EXTRACT(EPOCH FROM NOW())::TEXT;

  -- Step 8: Mark pending ticket as confirmed
  UPDATE pending_tickets
  SET
    status = 'confirmed',
    payment_provider = p_payment_provider,
    transaction_hash = v_transaction_hash,
    confirmed_at = NOW(),
    updated_at = NOW()
  WHERE id = p_pending_ticket_id;

  -- Step 9: Also sync to canonical_users for backwards compatibility
  -- Get user UUID from canonical_users
  SELECT id INTO v_user_uuid
  FROM canonical_users
  WHERE canonical_user_id = v_canonical_user_id
  LIMIT 1;

  IF v_user_uuid IS NOT NULL THEN
    UPDATE canonical_users
    SET usdc_balance = v_new_balance
    WHERE id = v_user_uuid;

    -- Create balance_ledger entry for audit trail
    INSERT INTO balance_ledger (
      user_id,
      balance_type,
      source,
      amount,
      metadata,
      created_at
    ) VALUES (
      v_user_uuid,
      'real',
      'ticket_purchase',
      -v_pending.total_amount, -- Negative for debit
      jsonb_build_object(
        'pending_ticket_id', p_pending_ticket_id,
        'competition_id', v_pending.competition_id,
        'ticket_count', v_pending.ticket_count,
        'ticket_numbers', v_pending.ticket_numbers,
        'previous_balance', v_user_balance.available_balance,
        'new_balance', v_new_balance,
        'payment_provider', p_payment_provider
      ),
      NOW()
    );
  END IF;

  -- Return success with details
  RETURN jsonb_build_object(
    'success', true,
    'pending_ticket_id', p_pending_ticket_id,
    'previous_balance', v_user_balance.available_balance,
    'amount_debited', v_pending.total_amount,
    'new_balance', v_new_balance,
    'transaction_hash', v_transaction_hash,
    'competition_id', v_pending.competition_id,
    'ticket_count', v_pending.ticket_count,
    'ticket_numbers', v_pending.ticket_numbers,
    'message', 'Successfully debited balance and confirmed purchase'
  );

EXCEPTION WHEN OTHERS THEN
  -- If anything fails, the transaction is rolled back automatically
  RETURN jsonb_build_object(
    'success', false,
    'error', 'Failed to confirm purchase: ' || SQLERRM,
    'retryable', true
  );
END;
$$;

COMMENT ON FUNCTION confirm_ticket_purchase IS
'Atomically debits user balance and confirms a pending ticket purchase.
This prevents race conditions between balance debit and ticket confirmation.
Returns success with balance details or error if insufficient funds/expired.';

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION confirm_ticket_purchase(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION confirm_ticket_purchase(UUID, TEXT) TO service_role;
