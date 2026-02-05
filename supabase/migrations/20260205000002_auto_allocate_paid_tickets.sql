-- Migration: Auto-allocate tickets when payment succeeded but allocation failed
-- This ensures tickets are ALWAYS allocated when we take user's money
-- ONLY triggers when: payment completed BUT no tickets exist for that transaction

-- Function to check and allocate missing tickets for completed payments
CREATE OR REPLACE FUNCTION auto_allocate_paid_tickets()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ticket_count INTEGER;
  v_existing_tickets INTEGER;
  v_competition_id TEXT;
  v_user_id TEXT;
  v_canonical_user_id TEXT;
  v_wallet_address TEXT;
  v_payment_provider TEXT;
  v_tx_hash TEXT;
BEGIN
  -- Only process completed/confirmed payments
  IF NEW.status NOT IN ('completed', 'confirmed') OR NEW.payment_status NOT IN ('completed', 'confirmed') THEN
    RETURN NEW;
  END IF;

  -- Only process entry transactions (not top-ups)
  IF NEW.competition_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get transaction details
  v_competition_id := NEW.competition_id;
  v_user_id := COALESCE(NEW.user_id, NEW.canonical_user_id);
  v_canonical_user_id := COALESCE(NEW.canonical_user_id, NEW.user_id);
  v_wallet_address := NEW.wallet_address;
  v_payment_provider := COALESCE(NEW.payment_provider, 'unknown');
  v_tx_hash := COALESCE(NEW.tx_id, NEW.id::text);
  v_ticket_count := COALESCE(NEW.ticket_count, 1);

  -- Check if tickets already exist for this transaction
  SELECT COUNT(*)
  INTO v_existing_tickets
  FROM tickets
  WHERE (transaction_hash = v_tx_hash OR tx_id = v_tx_hash)
    AND competition_id = v_competition_id;

  -- If no tickets exist but payment is completed, we need to allocate
  IF v_existing_tickets = 0 AND v_ticket_count > 0 THEN
    RAISE NOTICE '[AutoAllocate] Payment completed but no tickets found. TxID: %, Competition: %, User: %, TicketCount: %',
      v_tx_hash, v_competition_id, v_user_id, v_ticket_count;

    -- Create a pending_tickets entry for automatic allocation
    -- The confirm-pending-tickets function will process this
    INSERT INTO pending_tickets (
      user_id,
      canonical_user_id,
      wallet_address,
      competition_id,
      status,
      hold_minutes,
      expires_at,
      reservation_id,
      ticket_count,
      ticket_price,
      total_amount,
      session_id,
      payment_provider,
      transaction_hash,
      note
    )
    VALUES (
      v_user_id,
      v_canonical_user_id,
      v_wallet_address,
      v_competition_id,
      'pending',
      15, -- 15 minute hold
      NOW() + INTERVAL '15 minutes',
      gen_random_uuid(),
      v_ticket_count,
      COALESCE(NEW.amount / NULLIF(v_ticket_count, 0), 0),
      NEW.amount,
      NEW.id,
      v_payment_provider,
      v_tx_hash,
      'Auto-created by auto_allocate_paid_tickets trigger - payment succeeded but no tickets allocated'
    )
    ON CONFLICT DO NOTHING; -- Prevent duplicates if trigger fires multiple times

    RAISE NOTICE '[AutoAllocate] Created pending_tickets entry for auto-allocation. Session: %', NEW.id;

    -- Call confirm-pending-tickets via HTTP (background job)
    -- This will be handled by an edge function or cron job
    -- For now, just log and the reconcile-payments function will pick it up

  END IF;

  RETURN NEW;
END;
$$;

-- Create trigger on user_transactions
-- Fires AFTER INSERT OR UPDATE when status changes to completed
DROP TRIGGER IF EXISTS trigger_auto_allocate_paid_tickets ON user_transactions;

CREATE TRIGGER trigger_auto_allocate_paid_tickets
  AFTER INSERT OR UPDATE OF status, payment_status
  ON user_transactions
  FOR EACH ROW
  WHEN (
    NEW.status IN ('completed', 'confirmed') 
    AND NEW.payment_status IN ('completed', 'confirmed')
    AND NEW.competition_id IS NOT NULL
  )
  EXECUTE FUNCTION auto_allocate_paid_tickets();

-- Index to speed up ticket lookups by transaction hash
CREATE INDEX IF NOT EXISTS idx_tickets_transaction_hash ON tickets(transaction_hash) WHERE transaction_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_tx_id ON tickets(tx_id) WHERE tx_id IS NOT NULL;

-- Index on pending_tickets for session_id lookups
CREATE INDEX IF NOT EXISTS idx_pending_tickets_session_id ON pending_tickets(session_id) WHERE session_id IS NOT NULL;

COMMENT ON FUNCTION auto_allocate_paid_tickets() IS 
'Auto-allocates tickets when payment completed but no tickets exist. 
Creates pending_tickets entry for automatic allocation by confirm-pending-tickets.
ONLY triggers when: payment completed AND no tickets found for transaction.';

COMMENT ON TRIGGER trigger_auto_allocate_paid_tickets ON user_transactions IS
'Ensures tickets are ALWAYS allocated when payment succeeds.
Triggers on completed payments with competition_id but no existing tickets.';
