-- Migration: Fix Top-Up Classification to Use Type Field
-- Date: 2026-02-06
-- Issue: Competition entries purchased with base_account are incorrectly shown as top-ups
-- Root Cause: is_topup logic uses competition_id IS NULL, but should use type field
-- Fix: Change is_topup to check type = 'topup' instead of competition_id IS NULL

BEGIN;

-- Drop and recreate get_user_transactions function with correct is_topup logic
DROP FUNCTION IF EXISTS get_user_transactions(TEXT) CASCADE;

CREATE OR REPLACE FUNCTION public.get_user_transactions(user_identifier text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE 
  v_transactions JSONB; 
  v_canonical_user_id TEXT; 
  search_wallet TEXT;
BEGIN
  -- Extract wallet from prize:pid: format
  IF user_identifier LIKE 'prize:pid:0x%' THEN 
    search_wallet := LOWER(SUBSTRING(user_identifier FROM 11));
  ELSIF user_identifier LIKE '0x%' THEN 
    search_wallet := LOWER(user_identifier); 
  END IF;

  -- Resolve canonical user ID
  SELECT cu.canonical_user_id INTO v_canonical_user_id FROM canonical_users cu
  WHERE cu.canonical_user_id = user_identifier 
     OR cu.uid = user_identifier
     OR (search_wallet IS NOT NULL AND LOWER(cu.wallet_address) = search_wallet) 
  LIMIT 1;

  -- Build transactions with competition data enrichment
  -- FIXED: is_topup now checks type = 'topup' instead of competition_id IS NULL
  -- This prevents base_account entries from being misclassified as top-ups
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', ut.id,
      'type', ut.type,
      'amount', ut.amount,
      'currency', ut.currency,
      'status', ut.status,
      'payment_status', ut.payment_status,
      'competition_id', ut.competition_id,
      'competition_name', COALESCE(c.title, 'Unknown Competition'),
      'competition_image', c.image_url,
      'ticket_count', ut.ticket_count,
      'ticket_numbers', ut.ticket_numbers,
      'created_at', ut.created_at,
      'completed_at', ut.completed_at,
      'payment_method', ut.method,
      'payment_provider', ut.payment_provider,
      'tx_id', ut.tx_id,
      'transaction_hash', ut.transaction_hash,
      'order_id', ut.order_id,
      'webhook_ref', ut.webhook_ref,
      'metadata', ut.metadata,
      'balance_before', ut.balance_before,
      'balance_after', ut.balance_after,
      'is_topup', (ut.type = 'topup')
    ) 
    ORDER BY ut.created_at DESC
  ) INTO v_transactions
  FROM user_transactions ut
  LEFT JOIN competitions c ON ut.competition_id = c.id
  WHERE ut.user_id = user_identifier 
     OR ut.canonical_user_id = v_canonical_user_id 
     OR ut.user_id = v_canonical_user_id
     OR (search_wallet IS NOT NULL AND LOWER(ut.wallet_address) = search_wallet)
  LIMIT 100;

  -- Return array directly
  RETURN COALESCE(v_transactions, '[]'::jsonb);
END;
$function$;

COMMIT;

-- Log completion
DO $$
BEGIN
  RAISE NOTICE 'Migration complete: Fixed top-up classification';
  RAISE NOTICE '- is_topup now checks type = ''topup'' instead of competition_id IS NULL';
  RAISE NOTICE '- Base account entries will no longer be misclassified as top-ups';
END $$;
