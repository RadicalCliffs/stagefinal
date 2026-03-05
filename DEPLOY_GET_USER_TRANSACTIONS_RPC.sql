-- ============================================================================
-- DEPLOY UPDATED get_user_transactions RPC FUNCTION
-- ============================================================================
-- This ensures the RPC function checks canonical_user_id field
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_user_transactions(user_identifier text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE 
  v_transactions JSONB; 
  v_canonical_user_id TEXT; 
  search_wallet TEXT;
  resolved_wallet TEXT;
BEGIN
  -- Extract wallet from prize:pid: format
  IF user_identifier LIKE 'prize:pid:0x%' THEN 
    search_wallet := LOWER(SUBSTRING(user_identifier FROM 11));
  ELSIF user_identifier LIKE '0x%' THEN 
    search_wallet := LOWER(user_identifier); 
  END IF;

  -- Resolve canonical user ID and wallets
  SELECT cu.canonical_user_id, LOWER(COALESCE(cu.wallet_address, cu.base_wallet_address)) 
  INTO v_canonical_user_id, resolved_wallet
  FROM canonical_users cu
  WHERE cu.canonical_user_id = user_identifier 
     OR cu.uid = user_identifier
     OR (search_wallet IS NOT NULL AND LOWER(cu.wallet_address) = search_wallet)
     OR (search_wallet IS NOT NULL AND LOWER(cu.base_wallet_address) = search_wallet)
  LIMIT 1;
  
  -- Use search_wallet if we didn't find resolved_wallet
  resolved_wallet := COALESCE(resolved_wallet, search_wallet);

  -- Query user_transactions with canonical_user_id check
  WITH transactions_data AS (
    SELECT 
      ut.id::text as id,
      ut.type,
      ut.amount,
      ut.currency,
      ut.status,
      ut.payment_status,
      ut.competition_id,
      ut.ticket_count,
      ut.created_at,
      ut.completed_at,
      ut.method,
      ut.payment_provider,
      ut.tx_id,
      ut.charge_id,
      ut.charge_code,
      ut.order_id::text as order_id,
      ut.webhook_ref,
      ut.metadata,
      ut.balance_before,
      ut.balance_after,
      ut.canonical_user_id,
      ut.wallet_address,
      c.title as competition_title,
      c.image_url as competition_image,
      -- Determine if this is a topup (wallet credit) or purchase (competition entry)
      CASE 
        WHEN ut.type = 'topup' THEN true
        WHEN ut.competition_id IS NULL AND ut.ticket_count IS NULL THEN true
        ELSE false
      END as is_topup
    FROM user_transactions ut
    LEFT JOIN competitions c ON ut.competition_id = c.id
    WHERE (
      ut.canonical_user_id = v_canonical_user_id 
      OR ut.canonical_user_id = user_identifier
      OR ut.user_id = user_identifier 
      OR ut.user_id = v_canonical_user_id
      OR (resolved_wallet IS NOT NULL AND LOWER(ut.wallet_address) = resolved_wallet)
    )
    AND ut.amount > 0  -- Only show positive amounts (credits/purchases)
    ORDER BY ut.created_at DESC
  )
  SELECT jsonb_agg(row_to_json(transactions_data.*)) INTO v_transactions
  FROM transactions_data;
  
  RETURN COALESCE(v_transactions, '[]'::jsonb);
END;
$$;

-- Grant permissions
REVOKE ALL ON FUNCTION public.get_user_transactions(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_transactions(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_user_transactions(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_transactions(TEXT) TO service_role;

-- ============================================================================
-- TEST THE FUNCTION
-- ============================================================================
SELECT get_user_transactions('prize:pid:0x7b343a531688ac9ed7fbce4f16048970d1c7ba05');

-- ============================================================================
-- VERIFY TRANSACTIONS ARE VISIBLE
-- ============================================================================
SELECT 
  id,
  type,
  canonical_user_id,
  wallet_address,
  amount,
  status,
  payment_status,
  charge_id,
  created_at
FROM user_transactions
WHERE canonical_user_id = 'prize:pid:0x7b343a531688ac9ed7fbce4f16048970d1c7ba05'
ORDER BY created_at DESC;

DO $$ 
BEGIN
  RAISE NOTICE '✅ RPC FUNCTION DEPLOYED - get_user_transactions now checks canonical_user_id';
  RAISE NOTICE '✅ All topups should now appear in orders tab';
END $$;
