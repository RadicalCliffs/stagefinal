-- ==============================================================================
-- HOTFIX: canonical_user_id_norm NOT NULL constraint blocking signups
--
-- ROOT CAUSE: Column is NOT NULL but:
--   1. No default value
--   2. No trigger sets it
--   3. upsert_canonical_user INSERT doesn't include it
--
-- SOLUTION: Update cu_normalize_and_enforce trigger to set canonical_user_id_norm
-- ==============================================================================

-- Create temp sequence for fallback IDs FIRST (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_sequences WHERE schemaname = 'public' AND sequencename = 'canonical_user_temp_seq') THEN
    CREATE SEQUENCE public.canonical_user_temp_seq START 1;
  END IF;
END $$;

-- Fix the trigger to also set canonical_user_id_norm
CREATE OR REPLACE FUNCTION public.cu_normalize_and_enforce()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  -- Normalize all wallet fields using util function for consistency
  IF NEW.wallet_address IS NOT NULL THEN
    NEW.wallet_address := util.normalize_evm_address(NEW.wallet_address);
  END IF;
  
  IF NEW.base_wallet_address IS NOT NULL THEN
    NEW.base_wallet_address := util.normalize_evm_address(NEW.base_wallet_address);
  END IF;
  
  IF NEW.eth_wallet_address IS NOT NULL THEN
    NEW.eth_wallet_address := util.normalize_evm_address(NEW.eth_wallet_address);
  END IF;

  -- If primary wallet is missing but alternates exist, pick first non-null
  IF NEW.wallet_address IS NULL THEN
    IF NEW.base_wallet_address IS NOT NULL THEN
      NEW.wallet_address := NEW.base_wallet_address;
    ELSIF NEW.eth_wallet_address IS NOT NULL THEN
      NEW.wallet_address := NEW.eth_wallet_address;
    END IF;
  END IF;

  -- Enforce canonical_user_id when we have a wallet
  -- IMPORTANT: Only set if NOT a temporary placeholder
  IF NEW.wallet_address IS NOT NULL AND (NEW.canonical_user_id IS NULL OR NEW.canonical_user_id NOT LIKE 'prize:pid:temp%') THEN
    NEW.canonical_user_id := 'prize:pid:' || NEW.wallet_address;
  END IF;

  -- =========================================================================
  -- FIX: Set canonical_user_id_norm (required NOT NULL column)
  -- This mirrors canonical_user_id for case-insensitive unique constraint
  -- =========================================================================
  IF NEW.canonical_user_id IS NOT NULL THEN
    NEW.canonical_user_id_norm := LOWER(NEW.canonical_user_id);
  ELSIF NEW.wallet_address IS NOT NULL THEN
    NEW.canonical_user_id_norm := LOWER('prize:pid:' || NEW.wallet_address);
  ELSE
    -- Fallback: generate temp ID if nothing else available
    NEW.canonical_user_id_norm := 'prize:pid:temp' || LPAD(nextval('public.canonical_user_temp_seq')::text, 6, '0');
  END IF;

  RETURN NEW;
END;
$function$;

-- Note: The trigger runs BEFORE INSERT and sets canonical_user_id_norm
-- No need for column default since trigger always fires

-- Verify: Test insert should now work
-- INSERT INTO canonical_users (uid, wallet_address) VALUES ('test-uid', '0xabc123def456789') RETURNING canonical_user_id, canonical_user_id_norm;
-- (Then delete the test row)

SELECT 'canonical_user_id_norm fix applied!' as status;
