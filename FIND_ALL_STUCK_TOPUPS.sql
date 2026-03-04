-- ============================================================================
-- FIND ALL STUCK TOPUPS
-- ============================================================================
-- This query identifies ALL topups that have confirmed payments but were
-- never credited to user balances due to the commerce-webhook idempotency bug.
--
-- Run this to check if there are more affected users beyond Highblock & Luxe.
-- ============================================================================

SELECT 
  ut.id AS transaction_id,
  ut.canonical_user_id,
  ut.user_id,
  cu.wallet_address,
  ut.amount,
  ut.status,
  ut.payment_status,
  ut.posted_to_balance,
  ut.created_at,
  ut.updated_at,
  -- Check if there's a matching balance_ledger entry
  (SELECT COUNT(*) 
   FROM balance_ledger bl 
   WHERE bl.canonical_user_id = ut.canonical_user_id
     AND (bl.reference_id = ('TOPUP_' || ut.canonical_user_id || '_' || ut.id)
          OR bl.reference_id = ut.charge_id
          OR bl.reference_id = ut.id::text)
  ) AS ledger_entries,
  -- Calculate expected reference_id
  'TOPUP_' || ut.canonical_user_id || '_' || ut.id AS expected_reference_id
FROM user_transactions ut
LEFT JOIN canonical_users cu ON ut.canonical_user_id = cu.canonical_user_id
WHERE ut.type = 'topup'
  AND ut.payment_status = 'confirmed'  -- Payment confirmed by Coinbase
  AND ut.posted_to_balance IS NOT TRUE -- But never posted to balance
ORDER BY ut.created_at DESC;

-- ============================================================================
-- INTERPRETATION
-- ============================================================================
-- If ledger_entries = 0 AND posted_to_balance = false:
--   ❌ STUCK - Payment taken but never credited
--
-- If ledger_entries > 0 AND posted_to_balance = false:
--   ⚠️  INCONSISTENT - Balance was credited but flag not set (minor issue)
--
-- If ledger_entries = 0 AND posted_to_balance = true:
--   ⚠️  CORRUPTED - Flag says credited but no ledger entry (major issue)
-- ============================================================================

-- Next steps if you find more stuck topups:
-- 1. Note the transaction_id and canonical_user_id for each
-- 2. Request a generic recovery script to fix ALL stuck topups at once
-- 3. Or manually add them to FIX_STUCK_TOPUPS.sql following the pattern
