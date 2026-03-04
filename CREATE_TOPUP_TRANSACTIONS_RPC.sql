-- ============================================================================
-- FIX: Create RPC to fetch user transactions with balance data
-- ============================================================================
-- The dashboard shows user_transactions but needs balance_before/after from balance_ledger

DROP FUNCTION IF EXISTS get_user_topup_transactions(TEXT) CASCADE;

CREATE OR REPLACE FUNCTION get_user_topup_transactions(p_user_identifier TEXT)
RETURNS TABLE (
  id UUID,
  user_id TEXT,
  canonical_user_id TEXT,
  amount NUMERIC,
  currency TEXT,
  payment_status TEXT,
  status TEXT,
  payment_provider TEXT,
  created_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  tx_id TEXT,
  wallet_address TEXT,
  balance_before NUMERIC,
  balance_after NUMERIC,
  type TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_canonical_id TEXT;
  v_wallet_lower TEXT;
BEGIN
  -- Normalize the user identifier
  v_canonical_id := CASE 
    WHEN p_user_identifier LIKE 'prize:pid:%' THEN p_user_identifier
    WHEN p_user_identifier LIKE '0x%' THEN 'prize:pid:' || LOWER(p_user_identifier)
    ELSE p_user_identifier
  END;
  
  v_wallet_lower := CASE 
    WHEN p_user_identifier LIKE '0x%' THEN LOWER(p_user_identifier)
    ELSE NULL
  END;

  RETURN QUERY
  SELECT 
    ut.id,
    ut.user_id,
    ut.canonical_user_id,
    ut.amount,
    ut.currency,
    ut.payment_status,
    ut.status,
    ut.payment_provider,
    ut.created_at,
    ut.completed_at,
    ut.tx_id,
    ut.wallet_address,
    bl.balance_before,
    bl.balance_after,
    ut.type
  FROM user_transactions ut
  LEFT JOIN balance_ledger bl ON (
    bl.reference_id = ut.webhook_ref
    OR bl.reference_id = ut.tx_id
    OR bl.reference_id = ut.charge_id
    OR bl.reference_id = ut.id::TEXT
  )
  WHERE ut.type = 'topup'
    AND ut.status IN ('pending', 'pending_payment', 'waiting', 'processing', 'finished', 'completed', 'confirmed', 'success')
    AND (
      ut.canonical_user_id = v_canonical_id
      OR ut.canonical_user_id = p_user_identifier
      OR (v_wallet_lower IS NOT NULL AND LOWER(ut.wallet_address) = v_wallet_lower)
      OR (v_wallet_lower IS NOT NULL AND LOWER(ut.user_id) = v_wallet_lower)
    )
  ORDER BY ut.created_at DESC
  LIMIT 50;
END;
$$;

GRANT EXECUTE ON FUNCTION get_user_topup_transactions(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_topup_transactions(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_user_topup_transactions(TEXT) TO service_role;

-- Test it
SELECT 'RPC function created successfully!' as status;
