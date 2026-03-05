-- ============================================================================
-- AUTO-FIX TRIGGER FOR user_transactions
-- ============================================================================
-- Automatically fills missing fields in user_transactions from canonical_users
-- Runs on INSERT and UPDATE to ensure transactions always visible in orders tab
-- ============================================================================

-- Drop existing trigger if exists
DROP TRIGGER IF EXISTS trg_auto_fix_transaction_fields ON user_transactions;
DROP FUNCTION IF EXISTS fn_auto_fix_transaction_fields();

-- Create the trigger function
CREATE OR REPLACE FUNCTION fn_auto_fix_transaction_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_record RECORD;
BEGIN
  -- If canonical_user_id is NULL but user_id exists, copy user_id to canonical_user_id
  IF NEW.canonical_user_id IS NULL AND NEW.user_id IS NOT NULL THEN
    NEW.canonical_user_id := NEW.user_id;
    RAISE NOTICE 'AUTO-FIX: Set canonical_user_id = % for transaction %', NEW.user_id, NEW.id;
  END IF;

  -- If we have a user_id, pull additional info from canonical_users
  IF NEW.user_id IS NOT NULL THEN
    SELECT 
      canonical_user_id,
      wallet_address,
      username,
      email
    INTO v_user_record
    FROM canonical_users
    WHERE canonical_user_id = NEW.user_id
    LIMIT 1;

    -- If we found the user, fill in missing fields
    IF v_user_record.canonical_user_id IS NOT NULL THEN
      -- Ensure canonical_user_id is set
      IF NEW.canonical_user_id IS NULL THEN
        NEW.canonical_user_id := v_user_record.canonical_user_id;
        RAISE NOTICE 'AUTO-FIX: Set canonical_user_id from canonical_users for transaction %', NEW.id;
      END IF;

      -- Fill in wallet_address if missing
      IF NEW.wallet_address IS NULL AND v_user_record.wallet_address IS NOT NULL THEN
        NEW.wallet_address := v_user_record.wallet_address;
        RAISE NOTICE 'AUTO-FIX: Set wallet_address = % for transaction %', v_user_record.wallet_address, NEW.id;
      END IF;
    END IF;
  END IF;

  -- Update the updated_at timestamp
  NEW.updated_at := NOW();

  RETURN NEW;
END;
$$;

-- Create the trigger (runs BEFORE INSERT OR UPDATE)
CREATE TRIGGER trg_auto_fix_transaction_fields
  BEFORE INSERT OR UPDATE ON user_transactions
  FOR EACH ROW
  EXECUTE FUNCTION fn_auto_fix_transaction_fields();

-- Grant necessary permissions
REVOKE ALL ON FUNCTION fn_auto_fix_transaction_fields() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_auto_fix_transaction_fields() TO service_role;
GRANT EXECUTE ON FUNCTION fn_auto_fix_transaction_fields() TO authenticated;

-- ============================================================================
-- VERIFY TRIGGER IS INSTALLED
-- ============================================================================
SELECT 
  trigger_name,
  event_manipulation,
  event_object_table,
  action_timing,
  action_statement
FROM information_schema.triggers
WHERE trigger_name = 'trg_auto_fix_transaction_fields';

-- ============================================================================
-- NOW FIX EXISTING RECORDS WITH NULL canonical_user_id
-- ============================================================================
UPDATE user_transactions
SET 
  canonical_user_id = user_id,
  updated_at = NOW()
WHERE canonical_user_id IS NULL
  AND user_id IS NOT NULL;

-- Also pull in missing wallet_address from canonical_users
UPDATE user_transactions ut
SET 
  wallet_address = cu.wallet_address,
  updated_at = NOW()
FROM canonical_users cu
WHERE ut.user_id = cu.canonical_user_id
  AND ut.wallet_address IS NULL
  AND cu.wallet_address IS NOT NULL;

-- ============================================================================
-- VERIFY THE FIX
-- ============================================================================

-- Should return 0 rows (no NULL canonical_user_id)
SELECT COUNT(*) as null_canonical_user_id_count
FROM user_transactions
WHERE canonical_user_id IS NULL
  AND user_id IS NOT NULL;

-- Show user 'invest' transactions (should all be visible now)
SELECT 
  id,
  canonical_user_id,
  wallet_address,
  type,
  amount,
  status,
  payment_status,
  posted_to_balance,
  charge_id,
  created_at
FROM user_transactions
WHERE canonical_user_id = 'prize:pid:0x7b343a531688ac9ed7fbce4f16048970d1c7ba05'
ORDER BY created_at DESC;

DO $$ 
BEGIN
  RAISE NOTICE '✅ TRIGGER INSTALLED - All future transactions will auto-fix canonical_user_id and wallet_address';
  RAISE NOTICE '✅ EXISTING RECORDS FIXED - All transactions now have canonical_user_id';
END $$;
