-- ============================================================================
-- FIX COMMERCE WEBHOOK IDEMPOTENCY BUG
-- ============================================================================
-- Root Cause: The commerce-webhook checks transaction.status to determine if
-- a topup was already credited, but this is WRONG. The status field comes from
-- the payment provider (e.g., "finished" from Coinbase), but doesn't mean OUR
-- system has credited the balance.
--
-- Bug Location: supabase/functions/commerce-webhook/index.ts:935-945
--
-- The Fix: Remove status check from idempotency logic. Only check:
--   - posted_to_balance (did we post to balance_ledger?)
--   - wallet_credited (did we credit sub_account_balances?)
--
-- This is a CODE FIX, not a SQL migration. Apply to commerce-webhook/index.ts:
-- ============================================================================

/*

BEFORE (BUGGY CODE):

const alreadyCredited =
  transaction.posted_to_balance === true ||
  transaction.wallet_credited === true ||
  (transaction.status &&
    ["completed", "finished", "confirmed", "success"].includes(
      transaction.status.toLowerCase(),
    ));

if (alreadyCredited) {
  console.log(
    `[commerce-webhook][${requestId}] ⚠️ Top-up already credited ...`
  );
}


AFTER (FIXED CODE):

// CORRECT IDEMPOTENCY CHECK - Only trust OUR flags, not payment provider status
const alreadyCredited =
  transaction.posted_to_balance === true ||
  transaction.wallet_credited === true;

// IMPORTANT: We do NOT check transaction.status here because:
// - status="finished" means payment provider confirms payment
// - But it does NOT mean our system has credited the user's balance
// - Only posted_to_balance and wallet_credited indicate successful credit

if (alreadyCredited) {
  console.log(
    `[commerce-webhook][${requestId}] ⚠️ Top-up already credited (posted_to_balance=${transaction.posted_to_balance}, wallet_credited=${transaction.wallet_credited}), skipping balance update`,
  );
}

*/

-- ============================================================================
-- INSTRUCTIONS FOR DEVELOPER
-- ============================================================================
-- 1. Open: supabase/functions/commerce-webhook/index.ts
-- 2. Find line ~935-945 (search for "BULLETPROOF IDEMPOTENCY")
-- 3. Replace the alreadyCredited check with the FIXED CODE above
-- 4. Deploy: supabase functions deploy commerce-webhook
-- 5. Test: Make a $3 topup and verify it credits correctly
-- ============================================================================
--
-- EXPLANATION:
-- The bug caused "finished" payments to be skipped even though posted_to_balance=false.
-- This means the payment was confirmed by Coinbase, but our system never credited
-- the user's balance. The webhook thought it was already done (because status="finished"),
-- so it skipped the credit logic entirely.
--
-- With the fix, the webhook will:
-- - Only skip if posted_to_balance=true OR wallet_credited=true
-- - Process "finished" payments that have posted_to_balance=false
-- - Properly credit the balance and set the flags
-- ============================================================================

SELECT 'This is a documentation file - apply the code fix to commerce-webhook/index.ts' AS instruction;
