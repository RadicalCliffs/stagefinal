-- Add smart_wallet_address column to canonical_users
-- This column stores the smart contract wallet address that may be used
-- for transactions, while wallet_address contains the parent/owner wallet.
-- This allows us to resolve smart contract addresses back to parent wallets
-- when processing webhooks and displaying entries/transactions.

BEGIN;

-- Add the column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'canonical_users' 
    AND column_name = 'smart_wallet_address'
  ) THEN
    ALTER TABLE public.canonical_users 
    ADD COLUMN smart_wallet_address TEXT;
    
    -- Add index for fast lookups when resolving smart wallet to parent wallet
    CREATE INDEX IF NOT EXISTS idx_canonical_users_smart_wallet 
      ON public.canonical_users(smart_wallet_address) 
      WHERE smart_wallet_address IS NOT NULL;
    
    -- Add comment explaining the column
    COMMENT ON COLUMN public.canonical_users.smart_wallet_address IS 
      'Smart contract wallet address used for transactions. Used to resolve smart contract addresses back to parent wallet_address.';
    
    RAISE NOTICE 'Added smart_wallet_address column to canonical_users';
  ELSE
    RAISE NOTICE 'smart_wallet_address column already exists in canonical_users';
  END IF;
END $$;

COMMIT;
