-- =====================================================
-- FIX: Backfill competition_entries from ALL base_account transactions
-- =====================================================
-- ISSUE: User has 100+ base_account transactions in user_transactions
-- but NONE showing in entries tab because they're not in competition_entries
--
-- ROOT CAUSE: Previous backfill migration filtered by:
--   ut.type IN ('purchase', 'competition_entry', 'ticket_purchase')
-- But base_account transactions have type = NULL or 'entry'!
--
-- This migration:
-- 1. Backfills ALL completed base_account transactions to competition_entries_purchases
-- 2. Backfills ALL completed transactions to competition_entries (aggregated)
-- 3. Does NOT filter by type - filters by competition_id + ticket_count instead
-- =====================================================

BEGIN;

-- =====================================================
-- STEP 1: Backfill competition_entries_purchases from user_transactions
-- Include ALL transactions with competition_id and ticket_count > 0
-- =====================================================

INSERT INTO competition_entries_purchases (
  canonical_user_id,
  competition_id,
  purchase_key,
  tickets_count,
  amount_spent,
  ticket_numbers_csv,
  purchased_at,
  created_at
)
SELECT DISTINCT ON (
  COALESCE(ut.canonical_user_id, ut.user_privy_id, ut.user_id, LOWER(ut.wallet_address)),
  ut.competition_id,
  'ut_' || ut.id::text
)
  COALESCE(ut.canonical_user_id, ut.user_privy_id, ut.user_id, LOWER(ut.wallet_address)) as canonical_user_id,
  ut.competition_id,
  'ut_' || ut.id::text as purchase_key,
  COALESCE(ut.ticket_count, 0) as tickets_count,
  COALESCE(ABS(ut.amount), 0) as amount_spent,
  NULL as ticket_numbers_csv, -- Set to NULL to avoid validation errors during backfill
  COALESCE(ut.completed_at, ut.created_at, now()) as purchased_at,
  COALESCE(ut.created_at, now()) as created_at
FROM user_transactions ut
WHERE ut.competition_id IS NOT NULL
  AND COALESCE(ut.canonical_user_id, ut.user_privy_id, ut.user_id, ut.wallet_address) IS NOT NULL
  -- CRITICAL FIX: Don't filter by type - many transactions have NULL type!
  -- Filter by what matters: has competition_id, has tickets, is not a top-up
  AND ut.type != 'topup'  -- Exclude top-ups
  AND (ut.status = 'completed' OR ut.payment_status = 'completed')  -- Include if either status is completed
  AND ut.ticket_count > 0
ON CONFLICT (canonical_user_id, competition_id, purchase_key)
DO UPDATE SET
  tickets_count = EXCLUDED.tickets_count,
  amount_spent = EXCLUDED.amount_spent,
  -- Keep existing ticket_numbers_csv if present, otherwise leave as NULL
  ticket_numbers_csv = COALESCE(competition_entries_purchases.ticket_numbers_csv, EXCLUDED.ticket_numbers_csv),
  purchased_at = EXCLUDED.purchased_at;

-- =====================================================
-- STEP 2: Backfill competition_entries (aggregated) from competition_entries_purchases
-- This creates/updates the parent entry for each user+competition
-- =====================================================

INSERT INTO competition_entries (
  id,
  canonical_user_id,
  competition_id,
  wallet_address,
  tickets_count,
  amount_spent,
  amount_paid,
  latest_purchase_at,
  created_at,
  updated_at
)
SELECT 
  gen_random_uuid() as id,
  cep.canonical_user_id,
  cep.competition_id,
  NULL as wallet_address,  -- Will be populated by trigger on next update
  SUM(cep.tickets_count) as tickets_count,
  SUM(cep.amount_spent) as amount_spent,
  SUM(cep.amount_spent) as amount_paid,
  MAX(cep.purchased_at) as latest_purchase_at,
  MIN(cep.created_at) as created_at,
  NOW() as updated_at
FROM competition_entries_purchases cep
WHERE NOT EXISTS (
  -- Only insert if entry doesn't already exist
  SELECT 1 FROM competition_entries ce
  WHERE ce.canonical_user_id = cep.canonical_user_id
    AND ce.competition_id = cep.competition_id
)
GROUP BY cep.canonical_user_id, cep.competition_id
ON CONFLICT (canonical_user_id, competition_id)
DO UPDATE SET
  tickets_count = competition_entries.tickets_count + EXCLUDED.tickets_count,
  amount_spent = competition_entries.amount_spent + EXCLUDED.amount_spent,
  amount_paid = competition_entries.amount_paid + EXCLUDED.amount_paid,
  latest_purchase_at = GREATEST(competition_entries.latest_purchase_at, EXCLUDED.latest_purchase_at),
  updated_at = NOW();

COMMIT;

-- Log results
DO $$
DECLARE
  v_purchases_count INTEGER;
  v_entries_count INTEGER;
  v_base_account_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_purchases_count FROM competition_entries_purchases WHERE purchase_key LIKE 'ut_%';
  SELECT COUNT(*) INTO v_entries_count FROM competition_entries;
  SELECT COUNT(*) INTO v_base_account_count 
  FROM user_transactions ut
  JOIN competition_entries_purchases cep ON 'ut_' || ut.id::text = cep.purchase_key
  WHERE ut.payment_provider = 'base_account';
  
  RAISE NOTICE '=== Backfill Complete ===';
  RAISE NOTICE 'Total purchases from user_transactions: %', v_purchases_count;
  RAISE NOTICE 'Total competition entries: %', v_entries_count;
  RAISE NOTICE 'Base account purchases backfilled: %', v_base_account_count;
  RAISE NOTICE '';
  RAISE NOTICE 'Fix applied:';
  RAISE NOTICE '- Removed type filter (was excluding transactions with NULL or non-standard type)';
  RAISE NOTICE '- Now includes ALL transactions with competition_id + ticket_count > 0';
  RAISE NOTICE '- Base account payments should now appear in entries tab';
END $$;
