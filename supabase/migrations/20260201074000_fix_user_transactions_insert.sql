-- CRITICAL FIX: Add user_transactions insert to confirm_ticket_purchase
-- The confirm_ticket_purchase function was not creating user_transactions entries
-- This caused the orders tab to be empty even though purchases were successful

BEGIN;

-- Drop existing function first to avoid return type conflicts
DROP FUNCTION IF EXISTS public.confirm_ticket_purchase(UUID, TEXT) CASCADE;

-- Update confirm_ticket_purchase to also insert into user_transactions
CREATE OR REPLACE FUNCTION public.confirm_ticket_purchase(
  p_pending_ticket_id UUID, 
  p_payment_provider TEXT DEFAULT 'balance'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_pending RECORD;
  v_pending_status TEXT;
  v_user_balance RECORD;
  v_new_balance NUMERIC;
  v_canonical_user_id TEXT;
  v_user_uuid UUID;
  v_transaction_hash TEXT;
  v_price_per_ticket NUMERIC;
  v_entry_uid UUID;
  v_transaction_id TEXT;
BEGIN
  -- Get pending ticket with lock
  SELECT * INTO v_pending 
  FROM pending_tickets 
  WHERE id = p_pending_ticket_id 
  FOR UPDATE SKIP LOCKED;

  IF v_pending IS NULL THEN
    -- Check if already confirmed
    SELECT status INTO v_pending_status 
    FROM pending_tickets 
    WHERE id = p_pending_ticket_id;
    
    IF v_pending_status = 'confirmed' THEN
      RETURN jsonb_build_object(
        'success', true, 
        'message', 'Already confirmed', 
        'already_confirmed', true
      );
    END IF;
    
    RETURN jsonb_build_object(
      'success', false, 
      'error', 'Pending ticket not found or locked'
    );
  END IF;

  -- Already confirmed check
  IF v_pending.status = 'confirmed' THEN
    RETURN jsonb_build_object(
      'success', true, 
      'message', 'Already confirmed', 
      'already_confirmed', true
    );
  END IF;

  -- Must be pending status
  IF v_pending.status != 'pending' THEN
    RETURN jsonb_build_object(
      'success', false, 
      'error', 'Status is ' || v_pending.status
    );
  END IF;

  -- Check expiration
  IF v_pending.expires_at < NOW() THEN
    UPDATE pending_tickets 
    SET status = 'expired', updated_at = NOW() 
    WHERE id = p_pending_ticket_id;
    
    RETURN jsonb_build_object(
      'success', false, 
      'error', 'Reservation expired'
    );
  END IF;

  v_canonical_user_id := v_pending.user_id;

  -- Get user balance with lock
  SELECT * INTO v_user_balance
  FROM sub_account_balances
  WHERE (
    canonical_user_id = v_canonical_user_id 
    OR user_id = v_canonical_user_id 
    OR privy_user_id = v_canonical_user_id
  )
  AND currency = 'USD'
  FOR UPDATE;

  IF v_user_balance IS NULL THEN
    RETURN jsonb_build_object(
      'success', false, 
      'error', 'User balance not found'
    );
  END IF;

  -- Check sufficient balance
  IF v_user_balance.available_balance < v_pending.total_amount THEN
    RETURN jsonb_build_object(
      'success', false, 
      'error', 'Insufficient balance'
    );
  END IF;

  -- Calculate new balance
  v_new_balance := v_user_balance.available_balance - v_pending.total_amount;
  v_transaction_hash := 'BAL_' || p_pending_ticket_id::TEXT || '_' || EXTRACT(EPOCH FROM NOW())::TEXT;
  v_price_per_ticket := v_pending.total_amount / GREATEST(v_pending.ticket_count, 1);
  v_entry_uid := gen_random_uuid();
  v_transaction_id := gen_random_uuid()::TEXT;

  -- Update balance
  UPDATE sub_account_balances 
  SET available_balance = v_new_balance, last_updated = NOW() 
  WHERE id = v_user_balance.id;

  -- Mark pending ticket as confirmed
  UPDATE pending_tickets
  SET 
    status = 'confirmed', 
    payment_provider = p_payment_provider, 
    transaction_hash = v_transaction_hash, 
    confirmed_at = NOW(), 
    updated_at = NOW()
  WHERE id = p_pending_ticket_id;

  -- Create tickets
  INSERT INTO tickets (
    id, 
    competition_id, 
    ticket_number, 
    status, 
    purchased_at, 
    pending_ticket_id, 
    purchase_price, 
    is_active, 
    payment_tx_hash, 
    canonical_user_id, 
    created_at
  )
  SELECT 
    gen_random_uuid(), 
    v_pending.competition_id, 
    unnest(v_pending.ticket_numbers), 
    'sold', 
    NOW(), 
    p_pending_ticket_id, 
    v_price_per_ticket, 
    true, 
    v_transaction_hash, 
    v_canonical_user_id, 
    NOW();

  -- Create joincompetition entry
  INSERT INTO joincompetition (
    uid, 
    competitionid, 
    userid, 
    numberoftickets, 
    ticketnumbers, 
    amountspent, 
    chain, 
    transactionhash, 
    purchasedate, 
    canonical_user_id
  )
  VALUES (
    v_entry_uid::TEXT, 
    v_pending.competition_id, 
    v_canonical_user_id, 
    v_pending.ticket_count, 
    array_to_string(v_pending.ticket_numbers, ','), 
    v_pending.total_amount, 
    p_payment_provider, 
    v_transaction_hash, 
    NOW(), 
    v_canonical_user_id
  );

  -- CRITICAL: Create user_transactions entry (needed for orders tab)
  INSERT INTO user_transactions (
    id,
    user_id,
    canonical_user_id,
    type,
    amount,
    currency,
    status,
    competition_id,
    ticket_count,
    ticket_numbers,
    transaction_hash,
    payment_method,
    payment_provider,
    payment_status,
    created_at,
    updated_at
  )
  VALUES (
    v_transaction_id,
    v_canonical_user_id,
    v_canonical_user_id,
    'purchase',
    v_pending.total_amount,
    'USD',
    'completed',
    v_pending.competition_id,
    v_pending.ticket_count,
    array_to_string(v_pending.ticket_numbers, ','),
    v_transaction_hash,
    p_payment_provider,
    p_payment_provider,
    'completed',
    NOW(),
    NOW()
  );

  -- Update canonical_users balance and create ledger entry
  SELECT id INTO v_user_uuid 
  FROM canonical_users 
  WHERE canonical_user_id = v_canonical_user_id 
  LIMIT 1;
  
  IF v_user_uuid IS NOT NULL THEN
    UPDATE canonical_users 
    SET usdc_balance = v_new_balance 
    WHERE id = v_user_uuid;
    
    INSERT INTO balance_ledger (
      user_id, 
      balance_type, 
      source, 
      amount, 
      metadata, 
      created_at
    )
    VALUES (
      v_user_uuid, 
      'real', 
      'ticket_purchase', 
      -v_pending.total_amount,
      jsonb_build_object(
        'pending_ticket_id', p_pending_ticket_id, 
        'competition_id', v_pending.competition_id, 
        'ticket_count', v_pending.ticket_count, 
        'ticket_numbers', v_pending.ticket_numbers,
        'transaction_id', v_transaction_id
      ), 
      NOW()
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true, 
    'pending_ticket_id', p_pending_ticket_id, 
    'transaction_id', v_transaction_id,
    'amount_debited', v_pending.total_amount, 
    'new_balance', v_new_balance, 
    'ticket_count', v_pending.ticket_count, 
    'tickets_created', array_length(v_pending.ticket_numbers, 1), 
    'joincompetition_uid', v_entry_uid
  );
END;
$$;

COMMIT;
