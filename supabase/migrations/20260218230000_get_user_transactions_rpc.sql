-- Create get_user_transactions RPC function
-- This function retrieves all transactions for a user including competition entries and wallet top-ups
-- It enriches the data with competition details and handles multiple user identifier formats

CREATE OR REPLACE FUNCTION public.get_user_transactions(user_identifier TEXT)
RETURNS TABLE (
  id UUID,
  user_id TEXT,
  canonical_user_id TEXT,
  wallet_address TEXT,
  type TEXT,
  amount NUMERIC,
  currency TEXT,
  status TEXT,
  payment_status TEXT,
  competition_id TEXT,
  competition_name TEXT,
  competition_image TEXT,
  ticket_count INTEGER,
  ticket_numbers TEXT,
  created_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  payment_method TEXT,
  payment_provider TEXT,
  tx_id TEXT,
  tx_ref TEXT,
  order_id TEXT,
  webhook_ref TEXT,
  metadata JSONB,
  balance_before NUMERIC,
  balance_after NUMERIC,
  transaction_hash TEXT,
  is_topup BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_canonical_id TEXT;
  v_wallet TEXT;
BEGIN
  -- Normalize the user identifier
  -- Handle prize:pid: format
  IF user_identifier LIKE 'prize:pid:%' THEN
    v_canonical_id := user_identifier;
    v_wallet := LOWER(REPLACE(user_identifier, 'prize:pid:', ''));
  -- Handle plain wallet address
  ELSIF user_identifier LIKE '0x%' THEN
    v_wallet := LOWER(user_identifier);
    v_canonical_id := 'prize:pid:' || v_wallet;
  ELSE
    -- Handle other formats (privy, UUID, etc)
    v_canonical_id := user_identifier;
    v_wallet := user_identifier;
  END IF;

  RETURN QUERY
  SELECT 
    t.id,
    t.user_id,
    t.canonical_user_id,
    t.wallet_address,
    t.type,
    t.amount,
    t.currency,
    t.status,
    t.payment_status,
    t.competition_id,
    COALESCE(c.title, CASE WHEN t.type = 'topup' THEN 'Wallet Top-Up' ELSE 'Unknown Competition' END) AS competition_name,
    c.image_url AS competition_image,
    t.ticket_count,
    t.ticket_numbers,
    t.created_at,
    t.completed_at,
    t.payment_method,
    t.payment_provider,
    t.tx_id,
    t.tx_ref,
    t.order_id,
    t.webhook_ref,
    t.metadata,
    t.balance_before,
    t.balance_after,
    t.transaction_hash,
    -- Determine if this is a top-up based on type field
    CASE WHEN t.type = 'topup' THEN TRUE ELSE FALSE END AS is_topup
  FROM public.user_transactions t
  LEFT JOIN public.competitions c ON t.competition_id = c.id
  WHERE 
    -- Match any of the user identifier formats
    t.user_id = user_identifier
    OR t.canonical_user_id = v_canonical_id
    OR LOWER(t.wallet_address) = v_wallet
    OR t.user_id = v_canonical_id
    OR t.canonical_user_id = user_identifier
  ORDER BY t.created_at DESC
  LIMIT 100;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.get_user_transactions(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_transactions(TEXT) TO anon;

-- Add comment
COMMENT ON FUNCTION public.get_user_transactions(TEXT) IS 
'Retrieves all transactions for a user including competition entries, balance payments, and wallet top-ups. 
Enriches data with competition details. Returns up to 100 most recent transactions.';
