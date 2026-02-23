-- ==============================================================================
-- FINAL FIX: cu_normalize_and_enforce trigger
--
-- PROBLEM: The ELSE branch sets canonical_user_id_norm but NOT canonical_user_id
--          causing NULL canonical_user_id for new signups without wallet
--
-- FIX: In ELSE branch, set BOTH canonical_user_id AND canonical_user_id_norm
-- ==============================================================================

-- Ensure sequence exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_sequences WHERE schemaname = 'public' AND sequencename = 'canonical_user_temp_seq') THEN
    CREATE SEQUENCE public.canonical_user_temp_seq START 1;
  END IF;
END $$;

-- Fix the trigger
CREATE OR REPLACE FUNCTION public.cu_normalize_and_enforce()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_generated_temp TEXT;
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
  -- IMPORTANT: Only set if NOT a temporary placeholder (preserve temp IDs from RPC)
  IF NEW.wallet_address IS NOT NULL AND (NEW.canonical_user_id IS NULL OR NEW.canonical_user_id NOT LIKE 'prize:pid:temp%') THEN
    NEW.canonical_user_id := 'prize:pid:' || NEW.wallet_address;
  END IF;

  -- =========================================================================
  -- Set canonical_user_id_norm (required NOT NULL column)
  -- CRITICAL: Also ensure canonical_user_id is set in fallback case
  -- =========================================================================
  IF NEW.canonical_user_id IS NOT NULL THEN
    -- canonical_user_id was provided (by RPC or wallet logic above)
    NEW.canonical_user_id_norm := LOWER(NEW.canonical_user_id);
  ELSIF NEW.wallet_address IS NOT NULL THEN
    -- Have wallet but no canonical_user_id - derive from wallet
    NEW.canonical_user_id := 'prize:pid:' || NEW.wallet_address;
    NEW.canonical_user_id_norm := LOWER(NEW.canonical_user_id);
  ELSE
    -- No wallet AND no canonical_user_id - generate temp for BOTH
    v_generated_temp := 'prize:pid:temp' || LPAD(nextval('public.canonical_user_temp_seq')::text, 6, '0');
    NEW.canonical_user_id := v_generated_temp;      -- <<< THIS WAS MISSING!
    NEW.canonical_user_id_norm := LOWER(v_generated_temp);
  END IF;

  RETURN NEW;
END;
$function$;

-- Verify trigger exists on canonical_users
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'trg_cu_normalize_and_enforce' 
    AND tgrelid = 'canonical_users'::regclass
  ) THEN
    CREATE TRIGGER trg_cu_normalize_and_enforce
      BEFORE INSERT OR UPDATE ON canonical_users
      FOR EACH ROW
      EXECUTE FUNCTION cu_normalize_and_enforce();
  END IF;
END $$;

SELECT 'TRIGGER FIXED - canonical_user_id and canonical_user_id_norm both set in fallback!' as status;
