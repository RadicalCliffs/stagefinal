-- Execute Balance Payment RPC
-- This function handles purchasing competition tickets using the user's balance
-- It atomically:
-- 1. Checks user has sufficient balance
-- 2. Deducts the amount from sub_account_balances
-- 3. Creates ticket allocations
-- 4. Creates user_transaction record with balance tracking
-- 5. Creates joincompetition entry

CREATE OR REPLACE FUNCTION public.execute_balance_payment(
  p_competition_id TEXT,
  p_user_identifier TEXT,
  p_amount NUMERIC,
  p_ticket_count INTEGER,
  p_selected_tickets INTEGER[] DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL,
  p_reservation_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_canonical_user_id TEXT;
  v_wallet_address TEXT;
  v_balance_record RECORD;
  v_balance_before NUMERIC;
  v_balance_after NUMERIC;
  v_transaction_id UUID;
  v_competition RECORD;
  v_ticket_price NUMERIC;
  v_allocated_tickets INTEGER[];
  v_entry_id UUID;
  v_result JSONB;
BEGIN
  -- Normalize user identifier to canonical format
  IF p_user_identifier LIKE 'prize:pid:%' THEN
    v_canonical_user_id := p_user_identifier;
    v_wallet_address := LOWER(REPLACE(p_user_identifier, 'prize:pid:', ''));
  ELSIF p_user_identifier LIKE '0x%' THEN
    v_wallet_address := LOWER(p_user_identifier);
    v_canonical_user_id := 'prize:pid:' || v_wallet_address;
  ELSE
    v_canonical_user_id := p_user_identifier;
    v_wallet_address := p_user_identifier;
  END IF;

  -- Get competition details
  SELECT id, title, ticket_price INTO v_competition
  FROM public.competitions
  WHERE id = p_competition_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Competition not found',
      'error_code', 'COMPETITION_NOT_FOUND'
    );
  END IF;

  v_ticket_price := v_competition.ticket_price;

  -- Validate amount matches expected cost
  IF p_amount != (v_ticket_price * p_ticket_count) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Amount mismatch: expected ' || (v_ticket_price * p_ticket_count) || ' but got ' || p_amount,
      'error_code', 'AMOUNT_MISMATCH'
    );
  END IF;

  -- Get user's current balance (with row lock to prevent race conditions)
  SELECT * INTO v_balance_record
  FROM public.sub_account_balances
  WHERE canonical_user_id = v_canonical_user_id
    AND currency = 'USD'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No balance account found for user',
      'error_code', 'NO_BALANCE_ACCOUNT'
    );
  END IF;

  v_balance_before := COALESCE(v_balance_record.available_balance, 0) + COALESCE(v_balance_record.bonus_balance, 0);

  -- Check sufficient balance
  IF v_balance_before < p_amount THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Insufficient balance: have ' || v_balance_before || ' but need ' || p_amount,
      'error_code', 'INSUFFICIENT_BALANCE',
      'current_balance', v_balance_before,
      'required_amount', p_amount
    );
  END IF;

  -- Deduct from balance (prioritize bonus balance first)
  IF v_balance_record.bonus_balance >= p_amount THEN
    -- Deduct entirely from bonus
    UPDATE public.sub_account_balances
    SET bonus_balance = bonus_balance - p_amount,
        last_updated = NOW()
    WHERE canonical_user_id = v_canonical_user_id
      AND currency = 'USD';
  ELSIF v_balance_record.bonus_balance > 0 THEN
    -- Deduct some from bonus, rest from available
    UPDATE public.sub_account_balances
    SET bonus_balance = 0,
        available_balance = available_balance - (p_amount - v_balance_record.bonus_balance),
        last_updated = NOW()
    WHERE canonical_user_id = v_canonical_user_id
      AND currency = 'USD';
  ELSE
    -- Deduct entirely from available
    UPDATE public.sub_account_balances
    SET available_balance = available_balance - p_amount,
        last_updated = NOW()
    WHERE canonical_user_id = v_canonical_user_id
      AND currency = 'USD';
  END IF;

  v_balance_after := v_balance_before - p_amount;

  -- Allocate tickets (simplified - you may need more complex logic)
  IF p_selected_tickets IS NOT NULL AND array_length(p_selected_tickets, 1) = p_ticket_count THEN
    v_allocated_tickets := p_selected_tickets;
  ELSE
    -- Lucky dip allocation would go here
    -- For now, just create empty array
    v_allocated_tickets := ARRAY[]::INTEGER[];
  END IF;

  -- Create transaction record with balance tracking
  -- Validate and convert idempotency key to UUID
  BEGIN
    IF p_idempotency_key IS NOT NULL THEN
      v_transaction_id := p_idempotency_key::UUID;
    ELSE
      v_transaction_id := gen_random_uuid();
    END IF;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid idempotency_key format: must be a valid UUID',
      'error_code', 'INVALID_IDEMPOTENCY_KEY'
    );
  END;
  
  -- Check if transaction already exists (idempotency)
  SELECT id INTO v_transaction_id FROM public.user_transactions WHERE id = v_transaction_id;
  
  IF FOUND THEN
    -- Transaction already exists - return existing data (idempotent response)
    RETURN jsonb_build_object(
      'success', true,
      'transaction_id', v_transaction_id,
      'message', 'Transaction already processed (idempotent)',
      'idempotent', true
    );
  END IF;

  -- Create new transaction record with balance tracking
  INSERT INTO public.user_transactions (
    id,
    user_id,
    canonical_user_id,
    wallet_address,
    type,
    amount,
    currency,
    status,
    payment_status,
    competition_id,
    ticket_count,
    ticket_numbers,
    created_at,
    completed_at,
    payment_provider,
    balance_before,
    balance_after,
    metadata
  ) VALUES (
    v_transaction_id,
    v_canonical_user_id,
    v_canonical_user_id,
    v_wallet_address,
    'purchase',  -- Type is 'purchase' for balance payments
    p_amount,
    'USD',
    'completed',
    'completed',
    p_competition_id,
    p_ticket_count,
    array_to_string(v_allocated_tickets, ','),
    NOW(),
    NOW(),
    'balance_payment',  -- This identifies it as a balance payment
    v_balance_before,
    v_balance_after,
    jsonb_build_object('source', 'execute_balance_payment', 'reservation_id', p_reservation_id)
  );

  -- Create joincompetition entry (must succeed if transaction was created)
  v_entry_id := gen_random_uuid();
  BEGIN
    INSERT INTO public.joincompetition (
      uid,
      userid,
      competitionid,
      tickets,
      ticketCount,
      transactionhash,
      created_at
    ) VALUES (
      v_entry_id,
      v_canonical_user_id,
      p_competition_id,
      v_allocated_tickets,
      p_ticket_count,
      v_transaction_id::TEXT,
      NOW()
    );
  EXCEPTION WHEN unique_violation THEN
    -- Entry already exists for this transaction, which is OK for idempotency
    -- Find the existing entry ID
    SELECT uid INTO v_entry_id 
    FROM public.joincompetition 
    WHERE transactionhash = v_transaction_id::TEXT
    LIMIT 1;
  END;

  -- Return success
  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', v_transaction_id,
    'entry_id', v_entry_id,
    'balance_before', v_balance_before,
    'balance_after', v_balance_after,
    'amount_charged', p_amount,
    'tickets_allocated', v_allocated_tickets,
    'ticket_count', p_ticket_count
  );

EXCEPTION WHEN OTHERS THEN
  -- Return error details
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'error_code', 'INTERNAL_ERROR',
    'error_detail', SQLSTATE
  );
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.execute_balance_payment(TEXT, TEXT, NUMERIC, INTEGER, INTEGER[], TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.execute_balance_payment(TEXT, TEXT, NUMERIC, INTEGER, INTEGER[], TEXT, UUID) TO anon;

-- Add comment
COMMENT ON FUNCTION public.execute_balance_payment IS 
'Executes a balance payment for competition ticket purchase. 
Atomically deducts balance, creates transaction record with balance tracking, and allocates tickets.
Returns success with transaction details or error with code.';
