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
-- Solution: Add trigger on joincompetition to create user_transactions
-- =====================================================

BEGIN;

-- Create a helper function that can be called by the RPC or trigger
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
    -- Use transactionhash as unique identifier to prevent duplicates
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
    -- Use tx_id uniqueness to avoid duplicates
    ON CONFLICT (tx_id) 
    WHERE tx_id IS NOT NULL
    DO NOTHING;
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
  RAISE NOTICE 'NOTE: This is a workaround using joincompetition trigger.';
  RAISE NOTICE 'Ideally purchase_tickets_with_balance RPC should call';
  RAISE NOTICE 'record_balance_purchase_transaction() directly for better reliability.';
END $$;
