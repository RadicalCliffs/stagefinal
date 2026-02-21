-- HOTFIX: Fix Orders Tab - Deduplicate, Fix Categories, Include Missing Entries
-- Run in Supabase SQL Editor

-- ============================================================================
-- Step 1: Create an improved get_user_transactions function
-- - Deduplicates entries by grouping on competition_id + time window
-- - Properly categorizes bonus_credit as topups
-- - ALSO includes entries from joincompetition that may not be in user_transactions
-- - Returns clean, ordered results
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

  -- Build transactions combining user_transactions AND joincompetition data
  -- Deduplicate by competition_id + minute window
  WITH all_entries AS (
    -- Source 1: user_transactions table
    -- Filter out balance deduction entries (negative amounts with provider='balance')
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
      ut.balance_before,
      ut.balance_after,
      c.title as competition_title,
      c.image_url as competition_image,
      'user_transactions' as source
    FROM user_transactions ut
    LEFT JOIN competitions c ON ut.competition_id = c.id
    WHERE (ut.canonical_user_id = v_canonical_user_id 
       OR ut.user_id = user_identifier 
       OR ut.user_id = v_canonical_user_id
       OR (resolved_wallet IS NOT NULL AND LOWER(ut.wallet_address) = resolved_wallet))
      AND ut.amount > 0  -- Filter out negative balance deductions
      AND (ut.payment_provider IS NULL OR ut.payment_provider != 'balance')  -- Filter out balance deduction entries
      AND ut.type NOT IN ('ledger')  -- Filter out internal ledger entries
      -- Filter out fake "topup" entries that are actually purchases (have ticket_count or balance goes down)
      AND NOT (
        ut.type = 'topup' 
        AND (
          ut.ticket_count IS NOT NULL  -- Real topups don't have tickets
          OR (ut.balance_before IS NOT NULL AND ut.balance_after IS NOT NULL AND ut.balance_after < ut.balance_before)  -- Balance should go UP for topups
        )
      )
    
    UNION ALL
    
    -- Source 2: joincompetition table (for entries that didn't sync to user_transactions)
    -- Note: joincompetition uses snake_case column names
    -- Use transaction_hash as unique ID since uid is the user's ID, not entry ID
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
      -- For entries with competition_id, group by competition
      -- For topups/bonus_credit without competition_id, group by amount to catch duplicates
      CASE 
        WHEN ae.competition_id IS NOT NULL THEN ae.competition_id::text
        WHEN ae.type IN ('topup', 'bonus_credit', 'deposit', 'refund') THEN 'topup_' || ae.amount::text
        ELSE ae.id
      END,
      DATE_TRUNC('minute', ae.created_at)         -- Within same minute = likely duplicate
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
      ae.source ASC,  -- Prefer user_transactions over joincompetition
      CASE WHEN ae.type = 'bonus_credit' THEN 0 ELSE 1 END,  -- Prefer bonus_credit type over topup
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

-- ============================================================================
-- Step 2: Optional - Clean up existing duplicate user_transactions
-- This keeps only the newest transaction per competition+minute
-- Run this manually after verification
-- ============================================================================

-- View duplicates first (DRY RUN)
-- SELECT 
--   competition_id,
--   DATE_TRUNC('minute', created_at) as minute,
--   COUNT(*) as count,
--   ARRAY_AGG(id ORDER BY created_at DESC) as ids_to_check
-- FROM user_transactions
-- WHERE canonical_user_id = 'prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363'
-- GROUP BY competition_id, DATE_TRUNC('minute', created_at)
-- HAVING COUNT(*) > 1;

-- Delete duplicates (UNCOMMENT TO RUN)
-- WITH duplicates AS (
--   SELECT id,
--     ROW_NUMBER() OVER (
--       PARTITION BY competition_id, DATE_TRUNC('minute', created_at)
--       ORDER BY created_at DESC
--     ) as rn
--   FROM user_transactions
--   WHERE canonical_user_id = 'prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363'
-- )
-- DELETE FROM user_transactions
-- WHERE id IN (SELECT id FROM duplicates WHERE rn > 1);

-- ============================================================================
-- Step 3: Test the fix
-- ============================================================================

-- Test: Should return deduplicated transactions with proper categorization
SELECT * FROM get_user_transactions('prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363');
