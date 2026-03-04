-- ============================================================================
-- FIX: Backfill missing canonical_user_id on user_transactions
-- ============================================================================
-- Extract canonical_user_id from webhook_ref and populate the field

-- Show how many are affected
SELECT 
  COUNT(*) as total_affected,
  COUNT(DISTINCT webhook_ref) as distinct_users
FROM user_transactions
WHERE type = 'topup'
  AND canonical_user_id IS NULL
  AND webhook_ref LIKE 'TOPUP_prize:pid:%';

-- Backfill canonical_user_id from webhook_ref
UPDATE user_transactions
SET canonical_user_id = regexp_replace(webhook_ref, '^TOPUP_(prize:pid:0x[a-f0-9]+)_.*$', '\1')
WHERE type = 'topup'
  AND canonical_user_id IS NULL
  AND webhook_ref LIKE 'TOPUP_prize:pid:%';

-- Verify the fix
SELECT 
  id,
  amount,
  canonical_user_id,
  webhook_ref,
  status,
  completed_at
FROM user_transactions
WHERE type = 'topup'
  AND canonical_user_id IS NOT NULL
  AND webhook_ref LIKE 'TOPUP_prize:pid:%'
ORDER BY created_at DESC
LIMIT 10;

-- Now update balance_ledger entries to have canonical_user_id too
UPDATE balance_ledger bl
SET canonical_user_id = ut.canonical_user_id
FROM user_transactions ut
WHERE bl.reference_id = ut.webhook_ref
  AND bl.canonical_user_id IS NULL
  AND ut.canonical_user_id IS NOT NULL
  AND ut.type = 'topup';

SELECT 'Backfill complete!' as status;
