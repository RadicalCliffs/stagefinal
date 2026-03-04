-- ============================================================================
-- UPDATE: Fix get_user_transactions to include balance_before/after from balance_ledger
-- ============================================================================
-- The dashboard shows "-" for Balance Before/After because these fields 
-- exist in balance_ledger, not user_transactions. This update fixes the JOIN.

DROP FUNCTION IF EXISTS get_user_transactions(TEXT) CASCADE;

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

  -- Build transactions combining user_transactions AND joincompetition data
  -- JOIN with balance_ledger to get balance_before/balance_after
  WITH all_entries AS (
    -- Source 1: user_transactions table
    -- JOIN with balance_ledger to get balance data
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
      ut.order_id::text as order_id,
      ut.webhook_ref,
      ut.metadata,
      -- Get balance_before/after from balance_ledger via JOIN
      COALESCE(bl.balance_before, ut.balance_before) as balance_before,
      COALESCE(bl.balance_after, ut.balance_after) as balance_after,
      c.title as competition_title,
      c.image_url as competition_image,
      'user_transactions' as source
    FROM user_transactions ut
    LEFT JOIN competitions c ON ut.competition_id = c.id
    -- JOIN with balance_ledger matching on multiple reference patterns
    LEFT JOIN LATERAL (
      SELECT 
        balance_before,
        balance_after,
        created_at
      FROM balance_ledger
      WHERE canonical_user_id = ut.canonical_user_id
        AND (
          -- Match by webhook_ref first (most reliable for topups)
          reference_id = ut.webhook_ref
          -- Match by tx_id
          OR reference_id = ut.tx_id
          -- Match by charge_id
          OR reference_id = ut.charge_id
          -- Match by transaction id (fallback)
          OR reference_id = ut.id::text
        )
      ORDER BY created_at DESC
      LIMIT 1
    ) bl ON true
    WHERE (ut.canonical_user_id = v_canonical_user_id 
       OR ut.user_id = user_identifier 
       OR ut.user_id = v_canonical_user_id
       OR (resolved_wallet IS NOT NULL AND LOWER(ut.wallet_address) = resolved_wallet))
      AND ut.amount > 0  -- Filter out negative balance deductions
      AND (ut.payment_provider IS NULL OR ut.payment_provider != 'balance')
      AND ut.type NOT IN ('ledger')
      -- Filter out fake "topup" entries that are actually purchases
      AND NOT (
        ut.type = 'topup' 
        AND (
          ut.ticket_count IS NOT NULL
          OR (ut.balance_before IS NOT NULL AND ut.balance_after IS NOT NULL AND ut.balance_after < ut.balance_before)
        )
      )
    
    UNION ALL
    
    -- Source 2: joincompetition table (for entries that didn't sync to user_transactions)
    SELECT 
      COALESCE(jc.transaction_hash, 'jc_' || jc.competition_id::text || '_' || EXTRACT(EPOCH FROM jc.created_at)::text) as id,
      'purchase' as type,
      jc.amount_spent as amount,
      'USD' as currency,
      'completed' as status,
      'completed' as payment_status,
      jc.competition_id as competition_id,
      jc.ticket_count as ticket_count,
      jc.created_at as created_at,
      jc.created_at as completed_at,
      NULL as method,
      COALESCE(jc.payment_provider, 'balance_payment') as payment_provider,
      jc.transaction_hash as tx_id,
      COALESCE(jc.transaction_hash, 'jc_' || jc.competition_id::text) as order_id,
      NULL as webhook_ref,
      NULL::jsonb as metadata,
      NULL::numeric as balance_before,
      NULL::numeric as balance_after,
      c.title as competition_title,
      c.image_url as competition_image,
      'joincompetition' as source
    FROM joincompetition jc
    LEFT JOIN competitions c ON jc.competition_id = c.id
    WHERE jc.canonical_user_id = v_canonical_user_id
       OR jc.user_id = user_identifier
       OR jc.user_id = v_canonical_user_id
       OR (resolved_wallet IS NOT NULL AND LOWER(jc.wallet_address) = resolved_wallet)
  ),
  deduplicated AS (
    SELECT DISTINCT ON (
      CASE 
        WHEN ae.competition_id IS NOT NULL THEN ae.competition_id::text
        WHEN ae.type IN ('topup', 'bonus_credit', 'deposit', 'refund') THEN 'topup_' || ae.amount::text
        ELSE ae.id
      END,
      DATE_TRUNC('minute', ae.created_at)
    )
      ae.*
    FROM all_entries ae
    ORDER BY 
      CASE 
        WHEN ae.competition_id IS NOT NULL THEN ae.competition_id::text
        WHEN ae.type IN ('topup', 'bonus_credit', 'deposit', 'refund') THEN 'topup_' || ae.amount::text
        ELSE ae.id
      END,
      DATE_TRUNC('minute', ae.created_at),
      ae.source ASC,
      CASE WHEN ae.type = 'bonus_credit' THEN 0 ELSE 1 END,
      ae.created_at DESC
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', d.id,
      'type', d.type,
      'amount', d.amount,
      'currency', d.currency,
      'status', d.status,
      'payment_status', d.payment_status,
      'competition_id', d.competition_id,
      'competition_name', CASE
        WHEN d.type IN ('topup', 'bonus_credit', 'deposit', 'refund') THEN 
          CASE 
            WHEN d.type = 'bonus_credit' THEN 'Bonus Credit'
            WHEN d.type = 'refund' THEN 'Refund'
            ELSE 'Wallet Top-Up'
          END
        ELSE COALESCE(d.competition_title, 'Competition Entry')
      END,
      'competition_image', d.competition_image,
      'ticket_count', d.ticket_count,
      'created_at', d.created_at,
      'completed_at', d.completed_at,
      'payment_method', d.method,
      'payment_provider', d.payment_provider,
      'tx_id', d.tx_id,
      'transaction_hash', d.tx_id,
      'order_id', d.order_id,
      'webhook_ref', d.webhook_ref,
      'metadata', d.metadata,
      'balance_before', d.balance_before,
      'balance_after', d.balance_after,
      'is_topup', (
        d.type IN ('topup', 'bonus_credit', 'deposit', 'refund')
        OR (d.competition_id IS NULL AND d.webhook_ref IS NOT NULL AND d.webhook_ref LIKE 'TOPUP_%')
      )
    )
    ORDER BY d.created_at DESC
  ) INTO v_transactions
  FROM deduplicated d;

  RETURN COALESCE(v_transactions, '[]'::jsonb);
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.get_user_transactions(text) TO anon, authenticated, service_role;

-- Success notification
DO $$
BEGIN
  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'get_user_transactions RPC UPDATED SUCCESSFULLY!';
  RAISE NOTICE 'Now includes balance_before/balance_after from balance_ledger';
  RAISE NOTICE '=====================================================';
END $$;
