-- ============================================================================
-- FIX: Make Highblock & Luxe Topups Visible in Dashboard
-- ============================================================================
-- Issue: Topups are credited but not showing in dashboard top-up section
-- Root Cause: Transaction records missing required fields for dashboard query
--
-- The get_user_topup_transactions RPC requires:
--   1. type = 'topup'  
--   2. status in valid list
--   3. canonical_user_id set correctly
--   4. Either posted_to_balance=true OR balance_ledger entry exists
-- ============================================================================

DO $$
DECLARE
  v_highblock_user TEXT := 'prize:pid:0x543e8fb59312a2578f70152c79eae169e4f8fe9e';
  v_highblock_tx UUID := 'b1b7a840-142e-40e0-aef1-aab2c157697a';
  v_highblock_wallet TEXT := '0x543e8fb59312a2578f70152c79eae169e4f8fe9e';
  v_highblock_user_id UUID := '28241e09-753e-43a4-83d5-0169f9b92ec3';
  
  v_luxe_user TEXT := 'prize:pid:0xc469777462c1769b918a299a89c1d5eeaa4d5ee3';
  v_luxe_tx UUID := 'ca16d095-d855-4cc1-a866-557741347a65';
  v_luxe_wallet TEXT := '0xc469777462c1769b918a299a89c1d5eeaa4d5ee3';
  v_luxe_user_id UUID := 'd75e48de-2da5-4f5d-8eaa-1a2b3c25735c';
BEGIN
  RAISE NOTICE '════════════════════════════════════════════════════════════════';
  RAISE NOTICE 'FIXING TOPUP DASHBOARD VISIBILITY';
  RAISE NOTICE '════════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  
  -- ============================================================================
  -- HIGHBLOCK: Ensure transaction visible in dashboard
  -- ============================================================================
  RAISE NOTICE '1. Fixing Highblock topup visibility...';
  
  UPDATE user_transactions
  SET 
    type = 'topup',
    canonical_user_id = v_highblock_user,
    user_id = v_highblock_user_id::text,
    wallet_address = v_highblock_wallet,
    status = 'completed',
    payment_status = 'confirmed',
    posted_to_balance = true,
    updated_at = NOW()
  WHERE id = v_highblock_tx;
  
  IF FOUND THEN
    RAISE NOTICE '   ✅ Highblock transaction updated for dashboard visibility';
  ELSE
    RAISE NOTICE '   ⚠️  Highblock transaction not found (ID: %)', v_highblock_tx;
  END IF;
  
  RAISE NOTICE '';
  
  -- ============================================================================
  -- LUXE: Ensure transaction visible in dashboard
  -- ============================================================================
  RAISE NOTICE '2. Fixing Luxe topup visibility...';
  
  UPDATE user_transactions
  SET 
    type = 'topup',
    canonical_user_id = v_luxe_user,
    user_id = v_luxe_user_id::text,
    wallet_address = v_luxe_wallet,
    status = 'completed',
    payment_status = 'confirmed',
    posted_to_balance = true,
    updated_at = NOW()
  WHERE id = v_luxe_tx;
  
  IF FOUND THEN
    RAISE NOTICE '   ✅ Luxe transaction updated for dashboard visibility';
  ELSE
    RAISE NOTICE '   ⚠️  Luxe transaction not found (ID: %)', v_luxe_tx;
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════════════';
  RAISE NOTICE 'FIX COMPLETE';
  RAISE NOTICE '════════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Transactions should now appear in:';
  RAISE NOTICE '  - Dashboard Top-Up section';
  RAISE NOTICE '  - Wallet Management recent top-ups';
  RAISE NOTICE '  - Orders tab (with "Top up" label)';
  RAISE NOTICE '';
  RAISE NOTICE 'The get_user_topup_transactions RPC will now return these records.';
  RAISE NOTICE '';
END $$;
