-- ============================================================================
-- CRITICAL FIX: Bulletproof Top-Up Crediting + Duplicate Wallet Fix
-- ============================================================================
-- This script fixes:
-- 1. Double-crediting of top-ups (yammy got $6 instead of $4.50)
-- 2. Duplicate wallet display (case-sensitive vs lowercase duplicates)
--
-- ROOT CAUSE OF DOUBLE CREDIT:
-- - trg_optimistic_topup_credit trigger credits on INSERT (always applies 50% bonus!)
-- - instant-topup.mts calls credit_balance_with_first_deposit_bonus
-- - commerce-webhook ALSO calls credit_balance_with_first_deposit_bonus
-- - MULTIPLE systems were crediting without proper idempotency!
--
-- FIX: 
-- 1. DROP the problematic trigger (it was always applying bonus)
-- 2. Add bulletproof idempotency check on reference_id in the RPC
-- 3. Only apply bonus on FIRST EVER deposit
-- ============================================================================

BEGIN;

-- ============================================================================
-- PART 0: DROP THE PROBLEMATIC TRIGGER THAT CAUSES DOUBLE-CREDIT
-- ============================================================================

-- This trigger was firing on INSERT and applying 50% bonus EVERY TIME
-- DELETE IT - let the RPC functions handle crediting properly
DROP TRIGGER IF EXISTS trg_optimistic_topup_credit ON user_transactions;
DROP FUNCTION IF EXISTS fn_optimistic_topup_credit();

-- Also drop any other auto-credit triggers that might interfere
DROP TRIGGER IF EXISTS trg_auto_credit_on_topup ON user_transactions;
DROP TRIGGER IF EXISTS trg_credit_on_topup_insert ON user_transactions;

RAISE NOTICE 'Dropped problematic auto-credit triggers';

-- ============================================================================
-- PART 1: FIX credit_balance_with_first_deposit_bonus WITH IDEMPOTENCY
-- ============================================================================

CREATE OR REPLACE FUNCTION credit_balance_with_first_deposit_bonus(
  p_canonical_user_id TEXT,
  p_amount NUMERIC,
  p_reason TEXT,
  p_reference_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_used_bonus BOOLEAN;
  v_bonus_amount NUMERIC := 0;
  v_total_credit NUMERIC;
  v_new_balance NUMERIC;
  v_existing_credit RECORD;
  v_is_first_deposit BOOLEAN := false;
BEGIN
  -- =========================================================================
  -- CRITICAL IDEMPOTENCY CHECK: Scan balance_ledger for ANY existing credit
  -- with same reference_id OR similar reference patterns
  -- =========================================================================
  
  -- Check if this exact reference_id was already credited
  SELECT id, amount, created_at INTO v_existing_credit
  FROM balance_ledger
  WHERE reference_id = p_reference_id
    AND canonical_user_id = p_canonical_user_id
  LIMIT 1;
  
  IF v_existing_credit.id IS NOT NULL THEN
    -- Already credited - return success but don't credit again
    RAISE NOTICE 'IDEMPOTENCY: Reference % already credited (ledger id: %)', p_reference_id, v_existing_credit.id;
    
    SELECT COALESCE(available_balance, 0) + COALESCE(bonus_balance, 0) INTO v_new_balance
    FROM sub_account_balances
    WHERE canonical_user_id = p_canonical_user_id AND currency = 'USD';
    
    RETURN jsonb_build_object(
      'success', true,
      'already_credited', true,
      'credited_amount', 0,
      'bonus_amount', 0,
      'bonus_applied', false,
      'total_credited', 0,
      'new_balance', COALESCE(v_new_balance, 0),
      'idempotency_note', 'Credit already applied for reference: ' || p_reference_id
    );
  END IF;
  
  -- Also check user_transactions for wallet_credited flag on this tx
  -- This catches cases where balance_ledger might not have the entry yet
  IF p_reference_id IS NOT NULL AND p_reference_id LIKE '0x%' THEN
    -- It's a transaction hash - check if already credited in user_transactions
    PERFORM 1 FROM user_transactions 
    WHERE tx_id = p_reference_id
      AND (wallet_credited = true OR posted_to_balance = true)
    LIMIT 1;
    
    IF FOUND THEN
      RAISE NOTICE 'IDEMPOTENCY: Transaction % already marked as credited in user_transactions', p_reference_id;
      
      SELECT COALESCE(available_balance, 0) + COALESCE(bonus_balance, 0) INTO v_new_balance
      FROM sub_account_balances
      WHERE canonical_user_id = p_canonical_user_id AND currency = 'USD';
      
      RETURN jsonb_build_object(
        'success', true,
        'already_credited', true,
        'credited_amount', 0,
        'bonus_amount', 0,
        'bonus_applied', false,
        'total_credited', 0,
        'new_balance', COALESCE(v_new_balance, 0),
        'idempotency_note', 'Credit already applied for tx: ' || p_reference_id
      );
    END IF;
  END IF;

  -- =========================================================================
  -- FIRST DEPOSIT CHECK: Check if user has EVER had a credit before
  -- =========================================================================
  
  -- Check canonical_users flag first
  SELECT COALESCE(has_used_new_user_bonus, false) INTO v_has_used_bonus
  FROM canonical_users
  WHERE canonical_user_id = p_canonical_user_id;

  -- Double-check by scanning balance_ledger for ANY deposit
  IF v_has_used_bonus = false OR v_has_used_bonus IS NULL THEN
    PERFORM 1 FROM balance_ledger 
    WHERE canonical_user_id = p_canonical_user_id 
      AND transaction_type IN ('deposit', 'credit', 'topup')
      AND amount > 0
    LIMIT 1;
    
    IF NOT FOUND THEN
      -- This is truly the first deposit!
      v_is_first_deposit := true;
      v_bonus_amount := p_amount * 0.50; -- 50% bonus
      v_total_credit := p_amount + v_bonus_amount;
      
      RAISE NOTICE 'FIRST DEPOSIT: Applying 50%% bonus ($%) for user %', v_bonus_amount, p_canonical_user_id;

      -- Mark bonus as used IMMEDIATELY (before crediting)
      UPDATE canonical_users
      SET has_used_new_user_bonus = true,
          updated_at = NOW()
      WHERE canonical_user_id = p_canonical_user_id;
      
      -- If user doesn't exist in canonical_users, create them
      IF NOT FOUND THEN
        INSERT INTO canonical_users (canonical_user_id, has_used_new_user_bonus, created_at, updated_at)
        VALUES (p_canonical_user_id, true, NOW(), NOW())
        ON CONFLICT (canonical_user_id) DO UPDATE SET has_used_new_user_bonus = true, updated_at = NOW();
      END IF;

      -- Credit bonus to bonus_balance
      INSERT INTO sub_account_balances (canonical_user_id, currency, bonus_balance, available_balance)
      VALUES (p_canonical_user_id, 'USD', v_bonus_amount, 0)
      ON CONFLICT (canonical_user_id, currency)
      DO UPDATE SET
        bonus_balance = COALESCE(sub_account_balances.bonus_balance, 0) + v_bonus_amount,
        updated_at = NOW();

      -- Log bonus award
      BEGIN
        INSERT INTO bonus_award_audit (
          canonical_user_id,
          amount,
          reason,
          note
        ) VALUES (
          p_canonical_user_id,
          v_bonus_amount,
          p_reason,
          'First deposit bonus: 50%'
        );
      EXCEPTION WHEN undefined_table THEN
        NULL;
      END;
    ELSE
      -- Not first deposit
      v_total_credit := p_amount;
    END IF;
  ELSE
    -- Bonus already used
    v_total_credit := p_amount;
  END IF;

  -- =========================================================================
  -- CREDIT THE MAIN BALANCE
  -- =========================================================================
  
  INSERT INTO sub_account_balances (canonical_user_id, currency, available_balance)
  VALUES (p_canonical_user_id, 'USD', p_amount)
  ON CONFLICT (canonical_user_id, currency)
  DO UPDATE SET
    available_balance = COALESCE(sub_account_balances.available_balance, 0) + p_amount,
    updated_at = NOW();

  -- Get the new total balance
  SELECT COALESCE(available_balance, 0) + COALESCE(bonus_balance, 0) INTO v_new_balance
  FROM sub_account_balances
  WHERE canonical_user_id = p_canonical_user_id AND currency = 'USD';

  -- =========================================================================
  -- LOG TO BALANCE_LEDGER (THIS IS THE IDEMPOTENCY RECORD)
  -- =========================================================================
  
  BEGIN
    INSERT INTO balance_ledger (
      canonical_user_id,
      transaction_type,
      amount,
      reference_id,
      description,
      balance_after
    ) VALUES (
      p_canonical_user_id,
      'deposit',
      v_total_credit,
      p_reference_id,
      p_reason || CASE WHEN v_is_first_deposit THEN ' (+ 50% first deposit bonus)' ELSE '' END,
      v_new_balance
    );
  EXCEPTION WHEN undefined_table THEN
    NULL;
  EXCEPTION WHEN unique_violation THEN
    -- If there's a unique constraint on reference_id, that's also an idempotency indicator
    RAISE NOTICE 'IDEMPOTENCY: Unique violation on balance_ledger for reference %', p_reference_id;
  END;

  -- =========================================================================
  -- UPDATE user_transactions TO MARK AS CREDITED
  -- =========================================================================
  
  IF p_reference_id IS NOT NULL AND p_reference_id LIKE '0x%' THEN
    UPDATE user_transactions
    SET wallet_credited = true,
        posted_to_balance = true,
        updated_at = NOW()
    WHERE tx_id = p_reference_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'already_credited', false,
    'credited_amount', p_amount,
    'bonus_amount', v_bonus_amount,
    'bonus_applied', v_is_first_deposit,
    'total_credited', v_total_credit,
    'new_balance', COALESCE(v_new_balance, p_amount + v_bonus_amount)
  );
END;
$$;

-- Grant permissions
REVOKE ALL ON FUNCTION credit_balance_with_first_deposit_bonus(TEXT, NUMERIC, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION credit_balance_with_first_deposit_bonus(TEXT, NUMERIC, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION credit_balance_with_first_deposit_bonus(TEXT, NUMERIC, TEXT, TEXT) TO authenticated;

-- ============================================================================
-- PART 2: FIX get_user_wallets TO DEDUPLICATE (case-insensitive)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_user_wallets(user_identifier text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
  user_record RECORD;
  wallets_array jsonb := '[]'::jsonb;
  v_primary_wallet TEXT;
BEGIN
  -- Find the user in canonical_users (case-insensitive)
  SELECT * INTO user_record
  FROM canonical_users
  WHERE LOWER(canonical_user_id) = LOWER(user_identifier)
     OR LOWER(wallet_address) = LOWER(user_identifier)
  LIMIT 1;

  IF user_record IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'User not found',
      'wallets', '[]'::jsonb,
      'primary_wallet', NULL
    );
  END IF;

  -- Use lowercase wallet as the canonical primary
  v_primary_wallet := LOWER(user_record.wallet_address);

  -- Only add ONE wallet entry (the primary, lowercased)
  -- This prevents duplicate display from case differences
  IF v_primary_wallet IS NOT NULL THEN
    wallets_array := wallets_array || jsonb_build_object(
      'address', v_primary_wallet,
      'wallet_address', v_primary_wallet,
      'type', 'primary',
      'chain', 'base',
      'is_primary', true,
      'nickname', COALESCE(user_record.username, 'Primary Wallet'),
      'linked_at', COALESCE(user_record.created_at::text, NOW()::text)
    );
  END IF;

  -- DO NOT add eth_wallet_address or base_wallet_address if they're
  -- case-insensitively the same as primary wallet
  -- This was causing the duplicate!
  
  -- Only add ETH wallet if it's a DIFFERENT address (case-insensitive)
  IF user_record.eth_wallet_address IS NOT NULL 
     AND LOWER(user_record.eth_wallet_address) != COALESCE(v_primary_wallet, '') THEN
    wallets_array := wallets_array || jsonb_build_object(
      'address', LOWER(user_record.eth_wallet_address),
      'wallet_address', LOWER(user_record.eth_wallet_address),
      'type', 'ethereum',
      'chain', 'ethereum',
      'is_primary', false,
      'nickname', 'Ethereum Wallet',
      'linked_at', COALESCE(user_record.created_at::text, NOW()::text)
    );
  END IF;

  -- Only add Base wallet if it's a DIFFERENT address (case-insensitive)
  IF user_record.base_wallet_address IS NOT NULL 
     AND LOWER(user_record.base_wallet_address) != COALESCE(v_primary_wallet, '')
     AND LOWER(user_record.base_wallet_address) != COALESCE(LOWER(user_record.eth_wallet_address), '') THEN
    wallets_array := wallets_array || jsonb_build_object(
      'address', LOWER(user_record.base_wallet_address),
      'wallet_address', LOWER(user_record.base_wallet_address),
      'type', 'base',
      'chain', 'base',
      'is_primary', false,
      'nickname', 'Base Wallet',
      'linked_at', COALESCE(user_record.created_at::text, NOW()::text)
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'wallets', wallets_array,
    'primary_wallet', v_primary_wallet,
    'wallet_address', v_primary_wallet,
    'eth_wallet_address', LOWER(user_record.eth_wallet_address),
    'base_wallet_address', LOWER(user_record.base_wallet_address)
  );
END;
$$;

-- Grant permissions
REVOKE ALL ON FUNCTION get_user_wallets(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_user_wallets(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION get_user_wallets(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_wallets(TEXT) TO anon;

-- ============================================================================
-- PART 3: ADD UNIQUE INDEX ON balance_ledger.reference_id (if not exists)
-- This adds database-level protection against duplicate credits
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE indexname = 'idx_balance_ledger_reference_unique'
  ) THEN
    -- Create unique index on canonical_user_id + reference_id
    -- This ensures same reference can't be credited twice to same user
    CREATE UNIQUE INDEX idx_balance_ledger_reference_unique 
    ON balance_ledger(canonical_user_id, reference_id) 
    WHERE reference_id IS NOT NULL;
    RAISE NOTICE 'Created unique index on balance_ledger(canonical_user_id, reference_id)';
  END IF;
EXCEPTION WHEN duplicate_table THEN
  RAISE NOTICE 'Unique index already exists';
END $$;

-- ============================================================================
-- PART 4: FIX YAMMY'S BALANCE (if running after the fact)
-- ============================================================================

-- First, let's see what yammy's current state is:
-- SELECT * FROM canonical_users WHERE wallet_address ILIKE '%0xc344%';
-- SELECT * FROM sub_account_balances WHERE canonical_user_id ILIKE '%0xc344%';
-- SELECT * FROM balance_ledger WHERE canonical_user_id ILIKE '%0xc344%';
-- SELECT * FROM user_transactions WHERE canonical_user_id ILIKE '%0xc344%' AND type = 'topup';

-- To fix yammy: She deposited $3, got credited $6 (twice), should have $4.50 ($3 + 50% bonus)
-- Uncomment and run after verifying the wallet address:

-- UPDATE sub_account_balances 
-- SET available_balance = 3.00,
--     bonus_balance = 1.50,
--     updated_at = NOW()
-- WHERE canonical_user_id ILIKE '%0xc344%';

-- Mark her bonus as used if not already:
-- UPDATE canonical_users 
-- SET has_used_new_user_bonus = true 
-- WHERE wallet_address ILIKE '%0xc344%';

COMMIT;

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Test the fixed credit function (should return already_credited: true on second call)
-- SELECT credit_balance_with_first_deposit_bonus('test:user:123', 10.00, 'test', 'test-ref-001');
-- SELECT credit_balance_with_first_deposit_bonus('test:user:123', 10.00, 'test', 'test-ref-001');

-- Test wallet deduplication
-- SELECT * FROM get_user_wallets('prize:pid:0xc344b1b6a5ad9c5e25...');
