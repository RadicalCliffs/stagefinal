/*
  # Fix User Transactions RPC Function

  ## Problem
  The get_user_transactions_bypass_rls function may not be returning all transactions
  because it needs to match on multiple user identifier fields and the completed_at field
  is missing from the return.

  ## Solution
  Recreate the function with:
  - Match on user_id, user_privy_id, AND privy_user_id fields
  - Include completed_at, order_id, and network fields
  - Proper null handling for optional fields
*/

-- Drop existing function to recreate with correct signature
DROP FUNCTION IF EXISTS get_user_transactions_bypass_rls(text);

-- Recreate get_user_transactions_bypass_rls with complete field set
CREATE OR REPLACE FUNCTION get_user_transactions_bypass_rls(user_identifier text)
RETURNS TABLE (
  id uuid,
  user_id text,
  user_privy_id text,
  privy_user_id text,
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
  network text
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ut.id,
    ut.user_id::text,
    ut.user_privy_id::text,
    COALESCE(ut.privy_user_id, ut.user_privy_id)::text as privy_user_id,
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
    COALESCE(ut.network, ut.payment_provider, 'crypto')::text as network
  FROM user_transactions ut
  WHERE ut.user_id = user_identifier
     OR ut.user_privy_id = user_identifier
     OR ut.privy_user_id = user_identifier
  ORDER BY ut.created_at DESC NULLS LAST;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_user_transactions_bypass_rls(text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_transactions_bypass_rls(text) TO anon;

-- Add helpful comment
COMMENT ON FUNCTION get_user_transactions_bypass_rls(text) IS
'Returns user transaction history bypassing RLS. Supports user_id, user_privy_id, or privy_user_id.';
