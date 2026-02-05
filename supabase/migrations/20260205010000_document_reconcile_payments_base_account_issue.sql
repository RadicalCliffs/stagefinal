-- =====================================================
-- FIX RECONCILE-PAYMENTS TO NEVER CREDIT BASE_ACCOUNT
-- =====================================================
-- 
-- CRITICAL FIX: base_account entry purchases are being credited to user balance
-- by the reconcile-payments function, treating them as top-ups.
--
-- Root Cause: reconcile-payments queries for unconfirmed top-ups but doesn't
-- filter out base_account payment_provider. If a base_account transaction has:
-- - competition_id = null (shouldn't happen but might)
-- - wallet_credited = false/null
-- - payment_status = confirmed/completed
--
-- Then it gets processed as a top-up and credits the balance!
--
-- Solution: Add explicit payment_provider filter to EXCLUDE all external crypto
-- payment methods from reconciliation top-up processing.
--
-- Date: 2026-02-05
-- =====================================================

BEGIN;

-- No SQL changes needed - the fix is in the Edge Function
-- This migration serves as documentation of the issue

-- Document the issue for future reference
COMMENT ON TABLE user_transactions IS 
'User payment transactions.

CRITICAL: External crypto payments (base_account, coinbase_commerce, etc.) 
should NEVER have their balance credited by reconcile-payments function.

These payment methods mean user paid externally (on-chain or via gateway):
- base_account: Base Account SDK (on-chain USDC)
- coinbase_commerce: Coinbase Commerce
- coinbase: Coinbase Pay
- privy_base_wallet: Privy wallet
- onchainkit: OnchainKit payments
- onchainkit_checkout: OnchainKit checkout

Only these should be processed by reconcile-payments for balance crediting:
- payment_provider = onramp OR coinbase_onramp (Coinbase Onramp top-ups)
- payment_provider = balance is NOT credited (already in their balance)

The reconcile-payments Edge Function MUST filter by payment_provider to exclude
external crypto payments from top-up reconciliation.';

COMMIT;

-- Log completion
DO $$
BEGIN
  RAISE NOTICE 'Migration complete: Documentation added for reconcile-payments base_account issue';
  RAISE NOTICE '- Edge Function fix required in supabase/functions/reconcile-payments/index.ts';
  RAISE NOTICE '- Must add payment_provider filter to exclude base_account from top-up reconciliation';
END $$;
