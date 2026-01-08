/*
  # Add webhook_ref to get_user_transactions_bypass_rls RPC

  ## Problem
  The get_user_transactions_bypass_rls function has multiple issues:
  1. Missing webhook_ref field needed to identify top-up transactions
  2. Doesn't check canonical_user_id or wallet_address fields
  3. No case-insensitive matching for wallet addresses
  
  This causes top-up transactions and entries to not appear correctly in the 
  Orders dashboard, especially for users with wallet addresses stored in 
  different cases.

  ## Solution
  Update the RPC function to:
  - Include webhook_ref field in the return type
  - Check all user identifier fields (canonical_user_id, wallet_address, etc.)
  - Use LOWER() for case-insensitive wallet address matching
*/

-- Drop existing function to recreate with updated signature
DROP FUNCTION IF EXISTS get_user_transactions_bypass_rls(text);

-- Recreate get_user_transactions_bypass_rls with comprehensive matching
CREATE OR REPLACE FUNCTION get_user_transactions_bypass_rls(user_identifier text)
RETURNS TABLE (
  id uuid,
  user_id text,
  user_privy_id text,
  privy_user_id text,
  canonical_user_id text,
  wallet_address text,
  competition_id uuid,
  amount numeric,
  currency text,
  payment_status text,
  status text,
  ticket_count integer,
  created_at timestamp with time zone,
  completed_at timestamp with time zone,
  tx_id text,
  order_id text,
  payment_provider text,
  network text,
  webhook_ref text
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  lower_identifier text;
BEGIN
  -- Pre-compute lowercase identifier for case-insensitive wallet matching
  lower_identifier := LOWER(TRIM(user_identifier));

  RETURN QUERY
  SELECT
    ut.id,
    ut.user_id::text,
    ut.user_privy_id::text,
    COALESCE(ut.privy_user_id, ut.user_privy_id)::text as privy_user_id,
    ut.canonical_user_id::text,
    ut.wallet_address::text,
    ut.competition_id,
    ut.amount,
    ut.currency::text,
    ut.payment_status::text,
    ut.status::text,
    ut.ticket_count,
    ut.created_at::timestamptz,
    ut.completed_at::timestamptz,
    ut.tx_id::text,
    ut.order_id::text,
    ut.payment_provider::text,
    COALESCE(ut.network, ut.payment_provider, 'crypto')::text as network,
    ut.webhook_ref::text
  FROM user_transactions ut
  WHERE ut.user_id = user_identifier
     OR ut.user_privy_id = user_identifier
     OR ut.privy_user_id = user_identifier
     OR ut.canonical_user_id = user_identifier
     -- Case-insensitive wallet address matching
     OR LOWER(ut.wallet_address) = lower_identifier
     OR LOWER(ut.user_id) = lower_identifier
  ORDER BY ut.created_at DESC NULLS LAST;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_user_transactions_bypass_rls(text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_transactions_bypass_rls(text) TO anon;

-- Add helpful comment
COMMENT ON FUNCTION get_user_transactions_bypass_rls(text) IS
'Returns user transaction history bypassing RLS. Supports user_id, user_privy_id, privy_user_id, canonical_user_id, and wallet_address (case-insensitive). Includes webhook_ref for top-up detection.';

