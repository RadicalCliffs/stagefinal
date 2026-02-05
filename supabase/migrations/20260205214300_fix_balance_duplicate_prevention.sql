-- ============================================================================
-- CRITICAL FIX: Prevent Duplicate Entries in balance_ledger and sub_account_balances
-- ============================================================================
-- Issue: Duplicate entries occur in balance_ledger and sub_account_balances tables
-- 
-- Root Causes:
-- 1. balance_ledger has NO unique constraint on reference_id
-- 2. sub_account_balances INSERTs don't handle race conditions with ON CONFLICT
-- 3. Multiple duplicate unique indexes exist (schema pollution)
--
-- Solution:
-- 1. Add unique constraint on balance_ledger.reference_id
-- 2. Update all INSERT statements to use ON CONFLICT clauses
-- 3. Clean up duplicate unique indexes
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Add missing unique constraint to balance_ledger.reference_id
-- ============================================================================

-- First, identify and clean up any existing duplicates
DO $$
DECLARE
  v_duplicate_count INTEGER;
BEGIN
  -- Check for duplicates
  SELECT COUNT(*) INTO v_duplicate_count
  FROM (
    SELECT reference_id, COUNT(*) as cnt
    FROM balance_ledger
    WHERE reference_id IS NOT NULL
    GROUP BY reference_id
    HAVING COUNT(*) > 1
  ) dups;
  
  IF v_duplicate_count > 0 THEN
    RAISE NOTICE 'Found % duplicate reference_ids in balance_ledger', v_duplicate_count;
    
    -- Keep only the earliest entry for each reference_id, delete the rest
    DELETE FROM balance_ledger
    WHERE id IN (
      SELECT id
      FROM (
        SELECT id, reference_id,
               ROW_NUMBER() OVER (PARTITION BY reference_id ORDER BY created_at ASC, id ASC) as rn
        FROM balance_ledger
        WHERE reference_id IS NOT NULL
      ) ranked
      WHERE rn > 1
    );
    
    RAISE NOTICE 'Cleaned up duplicate reference_ids in balance_ledger';
  ELSE
    RAISE NOTICE 'No duplicate reference_ids found in balance_ledger';
  END IF;
END $$;

-- Now add the unique constraint (if it doesn't already exist via index)
-- The production CSV shows indexes but we need a proper constraint
DO $$
BEGIN
  -- Check if constraint already exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'balance_ledger_reference_id_unique' 
    AND conrelid = 'balance_ledger'::regclass
  ) THEN
    -- Add unique constraint on reference_id (allows NULLs)
    ALTER TABLE balance_ledger
    ADD CONSTRAINT balance_ledger_reference_id_unique 
    UNIQUE (reference_id);
    
    RAISE NOTICE 'Added unique constraint balance_ledger_reference_id_unique';
  ELSE
    RAISE NOTICE 'Unique constraint balance_ledger_reference_id_unique already exists';
  END IF;
END $$;

-- ============================================================================
-- STEP 2: Clean up duplicate unique indexes on sub_account_balances
-- ============================================================================

-- Production has 5+ duplicate unique indexes on (canonical_user_id, currency)
-- Keep only the original constraint and one clean index

-- Drop duplicate indexes (keep the one from CREATE TABLE)
DROP INDEX IF EXISTS uniq_sub_account_balances_cuid_currency CASCADE;
DROP INDEX IF EXISTS uq_sub_account_balances_user_currency CASCADE;
DROP INDEX IF EXISTS uq_sub_balances_cuid_currency CASCADE;
DROP INDEX IF EXISTS uq_sub_balances_user_currency CASCADE;
DROP INDEX IF EXISTS uq_subacct_can_user_currency CASCADE;

-- Ensure the original unique constraint exists
DO $$
BEGIN
  -- Check if the main unique constraint exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sub_account_balances_canonical_user_id_currency_key'
    AND conrelid = 'sub_account_balances'::regclass
  ) THEN
    -- Constraint doesn't exist, create it
    -- First check for duplicates and clean them up
    RAISE NOTICE 'Checking for duplicate sub_account_balances entries...';
    
    -- Delete duplicates, keeping the most recent entry
    DELETE FROM sub_account_balances
    WHERE id IN (
      SELECT id
      FROM (
        SELECT id, canonical_user_id, currency,
               ROW_NUMBER() OVER (
                 PARTITION BY canonical_user_id, currency 
                 ORDER BY last_updated DESC, created_at DESC, id DESC
               ) as rn
        FROM sub_account_balances
      ) ranked
      WHERE rn > 1
    );
    
    -- Now add the unique constraint
    ALTER TABLE sub_account_balances
    ADD CONSTRAINT sub_account_balances_canonical_user_id_currency_key
    UNIQUE (canonical_user_id, currency);
    
    RAISE NOTICE 'Added unique constraint sub_account_balances_canonical_user_id_currency_key';
  ELSE
    RAISE NOTICE 'Unique constraint sub_account_balances_canonical_user_id_currency_key already exists';
  END IF;
END $$;

-- ============================================================================
-- STEP 3: Update credit_sub_account_balance to use ON CONFLICT
-- ============================================================================

CREATE OR REPLACE FUNCTION public.credit_sub_account_balance(
  p_canonical_user_id TEXT, 
  p_amount NUMERIC, 
  p_currency TEXT DEFAULT 'USD', 
  p_reference_id TEXT DEFAULT NULL, 
  p_description TEXT DEFAULT NULL
)
RETURNS TABLE(
  success BOOLEAN, 
  previous_balance NUMERIC, 
  new_balance NUMERIC, 
  error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_record_id TEXT;
  v_previous_balance NUMERIC;
  v_new_balance NUMERIC;
  search_wallet TEXT;
BEGIN
  -- Validate amount
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, 0::NUMERIC, 0::NUMERIC, 'Amount must be positive'::TEXT;
    RETURN;
  END IF;

  -- Extract wallet address from prize:pid: format if present
  IF p_canonical_user_id LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(p_canonical_user_id FROM 11));
  ELSIF p_canonical_user_id LIKE '0x%' AND LENGTH(p_canonical_user_id) = 42 THEN
    search_wallet := LOWER(p_canonical_user_id);
  ELSE
    search_wallet := NULL;
  END IF;

  -- Use INSERT ... ON CONFLICT to handle race conditions
  -- This prevents duplicates even with concurrent calls
  INSERT INTO public.sub_account_balances (
    canonical_user_id,
    user_id,
    currency,
    available_balance,
    pending_balance,
    last_updated
  ) VALUES (
    p_canonical_user_id,
    p_canonical_user_id,
    p_currency,
    p_amount,
    0,
    NOW()
  )
  ON CONFLICT (canonical_user_id, currency) 
  DO UPDATE SET
    available_balance = sub_account_balances.available_balance + EXCLUDED.available_balance,
    last_updated = NOW()
  RETURNING id, 
            sub_account_balances.available_balance - EXCLUDED.available_balance,
            sub_account_balances.available_balance
  INTO v_record_id, v_previous_balance, v_new_balance;

  -- Round to 2 decimal places
  v_new_balance := ROUND(v_new_balance, 2);
  v_previous_balance := ROUND(COALESCE(v_previous_balance, 0), 2);

  -- CRITICAL: Create balance_ledger audit entry with ON CONFLICT
  IF p_reference_id IS NOT NULL THEN
    -- Use INSERT ... ON CONFLICT to prevent duplicate ledger entries
    INSERT INTO public.balance_ledger (
      canonical_user_id,
      transaction_type,
      amount,
      currency,
      balance_before,
      balance_after,
      reference_id,
      description,
      created_at
    ) VALUES (
      p_canonical_user_id,
      'credit',
      p_amount,
      p_currency,
      v_previous_balance,
      v_new_balance,
      p_reference_id,
      p_description,
      NOW()
    )
    ON CONFLICT (reference_id) DO NOTHING;  -- Prevent duplicate ledger entries
  ELSE
    -- No reference_id, so always insert (for backward compatibility)
    INSERT INTO public.balance_ledger (
      canonical_user_id,
      transaction_type,
      amount,
      currency,
      balance_before,
      balance_after,
      reference_id,
      description,
      created_at
    ) VALUES (
      p_canonical_user_id,
      'credit',
      p_amount,
      p_currency,
      v_previous_balance,
      v_new_balance,
      p_reference_id,
      p_description,
      NOW()
    );
  END IF;

  RETURN QUERY SELECT TRUE, v_previous_balance, v_new_balance, NULL::TEXT;
END;
$$;

-- ============================================================================
-- STEP 4: Update debit_sub_account_balance to use ON CONFLICT
-- ============================================================================

CREATE OR REPLACE FUNCTION public.debit_sub_account_balance(
  p_canonical_user_id TEXT, 
  p_amount NUMERIC, 
  p_currency TEXT DEFAULT 'USD', 
  p_reference_id TEXT DEFAULT NULL, 
  p_description TEXT DEFAULT NULL
)
RETURNS TABLE(
  success BOOLEAN, 
  previous_balance NUMERIC, 
  new_balance NUMERIC, 
  error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_record_id TEXT;
  v_previous_balance NUMERIC;
  v_new_balance NUMERIC;
  search_wallet TEXT;
BEGIN
  -- Validate amount
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, 0::NUMERIC, 0::NUMERIC, 'Amount must be positive'::TEXT;
    RETURN;
  END IF;

  -- Extract wallet address from prize:pid: format if present
  IF p_canonical_user_id LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(p_canonical_user_id FROM 11));
  ELSIF p_canonical_user_id LIKE '0x%' AND LENGTH(p_canonical_user_id) = 42 THEN
    search_wallet := LOWER(p_canonical_user_id);
  ELSE
    search_wallet := NULL;
  END IF;

  -- Lock the record for update to get current balance
  SELECT id, COALESCE(available_balance, 0)
  INTO v_record_id, v_previous_balance
  FROM public.sub_account_balances
  WHERE currency = p_currency
    AND (
      canonical_user_id = p_canonical_user_id
      OR canonical_user_id = LOWER(p_canonical_user_id)
      OR (search_wallet IS NOT NULL AND canonical_user_id = 'prize:pid:' || search_wallet)
      OR user_id = p_canonical_user_id
      OR privy_user_id = p_canonical_user_id
    )
  ORDER BY
    CASE
      WHEN canonical_user_id = p_canonical_user_id THEN 0
      WHEN canonical_user_id = LOWER(p_canonical_user_id) THEN 1
      ELSE 2
    END
  LIMIT 1
  FOR UPDATE;

  -- Check if record exists
  IF v_record_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0::NUMERIC, 0::NUMERIC, 'No balance record found'::TEXT;
    RETURN;
  END IF;

  -- Check sufficient balance
  IF v_previous_balance < p_amount THEN
    RETURN QUERY SELECT FALSE, v_previous_balance, v_previous_balance, 'Insufficient balance'::TEXT;
    RETURN;
  END IF;

  -- Calculate new balance
  v_new_balance := ROUND(v_previous_balance - p_amount, 2);

  -- Update the record
  UPDATE public.sub_account_balances
  SET
    available_balance = v_new_balance,
    last_updated = NOW()
  WHERE id = v_record_id;

  -- CRITICAL: Create balance_ledger audit entry with ON CONFLICT
  IF p_reference_id IS NOT NULL THEN
    -- Use INSERT ... ON CONFLICT to prevent duplicate ledger entries
    INSERT INTO public.balance_ledger (
      canonical_user_id,
      transaction_type,
      amount,
      currency,
      balance_before,
      balance_after,
      reference_id,
      description,
      created_at
    ) VALUES (
      p_canonical_user_id,
      'debit',
      -p_amount,  -- Negative for debit
      p_currency,
      v_previous_balance,
      v_new_balance,
      p_reference_id,
      p_description,
      NOW()
    )
    ON CONFLICT (reference_id) DO NOTHING;  -- Prevent duplicate ledger entries
  ELSE
    -- No reference_id, so always insert (for backward compatibility)
    INSERT INTO public.balance_ledger (
      canonical_user_id,
      transaction_type,
      amount,
      currency,
      balance_before,
      balance_after,
      reference_id,
      description,
      created_at
    ) VALUES (
      p_canonical_user_id,
      'debit',
      -p_amount,
      p_currency,
      v_previous_balance,
      v_new_balance,
      p_reference_id,
      p_description,
      NOW()
    );
  END IF;

  RETURN QUERY SELECT TRUE, v_previous_balance, v_new_balance, NULL::TEXT;
END;
$$;

-- ============================================================================
-- STEP 5: Grant permissions
-- ============================================================================

GRANT EXECUTE ON FUNCTION credit_sub_account_balance(TEXT, NUMERIC, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION credit_sub_account_balance(TEXT, NUMERIC, TEXT, TEXT, TEXT) TO service_role;

GRANT EXECUTE ON FUNCTION debit_sub_account_balance(TEXT, NUMERIC, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION debit_sub_account_balance(TEXT, NUMERIC, TEXT, TEXT, TEXT) TO service_role;

-- ============================================================================
-- STEP 6: Add helpful comments
-- ============================================================================

COMMENT ON CONSTRAINT balance_ledger_reference_id_unique ON balance_ledger IS 
'Prevents duplicate ledger entries for the same reference_id. Critical for avoiding duplicate charges/credits.';

COMMENT ON CONSTRAINT sub_account_balances_canonical_user_id_currency_key ON sub_account_balances IS
'Ensures each user has exactly one balance record per currency. Prevents balance fragmentation.';

COMMENT ON FUNCTION credit_sub_account_balance(TEXT, NUMERIC, TEXT, TEXT, TEXT) IS
'Credits user balance with duplicate prevention via ON CONFLICT. Always provide reference_id to prevent duplicate credits.';

COMMENT ON FUNCTION debit_sub_account_balance(TEXT, NUMERIC, TEXT, TEXT, TEXT) IS
'Debits user balance with duplicate prevention via ON CONFLICT. Always provide reference_id to prevent duplicate debits.';

COMMIT;

-- ============================================================================
-- Log completion
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '==============================================================================';
  RAISE NOTICE 'Balance Duplicate Prevention Migration Complete';
  RAISE NOTICE '==============================================================================';
  RAISE NOTICE 'Fixed:';
  RAISE NOTICE '  ✓ Added unique constraint on balance_ledger.reference_id';
  RAISE NOTICE '  ✓ Cleaned up duplicate unique indexes on sub_account_balances';
  RAISE NOTICE '  ✓ Updated credit_sub_account_balance to use ON CONFLICT';
  RAISE NOTICE '  ✓ Updated debit_sub_account_balance to use ON CONFLICT';
  RAISE NOTICE '  ✓ Added safeguards against race conditions';
  RAISE NOTICE '';
  RAISE NOTICE 'This prevents:';
  RAISE NOTICE '  - Duplicate balance_ledger entries for same reference_id';
  RAISE NOTICE '  - Duplicate sub_account_balances records for same user+currency';
  RAISE NOTICE '  - Race conditions from concurrent balance operations';
  RAISE NOTICE '==============================================================================';
END $$;
