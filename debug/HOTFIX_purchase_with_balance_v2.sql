-- HOTFIX: Create a working purchase_with_balance_v2 function
-- This function properly works with the pending_tickets reservation system
-- 
-- Flow: 
-- 1. Validate reservation exists and is pending
-- 2. Lock and deduct user balance
-- 3. Set confirmed_at on pending_tickets (trigger creates tickets)
-- 4. Record ledger entry
-- 5. Return success

-- First, create the function
CREATE OR REPLACE FUNCTION public.purchase_with_balance_v2(
  p_reservation_id uuid,
  p_user_identifier text,
  p_expected_total numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pending RECORD;
  v_balance_before numeric;
  v_balance_after numeric;
  v_total numeric;
  v_cuid text;
  v_now timestamptz := now();
BEGIN
  -- 1. Validate and lock reservation
  SELECT * INTO v_pending
  FROM public.pending_tickets
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'reservation_not_found');
  END IF;

  IF v_pending.status = 'confirmed' THEN
    RETURN jsonb_build_object('ok', true, 'already_confirmed', true, 'reservation_id', p_reservation_id);
  END IF;

  IF v_pending.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'reservation_status_invalid', 'status', v_pending.status);
  END IF;

  IF v_pending.expires_at IS NOT NULL AND v_pending.expires_at < v_now THEN
    UPDATE public.pending_tickets SET status = 'expired', updated_at = v_now WHERE id = p_reservation_id;
    RETURN jsonb_build_object('ok', false, 'error', 'reservation_expired');
  END IF;

  -- Resolve canonical user ID
  v_cuid := COALESCE(v_pending.canonical_user_id, v_pending.user_id);
  IF v_cuid IS NULL THEN
    -- Try to match from input
    IF p_user_identifier ~ '^prize:pid:0x[a-f0-9]{40}$' THEN
      v_cuid := lower(p_user_identifier);
    ELSIF p_user_identifier ~ '^0x[a-f0-9]{40}$' THEN
      v_cuid := 'prize:pid:' || lower(p_user_identifier);
    ELSE
      RETURN jsonb_build_object('ok', false, 'error', 'cannot_resolve_user');
    END IF;
  END IF;

  -- Calculate total
  v_total := COALESCE(v_pending.total_amount, v_pending.ticket_price * v_pending.ticket_count);
  IF v_total IS NULL OR v_total <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_total_amount');
  END IF;

  -- Validate expected total if provided
  IF p_expected_total IS NOT NULL AND v_total <> p_expected_total THEN
    RETURN jsonb_build_object('ok', false, 'error', 'total_mismatch', 'expected', p_expected_total, 'actual', v_total);
  END IF;

  -- 2. Lock and check balance
  SELECT available_balance INTO v_balance_before
  FROM public.sub_account_balances
  WHERE canonical_user_id = v_cuid AND currency = 'USD'
  FOR UPDATE;

  IF v_balance_before IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_balance_record', 'user', v_cuid);
  END IF;

  IF v_balance_before < v_total THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_balance', 'required', v_total, 'available', v_balance_before);
  END IF;

  -- 3. Deduct balance
  UPDATE public.sub_account_balances
  SET available_balance = available_balance - v_total,
      last_updated = v_now
  WHERE canonical_user_id = v_cuid AND currency = 'USD'
  RETURNING available_balance INTO v_balance_after;

  -- 4. Confirm reservation (trigger trg_fn_confirm_pending_tickets creates tickets)
  UPDATE public.pending_tickets
  SET status = 'confirmed',
      confirmed_at = v_now,
      updated_at = v_now,
      canonical_user_id = COALESCE(canonical_user_id, v_cuid)
  WHERE id = p_reservation_id;

  -- 5. Record ledger entry
  INSERT INTO public.balance_ledger (
    id, canonical_user_id, transaction_type, amount, currency,
    balance_before, balance_after, reference_id, description, created_at
  ) VALUES (
    gen_random_uuid(), v_cuid, 'debit', v_total, 'USD',
    v_balance_before, v_balance_after, p_reservation_id::text,
    'Ticket purchase - ' || COALESCE(v_pending.ticket_count, 0) || ' tickets', v_now
  );

  -- Return success
  RETURN jsonb_build_object(
    'ok', true,
    'reservation_id', p_reservation_id,
    'competition_id', v_pending.competition_id,
    'ticket_numbers', COALESCE(v_pending.ticket_numbers, ARRAY[]::int[]),
    'ticket_count', COALESCE(v_pending.ticket_count, 0),
    'total_amount', v_total,
    'balance_before', v_balance_before,
    'balance_after', v_balance_after,
    'user', v_cuid
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM, 'code', SQLSTATE);
END;
$function$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.purchase_with_balance_v2(uuid, text, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_with_balance_v2(uuid, text, numeric) TO service_role;

-- Add comment
COMMENT ON FUNCTION public.purchase_with_balance_v2 IS 
'V2 balance purchase function that works with pending_tickets reservation system.
Call flow: 1) allocate_lucky_dip_tickets_batch to reserve, 2) purchase_with_balance_v2 to confirm and deduct balance.
The trigger trg_fn_confirm_pending_tickets handles ticket creation when confirmed_at is set.';

-- Verify deployment (returns result set)
SELECT 
  '✓ SUCCESS' as status,
  p.proname as function_name,
  pg_get_function_arguments(p.oid) as arguments,
  pg_get_function_result(p.oid) as returns
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' AND p.proname = 'purchase_with_balance_v2';
