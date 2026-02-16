-- =====================================================
-- FIX: Remove non-existent field references from balance purchase trigger
-- =====================================================
-- ISSUE: Trigger sync_balance_purchase_to_user_transactions() tries to
-- access NEW.method and NEW.payment_method fields that don't exist in
-- the joincompetition table, causing:
-- "Failed to update competition entry: record "new" has no field "method""
--
-- ROOT CAUSE: Migration 20260216010100 created a trigger that references
-- columns that were never added to the joincompetition table.
--
-- SOLUTION: Update the trigger function to identify balance purchases
-- without relying on non-existent fields. Balance purchases can be
-- identified by:
-- 1. Lack of chain field (no blockchain transaction)
-- 2. Transaction hash format (UUID-like, not blockchain tx hash)
-- =====================================================

BEGIN;

-- Update the trigger function to remove references to non-existent fields
CREATE OR REPLACE FUNCTION sync_balance_purchase_to_user_transactions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance_before NUMERIC;
  v_balance_after NUMERIC;
  v_is_balance_purchase BOOLEAN := false;
BEGIN
  -- Identify balance purchases by their characteristics:
  -- 1. No chain specified (blockchain payments have 'base', 'eth', etc.)
  -- 2. Transaction hash is a UUID format (not a blockchain tx hash)
  -- 3. Amount was spent (amountspent > 0)
  
  -- Check if this looks like a balance purchase
  IF NEW.chain IS NULL OR TRIM(NEW.chain) = '' THEN
    -- No chain means it's not a blockchain payment
    v_is_balance_purchase := true;
  ELSIF NEW.transactionhash IS NOT NULL THEN
    -- If transactionhash is UUID format (36 chars with dashes), it's likely a balance purchase
    -- Blockchain tx hashes are typically 66 chars (0x + 64 hex chars)
    BEGIN
      PERFORM NEW.transactionhash::UUID;
      v_is_balance_purchase := true;
    EXCEPTION WHEN OTHERS THEN
      v_is_balance_purchase := false;
    END;
  END IF;
  
  -- Only process if this is identified as a balance payment
  IF v_is_balance_purchase AND COALESCE(NEW.amountspent, 0) > 0 THEN
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

COMMIT;

-- Log completion
DO $$
BEGIN
  RAISE NOTICE '=== Balance Purchase Trigger Fixed ===';
  RAISE NOTICE 'Removed non-existent field references: NEW.method, NEW.payment_method';
  RAISE NOTICE 'Now identifies balance purchases by:';
  RAISE NOTICE '  1. No chain field (no blockchain transaction)';
  RAISE NOTICE '  2. Transaction hash is UUID format';
  RAISE NOTICE '  3. Has amountspent > 0';
  RAISE NOTICE '';
  RAISE NOTICE 'Balance purchases should now work correctly!';
END $$;
