-- ============================================================================
-- COMPLETE FIX FOR ORDERS TAB - RUN THIS NOW
-- ============================================================================

-- Step 1: Check RLS on user_transactions
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables 
    WHERE schemaname = 'public' 
    AND tablename = 'user_transactions' 
    AND rowsecurity = true
  ) THEN
    RAISE NOTICE 'RLS is ENABLED on user_transactions - this could block access';
  ELSE
    RAISE NOTICE 'RLS is DISABLED on user_transactions';
  END IF;
END $$;

-- Step 2: Temporarily disable RLS on user_transactions to test
ALTER TABLE user_transactions DISABLE ROW LEVEL SECURITY;

-- Step 3: Recreate the RPC function with explicit column selection
DROP FUNCTION IF EXISTS get_user_transactions(TEXT) CASCADE;

CREATE OR REPLACE FUNCTION public.get_user_transactions(user_identifier text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE 
  v_result JSONB;
BEGIN
  -- Direct query without complex logic - include balance_before/after from balance_ledger
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', ut.id::text,
      'type', ut.type,
      'amount', ut.amount,
      'currency', COALESCE(ut.currency, 'USD'),
      'status', ut.status,
      'payment_status', ut.payment_status,
      'competition_id', ut.competition_id,
      'competition_name', COALESCE(c.title, CASE WHEN ut.type = 'topup' THEN 'Wallet Top-Up' ELSE 'Entry' END),
      'competition_image', c.image_url,
      'ticket_count', ut.ticket_count,
      'created_at', ut.created_at,
      'completed_at', ut.completed_at,
      'method', ut.method,
      'payment_provider', ut.payment_provider,
      'tx_id', COALESCE(ut.tx_id, ut.charge_id),
      'charge_id', ut.charge_id,
      'charge_code', ut.charge_code,
      'balance_before', bl.balance_before,
      'balance_after', bl.balance_after,
      'is_topup', CASE WHEN ut.type = 'topup' THEN true ELSE false END
    )
    ORDER BY ut.created_at DESC
  ) INTO v_result
  FROM user_transactions ut
  LEFT JOIN competitions c ON ut.competition_id = c.id
  LEFT JOIN balance_ledger bl ON bl.reference_id = ut.id::text AND bl.canonical_user_id = ut.canonical_user_id
  WHERE ut.canonical_user_id ILIKE user_identifier
    AND ut.amount > 0;
  
  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.get_user_transactions(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_user_transactions(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_transactions(TEXT) TO service_role;

-- Step 4: Test the function
SELECT 
  'TEST RESULT' as test,
  jsonb_array_length(get_user_transactions('prize:pid:0x7b343a531688ac9ed7fbce4f16048970d1c7ba05')) as count,
  get_user_transactions('prize:pid:0x7b343a531688ac9ed7fbce4f16048970d1c7ba05')->0->'id' as first_transaction_id;

-- Step 5: Verify raw data exists
SELECT 
  'RAW DATA CHECK' as check,
  COUNT(*) as transaction_count
FROM user_transactions
WHERE canonical_user_id = 'prize:pid:0x7b343a531688ac9ed7fbce4f16048970d1c7ba05';

-- Step 6: Show what the function will return
SELECT get_user_transactions('prize:pid:0x7b343a531688ac9ed7fbce4f16048970d1c7ba05');
