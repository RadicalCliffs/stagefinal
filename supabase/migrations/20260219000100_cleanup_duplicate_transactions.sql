-- Clean Up Duplicate user_transactions Entries
-- This migration removes duplicate user_transactions that were created by
-- multiple triggers firing for the same event.
--
-- Strategy:
-- 1. Identify duplicates by matching: user_id + competition_id + amount + created_at
-- 2. Keep the FIRST created entry (lowest id)
-- 3. Delete the duplicates
-- 4. Update remaining entries to have correct payment_provider

-- ============================================================================
-- Step 1: Delete duplicate user_transactions
-- Keep only the first (oldest by id) for each unique transaction
-- ============================================================================

WITH duplicates AS (
  SELECT 
    id,
    ROW_NUMBER() OVER (
      PARTITION BY 
        canonical_user_id, 
        competition_id, 
        amount, 
        DATE_TRUNC('second', created_at)  -- Group by second to catch near-simultaneous inserts
      ORDER BY id ASC  -- Keep the first one created
    ) as row_num
  FROM public.user_transactions
  WHERE created_at > NOW() - INTERVAL '30 days'  -- Only clean up recent entries
)
DELETE FROM public.user_transactions
WHERE id IN (
  SELECT id FROM duplicates WHERE row_num > 1
);

-- ============================================================================
-- Step 2: Fix payment_provider for existing balance payments
-- Update entries that should be balance_payment but show as base_account or NULL
-- ============================================================================

-- Fix entries with balance_before/balance_after (clear indicator of balance payment)
UPDATE public.user_transactions
SET payment_provider = 'balance_payment'
WHERE payment_provider IS NULL
  AND balance_before IS NOT NULL
  AND balance_after IS NOT NULL
  AND type IN ('purchase', 'entry', 'bonus_credit');

-- Fix entries from joincompetition that aren't base_account payments
UPDATE public.user_transactions ut
SET payment_provider = 'balance_payment'
FROM public.joincompetition jc
WHERE ut.order_id = jc.uid::TEXT
  AND (jc.payment_provider IS NULL OR jc.payment_provider != 'base_account')
  AND (ut.payment_provider IS NULL OR ut.payment_provider = 'unknown')
  AND ut.type = 'purchase';

-- ============================================================================
-- Step 3: Add index to prevent future duplicate lookups
-- This helps the trigger idempotency checks run faster
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_user_transactions_tx_id 
  ON public.user_transactions(tx_id) 
  WHERE tx_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_transactions_order_id 
  ON public.user_transactions(order_id) 
  WHERE order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_transactions_dedup 
  ON public.user_transactions(canonical_user_id, competition_id, amount, created_at);

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON INDEX idx_user_transactions_tx_id IS 
'Speeds up idempotency checks in triggers by tx_id';

COMMENT ON INDEX idx_user_transactions_order_id IS 
'Speeds up idempotency checks in triggers by order_id';

COMMENT ON INDEX idx_user_transactions_dedup IS 
'Helps identify and prevent duplicate transactions';
