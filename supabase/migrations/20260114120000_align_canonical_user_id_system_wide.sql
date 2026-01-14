-- ============================================================================
-- CANONICAL USER ID SYSTEM-WIDE ALIGNMENT
-- ============================================================================
-- This migration ensures canonical_user_id (in prize:pid:xxx format) is the
-- primary user identifier across ALL tables, removing dependency on privy_user_id
-- and ensuring consistency with the canonical_users table.
--
-- Changes:
-- 1. Add canonical_user_id to canonical_users table if not exists
-- 2. Add canonical_user_id to tickets table
-- 3. Add canonical_user_id to competition_entries table  
-- 4. Add canonical_user_id to user_transactions table
-- 5. Add canonical_user_id to sub_account_balances table
-- 6. Backfill canonical_user_id values from wallet addresses
-- 7. Update all RPC functions to use canonical_user_id
-- 8. Add indexes for performance
-- ============================================================================

-- Step 1: Add canonical_user_id to canonical_users if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'canonical_users' 
    AND column_name = 'canonical_user_id'
  ) THEN
    ALTER TABLE public.canonical_users 
    ADD COLUMN canonical_user_id TEXT UNIQUE;
    
    COMMENT ON COLUMN public.canonical_users.canonical_user_id IS 
      'Canonical user ID in prize:pid:xxx format - THE primary user identifier';
  END IF;
END $$;

-- Step 2: Backfill canonical_user_id in canonical_users from wallet addresses
-- Format: prize:pid:<lowercase_wallet_address>
UPDATE public.canonical_users
SET canonical_user_id = 'prize:pid:' || LOWER(COALESCE(
  wallet_address,
  base_wallet_address,
  eth_wallet_address,
  id
))
WHERE canonical_user_id IS NULL
  AND (wallet_address IS NOT NULL OR base_wallet_address IS NOT NULL OR eth_wallet_address IS NOT NULL);

-- Create index on canonical_user_id for fast lookups
CREATE INDEX IF NOT EXISTS idx_canonical_users_canonical_user_id 
ON public.canonical_users(canonical_user_id);

-- Step 3: Add canonical_user_id to tickets table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'tickets' 
    AND column_name = 'canonical_user_id'
  ) THEN
    ALTER TABLE public.tickets 
    ADD COLUMN canonical_user_id TEXT;
    
    COMMENT ON COLUMN public.tickets.canonical_user_id IS 
      'Canonical user ID in prize:pid:xxx format for consistent user identification';
  END IF;
END $$;

-- Backfill canonical_user_id in tickets from user_id (which contains wallet addresses)
UPDATE public.tickets t
SET canonical_user_id = 'prize:pid:' || LOWER(t.user_id)
WHERE t.canonical_user_id IS NULL
  AND t.user_id IS NOT NULL
  AND t.user_id LIKE '0x%';

-- Create index on tickets canonical_user_id
CREATE INDEX IF NOT EXISTS idx_tickets_canonical_user_id 
ON public.tickets(canonical_user_id);

-- Step 4: Add canonical_user_id to joincompetition (competition_entries)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'joincompetition' 
    AND column_name = 'canonical_user_id'
  ) THEN
    ALTER TABLE public.joincompetition 
    ADD COLUMN canonical_user_id TEXT;
    
    COMMENT ON COLUMN public.joincompetition.canonical_user_id IS 
      'Canonical user ID in prize:pid:xxx format for consistent user identification';
  END IF;
END $$;

-- Backfill canonical_user_id in joincompetition from walletaddress
UPDATE public.joincompetition jc
SET canonical_user_id = 'prize:pid:' || LOWER(jc.walletaddress)
WHERE jc.canonical_user_id IS NULL
  AND jc.walletaddress IS NOT NULL
  AND jc.walletaddress LIKE '0x%';

-- Create index on joincompetition canonical_user_id
CREATE INDEX IF NOT EXISTS idx_joincompetition_canonical_user_id 
ON public.joincompetition(canonical_user_id);

-- Step 5: Ensure user_transactions has canonical_user_id (should already exist from migration 20260105)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'user_transactions' 
    AND column_name = 'canonical_user_id'
  ) THEN
    ALTER TABLE public.user_transactions 
    ADD COLUMN canonical_user_id TEXT;
    
    COMMENT ON COLUMN public.user_transactions.canonical_user_id IS 
      'Canonical user ID in prize:pid:xxx format for consistent user identification';
  END IF;
END $$;

-- Backfill canonical_user_id in user_transactions from wallet_address
UPDATE public.user_transactions ut
SET canonical_user_id = 'prize:pid:' || LOWER(ut.wallet_address)
WHERE ut.canonical_user_id IS NULL
  AND ut.wallet_address IS NOT NULL
  AND ut.wallet_address LIKE '0x%';

-- Create index on user_transactions canonical_user_id if not exists
CREATE INDEX IF NOT EXISTS idx_user_transactions_canonical_user_id 
ON public.user_transactions(canonical_user_id);

-- Step 6: Ensure sub_account_balances uses canonical_user_id properly
-- The user_id in sub_account_balances should reference canonical_user_id
COMMENT ON COLUMN public.sub_account_balances.user_id IS 
  'User identifier - should reference canonical_users.canonical_user_id';

-- Create index on sub_account_balances user_id for lookups
CREATE INDEX IF NOT EXISTS idx_sub_account_balances_user_id 
ON public.sub_account_balances(user_id);

-- Step 7: Update get_user_active_tickets RPC to use canonical_user_id
CREATE OR REPLACE FUNCTION public.get_user_active_tickets(user_identifier TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  ticket_count INTEGER;
BEGIN
  -- Count tickets from joincompetition using canonical_user_id
  SELECT COUNT(DISTINCT jc.id)::INTEGER INTO ticket_count
  FROM public.joincompetition jc
  LEFT JOIN public.competitions c ON jc.competitionid = c.id
  WHERE (
    -- Match by canonical_user_id
    jc.canonical_user_id = user_identifier
    -- Match by wallet address (case-insensitive)
    OR LOWER(jc.walletaddress) = LOWER(user_identifier)
    -- Match by privy_user_id (legacy, case-insensitive for wallet addresses)
    OR jc.privy_user_id = user_identifier
    OR LOWER(jc.privy_user_id) = LOWER(user_identifier)
  )
  AND COALESCE(c.status, 'active') IN ('active', 'drawing');
  
  RETURN COALESCE(ticket_count, 0);
END;
$$;

-- Step 8: Update get_user_wallet_balance RPC to use canonical_user_id and USD balance
CREATE OR REPLACE FUNCTION public.get_user_wallet_balance(user_identifier TEXT)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  balance NUMERIC;
  lower_identifier TEXT;
BEGIN
  lower_identifier := LOWER(user_identifier);
  
  -- Get USD balance from sub_account_balances (NOT usdc_balance from canonical_users)
  SELECT COALESCE(sab.available_balance, 0) INTO balance
  FROM public.sub_account_balances sab
  WHERE sab.currency = 'USD'
    AND (
      -- Match by user_id (should be canonical_user_id)
      sab.user_id = user_identifier
      -- Match by lowercase wallet address
      OR LOWER(sab.user_id) = lower_identifier
    );
  
  -- If not found in sub_account_balances, return 0
  RETURN COALESCE(balance, 0);
END;
$$;

-- Step 9: Create helper function to resolve canonical_user_id from any identifier
CREATE OR REPLACE FUNCTION public.resolve_canonical_user_id(user_identifier TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  canonical_id TEXT;
  lower_identifier TEXT;
BEGIN
  lower_identifier := LOWER(user_identifier);
  
  -- Try to find user by various identifiers and return their canonical_user_id
  SELECT cu.canonical_user_id INTO canonical_id
  FROM public.canonical_users cu
  WHERE cu.canonical_user_id = user_identifier
     OR LOWER(cu.wallet_address) = lower_identifier
     OR LOWER(cu.base_wallet_address) = lower_identifier
     OR LOWER(cu.eth_wallet_address) = lower_identifier
     OR cu.privy_user_id = user_identifier
     OR cu.uid = user_identifier
  LIMIT 1;
  
  -- If found, return the canonical_user_id
  IF canonical_id IS NOT NULL THEN
    RETURN canonical_id;
  END IF;
  
  -- If not found but identifier looks like a wallet address, generate canonical format
  IF user_identifier LIKE '0x%' AND LENGTH(user_identifier) = 42 THEN
    RETURN 'prize:pid:' || lower_identifier;
  END IF;
  
  -- Otherwise return the identifier as-is (could be a prize:pid: already)
  RETURN user_identifier;
END;
$$;

COMMENT ON FUNCTION public.resolve_canonical_user_id IS 
  'Resolves any user identifier (wallet, privy_user_id, uid) to canonical_user_id format';

-- Step 10: Grant necessary permissions
GRANT EXECUTE ON FUNCTION public.get_user_active_tickets TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_user_wallet_balance TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.resolve_canonical_user_id TO authenticated, anon;
