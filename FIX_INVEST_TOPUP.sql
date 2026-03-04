-- ============================================================================
-- FIX USER 'invest' TOPUP TRANSACTIONS
-- ============================================================================
-- Problem: User has 2 topup transactions with missing fields:
-- - canonical_user_id is NULL
-- - wallet_address is NULL
-- - No charge_id from Coinbase
-- - Status still 'pending'
-- - Not credited to balance
-- ============================================================================

DO $$ 
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'STEP 1: Inspect current state';
  RAISE NOTICE '========================================';
END $$;

-- Show the problematic transactions
SELECT 
  id,
  user_id,
  canonical_user_id,
  wallet_address,
  amount,
  status,
  payment_status,
  payment_provider,
  charge_id,
  posted_to_balance,
  created_at
FROM user_transactions
WHERE user_id = 'prize:pid:0x7b343a531688ac9ed7fbce4f16048970d1c7ba05'
  AND type = 'topup'
ORDER BY created_at DESC;

DO $$ 
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE 'Checking canonical_users...';
END $$;

SELECT canonical_user_id, username, wallet_address, email
FROM canonical_users
WHERE canonical_user_id = 'prize:pid:0x7b343a531688ac9ed7fbce4f16048970d1c7ba05'
   OR wallet_address ILIKE '%7b343a531688ac9ed7fbce4f16048970d1c7ba05%';

DO $$ 
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE 'Checking for matching webhook events...';
END $$;

SELECT 
  event_id,
  event_type,
  status,
  payload->'event'->'data'->'id' as charge_id,
  payload->'event'->'data'->'metadata'->'user_id' as metadata_user_id,
  payload->'event'->'data'->'pricing'->'local'->'amount' as amount,
  received_at
FROM payment_webhook_events
WHERE provider = 'coinbase_commerce'
  AND received_at > NOW() - INTERVAL '2 hours'
  AND (
    payload->'event'->'data'->'metadata'->>'user_id' ILIKE '%7b343a531688ac9ed7fbce4f16048970d1c7ba05%'
    OR payload->'event'->'data'->'pricing'->'local'->>'amount' = '3'
  )
ORDER BY received_at DESC;

DO $$ 
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'STEP 2: Check if payment was actually confirmed';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'If webhook shows charge:confirmed, proceed with fix.';
  RAISE NOTICE 'If still charge:pending, wait for payment confirmation.';
  RAISE NOTICE '';
  RAISE NOTICE 'MANUAL ACTION REQUIRED:';
  RAISE NOTICE '1. Check webhook events above';
  RAISE NOTICE '2. If payment confirmed, send the charge_id to proceed with fix';
END $$;

DO $$ 
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'DIAGNOSIS COMPLETE';
  RAISE NOTICE '========================================';
END $$;
