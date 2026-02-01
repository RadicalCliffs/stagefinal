-- Migration: Fix wallet_address in user_transactions table
-- This migration:
-- 1. Updates the user_transactions_sync_wallet trigger to properly extract wallet addresses
-- 2. Normalizes existing wallet_address data to contain only actual wallet addresses
-- 3. Ensures wallet_address never contains canonical_user_id format

-- First, fix the trigger function to properly extract wallet addresses
CREATE OR REPLACE FUNCTION public.user_transactions_sync_wallet()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_wallet TEXT;
BEGIN
  -- Only process if wallet_address is NULL or empty
  IF NEW.wallet_address IS NULL OR NEW.wallet_address = '' THEN
    -- Try to extract wallet from canonical_user_id
    IF NEW.canonical_user_id IS NOT NULL THEN
      -- If canonical_user_id follows prize:pid:0x... format, extract the wallet
      IF NEW.canonical_user_id LIKE 'prize:pid:0x%' THEN
        v_wallet := LOWER(SUBSTRING(NEW.canonical_user_id FROM 11));
        -- Validate it's a proper wallet address (0x followed by 40 hex chars)
        IF v_wallet ~ '^0x[a-f0-9]{40}$' THEN
          NEW.wallet_address := v_wallet;
        END IF;
      -- If canonical_user_id is already a wallet address (0x...), normalize and use it
      ELSIF NEW.canonical_user_id ~ '^0x[a-fA-F0-9]{40}$' THEN
        NEW.wallet_address := LOWER(NEW.canonical_user_id);
      END IF;
    END IF;
    
    -- If still no wallet_address, try from user_id
    IF (NEW.wallet_address IS NULL OR NEW.wallet_address = '') AND NEW.user_id IS NOT NULL THEN
      -- If user_id follows prize:pid:0x... format, extract the wallet
      IF NEW.user_id LIKE 'prize:pid:0x%' THEN
        v_wallet := LOWER(SUBSTRING(NEW.user_id FROM 11));
        IF v_wallet ~ '^0x[a-f0-9]{40}$' THEN
          NEW.wallet_address := v_wallet;
        END IF;
      -- If user_id is already a wallet address, normalize and use it
      ELSIF NEW.user_id ~ '^0x[a-fA-F0-9]{40}$' THEN
        NEW.wallet_address := LOWER(NEW.user_id);
      END IF;
    END IF;
  ELSE
    -- If wallet_address is NOT NULL but contains prize:pid:, fix it
    IF NEW.wallet_address LIKE 'prize:pid:0x%' THEN
      v_wallet := LOWER(SUBSTRING(NEW.wallet_address FROM 11));
      IF v_wallet ~ '^0x[a-f0-9]{40}$' THEN
        NEW.wallet_address := v_wallet;
      END IF;
    -- If wallet_address has mixed case, normalize to lowercase
    ELSIF NEW.wallet_address ~ '^0x[a-fA-F0-9]{40}$' THEN
      NEW.wallet_address := LOWER(NEW.wallet_address);
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Now fix existing data in user_transactions
-- Update all rows where wallet_address contains prize:pid:
UPDATE user_transactions
SET wallet_address = LOWER(SUBSTRING(wallet_address FROM 11))
WHERE wallet_address LIKE 'prize:pid:0x%'
  AND LENGTH(SUBSTRING(wallet_address FROM 11)) = 42
  AND SUBSTRING(wallet_address FROM 11) LIKE '0x%';

-- Normalize all wallet addresses to lowercase
UPDATE user_transactions
SET wallet_address = LOWER(wallet_address)
WHERE wallet_address ~ '^0x[a-fA-F0-9]{40}$'
  AND wallet_address != LOWER(wallet_address);

-- Add a comment explaining the fix
COMMENT ON FUNCTION public.user_transactions_sync_wallet IS 
'Ensures wallet_address contains only actual wallet addresses (0x...), never canonical_user_id format (prize:pid:...). Normalizes to lowercase.';
