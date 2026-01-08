-- =====================================================
-- CREATE wallet_balances VIEW AND get_user_balance RPC
-- =====================================================
-- This migration creates a centralized balance view and RPC function
-- that reads balance from the proper source (privy_user_connections).
--
-- The purpose is to provide a single source of truth for balance lookups
-- rather than having each component query privy_user_connections directly.
--
-- Components should use:
-- - get_user_balance(p_canonical_user_id) - RPC for fetching balance
-- - wallet_balances table/view - for real-time subscriptions
--
-- This ensures consistent balance reads across all payment modals,
-- dashboard components, and backend functions.
-- =====================================================

-- Create wallet_balances view that provides a clean interface to user balances
-- This view extracts balance data from privy_user_connections
CREATE OR REPLACE VIEW public.wallet_balances AS
SELECT
  canonical_user_id,
  uid,
  id,
  wallet_address,
  base_wallet_address,
  COALESCE(usdc_balance, 0) AS balance,
  has_used_new_user_bonus,
  updated_at
FROM privy_user_connections
WHERE canonical_user_id IS NOT NULL;

-- Add comment for documentation
COMMENT ON VIEW public.wallet_balances IS 'Unified view of user wallet balances. Use get_user_balance RPC for lookups.';

-- Grant permissions on the view
GRANT SELECT ON public.wallet_balances TO authenticated;
GRANT SELECT ON public.wallet_balances TO anon;
GRANT SELECT ON public.wallet_balances TO service_role;

-- Create get_user_balance RPC function
-- This is the primary function that all components should use for balance lookups
DROP FUNCTION IF EXISTS get_user_balance(TEXT);

CREATE OR REPLACE FUNCTION get_user_balance(p_canonical_user_id TEXT)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_balance NUMERIC;
  search_wallet TEXT;
BEGIN
  -- Handle null or empty identifier
  IF p_canonical_user_id IS NULL OR p_canonical_user_id = '' THEN
    RETURN 0;
  END IF;

  -- Extract wallet address from prize:pid: format if present
  -- e.g., 'prize:pid:0x1234...' -> '0x1234...'
  IF p_canonical_user_id LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(p_canonical_user_id FROM 11));
  ELSIF p_canonical_user_id LIKE '0x%' AND LENGTH(p_canonical_user_id) = 42 THEN
    search_wallet := LOWER(p_canonical_user_id);
  ELSE
    search_wallet := NULL;
  END IF;

  -- Get balance from privy_user_connections using canonical_user_id as primary lookup
  -- with fallbacks for wallet address matching
  SELECT COALESCE(usdc_balance, 0) INTO user_balance
  FROM privy_user_connections
  WHERE
    -- Primary: Match by canonical_user_id
    canonical_user_id = p_canonical_user_id
    -- Case-insensitive canonical match
    OR canonical_user_id = LOWER(p_canonical_user_id)
    -- Wallet address extracted from prize:pid:
    OR (search_wallet IS NOT NULL AND LOWER(wallet_address) = search_wallet)
    -- Base wallet address
    OR (search_wallet IS NOT NULL AND LOWER(base_wallet_address) = search_wallet)
    -- Legacy: direct wallet address match
    OR LOWER(wallet_address) = LOWER(p_canonical_user_id)
    -- Legacy: privy_user_id match
    OR privy_user_id = p_canonical_user_id
  ORDER BY
    -- Prioritize exact canonical_user_id match
    CASE WHEN canonical_user_id = p_canonical_user_id THEN 0
         WHEN canonical_user_id = LOWER(p_canonical_user_id) THEN 1
         ELSE 2 END
  LIMIT 1;

  -- Return 0 if user not found
  RETURN COALESCE(user_balance, 0);
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_user_balance(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_balance(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_user_balance(TEXT) TO service_role;

-- Add comment for documentation
COMMENT ON FUNCTION get_user_balance(TEXT) IS 'Get user balance by canonical_user_id. Primary RPC for all balance lookups.';
