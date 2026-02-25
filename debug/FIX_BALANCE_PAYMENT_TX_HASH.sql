-- FIX_BALANCE_PAYMENT_TX_HASH.sql
-- Backfills balance_payment tickets with user's most recent REAL topup transaction hash
-- And modifies execute_balance_payment to use real tx_id going forward

-- ============================================================================
-- PART 1: BACKFILL - Update existing balance_payment tickets
-- ============================================================================

-- View current state before fix
SELECT 
  'Before Fix' as status,
  COUNT(*) as total_balance_tickets,
  COUNT(*) FILTER (WHERE transaction_hash ILIKE 'balance_%') as synthetic_hashes,
  COUNT(DISTINCT canonical_user_id) as unique_users
FROM tickets
WHERE transaction_hash ILIKE 'balance_%';

-- Create a temp table of users and their most recent on-chain topup tx_id
-- Priority: 0x hashes (real on-chain) > any other non-null tx_id
WITH user_latest_topup AS (
  SELECT DISTINCT ON (canonical_user_id)
    canonical_user_id,
    tx_id,
    created_at
  FROM user_transactions
  WHERE type = 'topup'
    AND tx_id IS NOT NULL
    AND tx_id != ''
    -- Prioritize real on-chain hashes (0x)
  ORDER BY canonical_user_id, 
           CASE WHEN tx_id ILIKE '0x%' THEN 0 ELSE 1 END,
           created_at DESC
)
SELECT 
  ult.canonical_user_id,
  ult.tx_id as latest_topup_tx,
  COUNT(t.id) as tickets_to_update
FROM user_latest_topup ult
JOIN tickets t ON t.canonical_user_id = ult.canonical_user_id
WHERE t.transaction_hash ILIKE 'balance_%'
GROUP BY ult.canonical_user_id, ult.tx_id
ORDER BY tickets_to_update DESC;

-- ============================================================================
-- BACKFILL EXECUTION - Update tickets with real topup tx_id
-- ============================================================================

-- Do the actual update
UPDATE tickets t
SET 
  transaction_hash = ult.tx_id,
  updated_at = NOW()
FROM (
  SELECT DISTINCT ON (canonical_user_id)
    canonical_user_id,
    tx_id
  FROM user_transactions
  WHERE type = 'topup'
    AND tx_id IS NOT NULL
    AND tx_id != ''
    AND tx_id ILIKE '0x%'  -- Only use real on-chain hashes for backfill
  ORDER BY canonical_user_id, created_at DESC
) ult
WHERE t.canonical_user_id = ult.canonical_user_id
  AND t.transaction_hash ILIKE 'balance_%';

-- Report how many were updated
SELECT 
  'After Fix' as status,
  COUNT(*) as total_balance_tickets,
  COUNT(*) FILTER (WHERE transaction_hash ILIKE 'balance_%') as remaining_synthetic,
  COUNT(*) FILTER (WHERE transaction_hash ILIKE '0x%') as real_hashes
FROM tickets
WHERE canonical_user_id IN (
  SELECT DISTINCT canonical_user_id FROM tickets WHERE transaction_hash ILIKE 'balance_%'
);

-- ============================================================================
-- PART 2: GOING FORWARD - Update execute_balance_payment function
-- ============================================================================

-- First, let's look at the current function signature
-- We need to modify it to look up the user's most recent topup tx_id

CREATE OR REPLACE FUNCTION public.execute_balance_payment(
  p_amount numeric, 
  p_competition_id uuid, 
  p_idempotency_key text, 
  p_reservation_id uuid, 
  p_selected_tickets integer[], 
  p_ticket_count integer, 
  p_user_identifier text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_canonical_id text;
  v_currency text := 'USD';
  v_balance_before numeric;
  v_balance_after numeric;
  v_sub_balance_id uuid;
  v_existing jsonb;
  v_result jsonb := '{}'::jsonb;
  v_pending record;
  v_ticket_count integer := 0;
  v_found_canonical_user_id text;
  v_wallet_address text;
  v_unit_price numeric;
  v_total_amount numeric;
  v_order_id uuid;
  v_ticket_num integer;
  v_user_balance numeric;
  v_reservation record;
  v_transaction_id uuid;
  -- NEW: Variable for real topup transaction hash
  v_real_tx_hash text;
BEGIN
  -- 1) Validate user identifier
  IF p_user_identifier IS NULL OR TRIM(p_user_identifier) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'User identifier is required');
  END IF;

  -- Canonicalize user ID
  IF p_user_identifier LIKE 'prize:pid:%' THEN
    v_found_canonical_user_id := p_user_identifier;
    v_wallet_address := SUBSTRING(p_user_identifier FROM 11);
  ELSIF p_user_identifier LIKE '0x%' THEN
    v_found_canonical_user_id := 'prize:pid:' || LOWER(p_user_identifier);
    v_wallet_address := LOWER(p_user_identifier);
  ELSE
    v_found_canonical_user_id := p_user_identifier;
    v_wallet_address := p_user_identifier;
  END IF;

  -- 2) Check idempotency
  SELECT jsonb_build_object(
    'success', true,
    'idempotent', true,
    'order_id', pt.order_id
  ) INTO v_existing
  FROM pending_tickets pt
  WHERE pt.idempotency_key = p_idempotency_key
    AND pt.status = 'confirmed';
  
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  -- 3) Fetch and validate reservation
  SELECT * INTO v_reservation
  FROM pending_tickets
  WHERE id = p_reservation_id 
    AND status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Reservation not found or already processed');
  END IF;

  -- 4) Calculate amounts
  v_unit_price := COALESCE(p_amount / NULLIF(array_length(v_reservation.ticket_numbers, 1), 0), p_amount);
  v_total_amount := p_amount;
  v_order_id := gen_random_uuid();

  -- 5) Check user balance
  SELECT balance_usd INTO v_user_balance
  FROM sub_account_balances
  WHERE canonical_user_id = v_found_canonical_user_id
    AND currency = 'USD'
  FOR UPDATE;

  IF v_user_balance IS NULL OR v_user_balance < v_total_amount THEN
    RETURN jsonb_build_object(
      'success', false, 
      'error', 'Insufficient balance',
      'required', v_total_amount,
      'available', COALESCE(v_user_balance, 0)
    );
  END IF;

  -- 6) Debit user balance
  UPDATE sub_account_balances
  SET balance_usd = balance_usd - v_total_amount,
      updated_at = NOW()
  WHERE canonical_user_id = v_found_canonical_user_id
    AND currency = 'USD';

  -- ==========================================================================
  -- NEW: Look up user's most recent REAL on-chain topup transaction hash
  -- This is used instead of the synthetic 'balance_payment_...' hash
  -- ==========================================================================
  SELECT tx_id INTO v_real_tx_hash
  FROM user_transactions
  WHERE canonical_user_id = v_found_canonical_user_id
    AND type = 'topup'
    AND tx_id IS NOT NULL
    AND tx_id != ''
    AND tx_id ILIKE '0x%'  -- Only real on-chain hashes
  ORDER BY created_at DESC
  LIMIT 1;

  -- Fallback: if no on-chain hash, try any topup tx_id, then fall back to synthetic
  IF v_real_tx_hash IS NULL THEN
    SELECT tx_id INTO v_real_tx_hash
    FROM user_transactions
    WHERE canonical_user_id = v_found_canonical_user_id
      AND type = 'topup'
      AND tx_id IS NOT NULL
      AND tx_id != ''
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;

  -- Final fallback: synthetic hash (should rarely happen)
  IF v_real_tx_hash IS NULL THEN
    v_real_tx_hash := 'balance_payment_' || v_order_id::text;
  END IF;

  -- 7) Insert tickets
  FOR i IN 1..array_length(v_reservation.ticket_numbers, 1) LOOP
    v_ticket_num := v_reservation.ticket_numbers[i];
    
    INSERT INTO tickets (
      id,
      competition_id,
      ticket_number,
      status,
      canonical_user_id,
      updated_at,
      order_id,
      created_at,
      buyer_id,
      wallet_address,
      purchase_price,
      payment_amount,
      payment_provider,
      payment_tx_hash,
      purchased_at,
      transaction_hash  -- Use the real topup hash here
    ) VALUES (
      gen_random_uuid(),
      p_competition_id,
      v_ticket_num,
      'sold',
      v_found_canonical_user_id,
      NOW(),
      v_order_id,
      NOW(),
      v_found_canonical_user_id,
      v_wallet_address,
      v_unit_price,
      v_total_amount,
      'balance',
      v_real_tx_hash,  -- Real topup hash instead of synthetic
      NOW(),
      v_real_tx_hash   -- Real topup hash for transaction_hash too
    )
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- 8) Insert user_transaction record
  v_transaction_id := gen_random_uuid();
  INSERT INTO public.user_transactions (
    id,
    user_id,
    canonical_user_id,
    wallet_address,
    type,
    amount,
    currency,
    balance_before,
    balance_after,
    competition_id,
    order_id,
    description,
    status,
    payment_status,
    ticket_count,
    created_at,
    updated_at,
    completed_at,
    payment_provider,
    tx_id
  ) VALUES (
    v_transaction_id,
    v_found_canonical_user_id,
    v_found_canonical_user_id,
    v_wallet_address,
    'entry',
    v_total_amount,
    'USDC',
    v_user_balance,
    v_user_balance - v_total_amount,
    p_competition_id,
    v_order_id,
    'Competition purchase via balance',
    'completed',
    'completed',
    array_length(v_reservation.ticket_numbers, 1),
    NOW(),
    NOW(),
    NOW(),
    'balance',
    v_real_tx_hash  -- Use real topup hash here too for consistency
  );

  -- 9) Mark pending_tickets confirmed
  UPDATE public.pending_tickets
  SET status = 'confirmed',
      confirmed_at = NOW(),
      updated_at = NOW(),
      transaction_hash = v_real_tx_hash  -- Use real topup hash
  WHERE id = p_reservation_id;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order_id,
    'transaction_id', v_transaction_id,
    'transaction_hash', v_real_tx_hash,  -- Return the real hash
    'amount_charged', v_total_amount,
    'ticket_count', array_length(v_reservation.ticket_numbers, 1),
    'remaining_balance', v_user_balance - v_total_amount
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'Transaction failed: ' || SQLERRM);
END;
$function$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION execute_balance_payment(numeric, uuid, text, uuid, integer[], integer, text) TO authenticated, anon, service_role;

-- ============================================================================
-- PART 3: VERIFICATION
-- ============================================================================

-- Check the results
SELECT 
  'Final State' as report,
  COUNT(*) FILTER (WHERE transaction_hash ILIKE '0x%') as real_onchain_hashes,
  COUNT(*) FILTER (WHERE transaction_hash ILIKE 'balance_%') as synthetic_hashes,
  COUNT(*) FILTER (WHERE transaction_hash NOT ILIKE '0x%' AND transaction_hash NOT ILIKE 'balance_%') as other_hashes,
  COUNT(*) FILTER (WHERE transaction_hash IS NULL) as null_hashes
FROM tickets;

-- Show any remaining balance_payment hashes that couldn't be updated
-- (users who never had an on-chain topup)
SELECT 
  canonical_user_id,
  COUNT(*) as ticket_count,
  MIN(created_at) as first_ticket,
  MAX(created_at) as last_ticket
FROM tickets
WHERE transaction_hash ILIKE 'balance_%'
GROUP BY canonical_user_id
ORDER BY ticket_count DESC
LIMIT 20;

-- ============================================================================
-- DONE!
-- Run this entire script in the Supabase SQL Editor
-- ============================================================================
