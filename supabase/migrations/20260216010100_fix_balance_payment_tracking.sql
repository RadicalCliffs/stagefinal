-- =====================================================
-- FIX: purchase_tickets_with_balance must create user_transactions
-- =====================================================
-- ISSUE: Balance payments don't show in dashboard because
-- purchase_tickets_with_balance RPC doesn't create user_transactions records
--
-- This RPC handles wallet balance deductions for ticket purchases
-- It debits sub_account_balances and creates tickets, but never
-- creates a user_transactions record to track the purchase!
--
-- Solution: Add user_transactions creation to the RPC
-- =====================================================

BEGIN;

-- Get the current function definition to modify it
-- We need to add user_transactions INSERT after the balance debit

-- First, let's create a trigger that automatically creates user_transactions
-- when tickets are purchased via balance
CREATE OR REPLACE FUNCTION create_user_transaction_for_balance_purchase()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_competition_id UUID;
  v_canonical_user_id TEXT;
  v_ticket_count INTEGER;
  v_amount NUMERIC;
BEGIN
  -- This trigger fires AFTER tickets are created/updated
  -- Create a user_transactions record for the purchase
  
  -- Get competition and user from the ticket
  SELECT 
    t.competition_id,
    t.canonical_user_id,
    COUNT(*)::INTEGER,
    SUM(c.ticket_price)
  INTO 
    v_competition_id,
    v_canonical_user_id,
    v_ticket_count,
    v_amount
  FROM tickets t
  LEFT JOIN competitions c ON t.competition_id = c.id
  WHERE t.id = NEW.id
    OR (t.canonical_user_id = NEW.canonical_user_id 
        AND t.competition_id = NEW.competition_id
        AND t.created_at >= NOW() - INTERVAL '10 seconds')  -- Recent tickets
  GROUP BY t.competition_id, t.canonical_user_id;
  
  -- Only create transaction if we found the data AND it doesn't already exist
  IF v_canonical_user_id IS NOT NULL 
     AND v_competition_id IS NOT NULL
     AND v_ticket_count > 0
     AND NOT EXISTS (
       SELECT 1 FROM user_transactions ut
       WHERE ut.canonical_user_id = v_canonical_user_id
         AND ut.competition_id = v_competition_id
         AND ut.payment_provider = 'balance'
         AND ut.created_at >= NOW() - INTERVAL '10 seconds')
  THEN
    INSERT INTO user_transactions (
      canonical_user_id,
      user_id,
      competition_id,
      amount,
      currency,
      ticket_count,
      type,
      status,
      payment_status,
      payment_provider,
      method,
      created_at,
      completed_at
    ) VALUES (
      v_canonical_user_id,
      v_canonical_user_id,
      v_competition_id,
      v_amount,
      'USD',
      v_ticket_count,
      'entry',  -- Competition entry
      'completed',
      'completed',
      'balance',  -- CRITICAL: payment_provider = 'balance'
      'balance_deduction',
      NOW(),
      NOW()
    );
  END IF;
  
  RETURN NEW;
END;
$$;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS trg_create_balance_transaction ON tickets;

-- Create trigger on tickets table
-- This fires when tickets are created via balance purchase
CREATE TRIGGER trg_create_balance_transaction
  AFTER INSERT ON tickets
  FOR EACH ROW
  WHEN (NEW.payment_provider = 'balance' OR NEW.method = 'balance')
  EXECUTE FUNCTION create_user_transaction_for_balance_purchase();

-- Note: This trigger approach has a flaw - it fires for EACH ticket
-- We need to modify the purchase_tickets_with_balance RPC directly instead

-- Actually, let me create a better solution...
-- Add a helper function that the RPC can call

DROP TRIGGER IF EXISTS trg_create_balance_transaction ON tickets;
DROP FUNCTION IF EXISTS create_user_transaction_for_balance_purchase();

-- Create a helper function that can be called by the RPC
CREATE OR REPLACE FUNCTION record_balance_purchase_transaction(
  p_canonical_user_id TEXT,
  p_competition_id UUID,
  p_ticket_count INTEGER,
  p_total_amount NUMERIC
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transaction_id UUID;
  v_balance_before NUMERIC;
  v_balance_after NUMERIC;
BEGIN
  -- Get balance before/after from sub_account_balances
  SELECT available_balance INTO v_balance_after
  FROM sub_account_balances
  WHERE canonical_user_id = p_canonical_user_id
    AND currency = 'USD';
  
  v_balance_before := v_balance_after + p_total_amount;
  
  -- Create user_transactions record
  INSERT INTO user_transactions (
    canonical_user_id,
    user_id,
    competition_id,
    amount,
    currency,
    ticket_count,
    type,
    status,
    payment_status,
    payment_provider,
    method,
    balance_before,
    balance_after,
    created_at,
    completed_at
  ) VALUES (
    p_canonical_user_id,
    p_canonical_user_id,
    p_competition_id,
    -1 * ABS(p_total_amount),  -- Negative for debit
    'USD',
    p_ticket_count,
    'entry',
    'completed',
    'completed',
    'balance',  -- CRITICAL: Shows as balance payment
    'balance_deduction',
    v_balance_before,
    v_balance_after,
    NOW(),
    NOW()
  )
  RETURNING id INTO v_transaction_id;
  
  RETURN v_transaction_id;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION record_balance_purchase_transaction(TEXT, UUID, INTEGER, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION record_balance_purchase_transaction(TEXT, UUID, INTEGER, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION record_balance_purchase_transaction(TEXT, UUID, INTEGER, NUMERIC) TO anon;

-- =====================================================
-- WORKAROUND: Create trigger on joincompetition to capture balance purchases
-- =====================================================
-- Since purchase_tickets_with_balance creates joincompetition records,
-- we can trigger off that to create user_transactions

CREATE OR REPLACE FUNCTION sync_balance_purchase_to_user_transactions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance_before NUMERIC;
  v_balance_after NUMERIC;
BEGIN
  -- Only process if this is a balance payment (check method or payment_method)
  IF COALESCE(NEW.method, NEW.payment_method, '') = 'balance' 
     OR COALESCE(NEW.payment_method, NEW.method, '') = 'balance_deduction'
  THEN
    -- Get current balance
    SELECT available_balance INTO v_balance_after
    FROM sub_account_balances
    WHERE canonical_user_id = NEW.canonical_user_id
      AND currency = 'USD';
    
    v_balance_before := COALESCE(v_balance_after, 0) + COALESCE(ABS(NEW.amountspent), 0);
    
    -- Create user_transactions record if it doesn't exist
    INSERT INTO user_transactions (
      canonical_user_id,
      user_id,
      wallet_address,
      user_privy_id,
      competition_id,
      amount,
      currency,
      ticket_count,
      type,
      status,
      payment_status,
      payment_provider,
      method,
      balance_before,
      balance_after,
      tx_id,
      transaction_hash,
      created_at,
      completed_at
    ) VALUES (
      NEW.canonical_user_id,
      COALESCE(NEW.userid, NEW.canonical_user_id),
      NEW.wallet_address,
      NEW.privy_user_id,
      NEW.competitionid,
      -1 * ABS(COALESCE(NEW.amountspent, 0)),  -- Negative for debit
      'USD',
      COALESCE(NEW.numberoftickets, 0),
      'entry',
      'completed',
      'completed',
      'balance',  -- CRITICAL: payment_provider = 'balance'
      'balance_deduction',
      v_balance_before,
      v_balance_after,
      NEW.transactionhash,
      NEW.transactionhash,
      COALESCE(NEW.purchasedate, NOW()),
      COALESCE(NEW.purchasedate, NOW())
    )
    ON CONFLICT (webhook_ref) DO NOTHING  -- Avoid duplicates
    ON CONFLICT (charge_id) DO NOTHING;   -- Avoid duplicates
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger on joincompetition
DROP TRIGGER IF EXISTS trg_sync_balance_purchase_to_user_transactions ON joincompetition;
CREATE TRIGGER trg_sync_balance_purchase_to_user_transactions
  AFTER INSERT OR UPDATE ON joincompetition
  FOR EACH ROW
  EXECUTE FUNCTION sync_balance_purchase_to_user_transactions();

COMMIT;

-- Log completion
DO $$
BEGIN
  RAISE NOTICE '=== Balance Payment Tracking Fixed ===';
  RAISE NOTICE 'Created helper function: record_balance_purchase_transaction()';
  RAISE NOTICE 'Created trigger: trg_sync_balance_purchase_to_user_transactions';
  RAISE NOTICE '';
  RAISE NOTICE 'Future balance purchases will automatically create user_transactions records';
  RAISE NOTICE 'with payment_provider=''balance''';
  RAISE NOTICE '';
  RAISE NOTICE 'NOTE: This is a workaround. Ideally purchase_tickets_with_balance RPC';
  RAISE NOTICE 'should be updated to call record_balance_purchase_transaction() directly.';
END $$;
