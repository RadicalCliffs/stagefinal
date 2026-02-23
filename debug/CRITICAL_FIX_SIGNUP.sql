-- ==============================================================================
-- CRITICAL FIX: Signup completely broken
-- 
-- ROOT CAUSE: cu_normalize_and_enforce trigger only sets canonical_user_id_norm
--             but leaves canonical_user_id as NULL in fallback case
--
-- THE FIX: Trigger must set BOTH columns to the same value
-- ==============================================================================

-- Create sequence if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_sequences 
    WHERE schemaname = 'public' AND sequencename = 'canonical_user_temp_seq'
  ) THEN
    CREATE SEQUENCE public.canonical_user_temp_seq START 1;
  END IF;
END $$;

-- Fix the trigger to set BOTH canonical_user_id AND canonical_user_id_norm
CREATE OR REPLACE FUNCTION public.cu_normalize_and_enforce()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_temp_id TEXT;
BEGIN
  -- ==========================================================================
  -- STEP 1: Normalize all wallet fields using util function for consistency
  -- ==========================================================================
  IF NEW.wallet_address IS NOT NULL THEN
    NEW.wallet_address := util.normalize_evm_address(NEW.wallet_address);
  END IF;
  
  IF NEW.base_wallet_address IS NOT NULL THEN
    NEW.base_wallet_address := util.normalize_evm_address(NEW.base_wallet_address);
  END IF;
  
  IF NEW.eth_wallet_address IS NOT NULL THEN
    NEW.eth_wallet_address := util.normalize_evm_address(NEW.eth_wallet_address);
  END IF;

  -- ==========================================================================
  -- STEP 2: If primary wallet is missing but alternates exist, pick first non-null
  -- ==========================================================================
  IF NEW.wallet_address IS NULL THEN
    IF NEW.base_wallet_address IS NOT NULL THEN
      NEW.wallet_address := NEW.base_wallet_address;
    ELSIF NEW.eth_wallet_address IS NOT NULL THEN
      NEW.wallet_address := NEW.eth_wallet_address;
    END IF;
  END IF;

  -- ==========================================================================
  -- STEP 3: Set canonical_user_id when we have a wallet
  -- IMPORTANT: Only set if NOT a temporary placeholder (preserve temp IDs)
  -- ==========================================================================
  IF NEW.wallet_address IS NOT NULL AND (
    NEW.canonical_user_id IS NULL OR 
    NEW.canonical_user_id NOT LIKE 'prize:pid:temp%'
  ) THEN
    NEW.canonical_user_id := 'prize:pid:' || NEW.wallet_address;
  END IF;

  -- ==========================================================================
  -- STEP 4: CRITICAL FIX - Set canonical_user_id_norm (required NOT NULL column)
  --         AND ensure canonical_user_id is also set for new records
  -- ==========================================================================
  IF NEW.canonical_user_id IS NOT NULL THEN
    -- canonical_user_id was provided (temp or wallet-based) - just normalize it
    NEW.canonical_user_id_norm := LOWER(NEW.canonical_user_id);
  ELSIF NEW.wallet_address IS NOT NULL THEN
    -- Has wallet but no canonical_user_id - derive from wallet
    NEW.canonical_user_id := 'prize:pid:' || NEW.wallet_address;
    NEW.canonical_user_id_norm := LOWER(NEW.canonical_user_id);
  ELSE
    -- =========================================================================
    -- CRITICAL: No canonical_user_id AND no wallet - generate temp for BOTH
    -- This is the case that was broken - only set _norm but not canonical_user_id
    -- =========================================================================
    v_temp_id := 'prize:pid:temp' || LPAD(nextval('public.canonical_user_temp_seq')::text, 6, '0');
    NEW.canonical_user_id := v_temp_id;
    NEW.canonical_user_id_norm := LOWER(v_temp_id);
  END IF;

  RETURN NEW;
END;
$function$;

-- Verify trigger is attached
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'cu_normalize_and_enforce' 
    AND tgrelid = 'public.canonical_users'::regclass
  ) THEN
    CREATE TRIGGER cu_normalize_and_enforce
      BEFORE INSERT OR UPDATE ON public.canonical_users
      FOR EACH ROW
      EXECUTE FUNCTION public.cu_normalize_and_enforce();
  END IF;
END $$;

-- TEST: Verify the fix works
DO $$
DECLARE
  v_result RECORD;
BEGIN
  -- Test insert without canonical_user_id or wallet
  INSERT INTO canonical_users (
    uid,
    email,
    username,
    country
  )
  VALUES (
    'test-signup-fix-' || gen_random_uuid()::text,
    'test-' || gen_random_uuid()::text || '@example.com',
    'testuser' || extract(epoch from now())::bigint,
    'US'
  )
  RETURNING canonical_user_id, canonical_user_id_norm INTO v_result;
  
  -- Verify BOTH are set
  IF v_result.canonical_user_id IS NULL THEN
    RAISE EXCEPTION 'FAILED: canonical_user_id is NULL!';
  END IF;
  
  IF v_result.canonical_user_id_norm IS NULL THEN
    RAISE EXCEPTION 'FAILED: canonical_user_id_norm is NULL!';
  END IF;
  
  -- Verify they match
  IF LOWER(v_result.canonical_user_id) != v_result.canonical_user_id_norm THEN
    RAISE EXCEPTION 'FAILED: canonical_user_id and canonical_user_id_norm do not match!';
  END IF;
  
  -- Verify format
  IF NOT v_result.canonical_user_id LIKE 'prize:pid:temp%' THEN
    RAISE EXCEPTION 'FAILED: canonical_user_id should be prize:pid:temp... format, got: %', v_result.canonical_user_id;
  END IF;
  
  RAISE NOTICE 'SUCCESS! canonical_user_id=%, canonical_user_id_norm=%', 
    v_result.canonical_user_id, v_result.canonical_user_id_norm;
  
  -- Clean up test record
  DELETE FROM canonical_users WHERE canonical_user_id = v_result.canonical_user_id;
  
  RAISE NOTICE 'Test record cleaned up. Trigger is working correctly!';
END $$;

SELECT 'CRITICAL FIX APPLIED - Signup should work now!' as status;
