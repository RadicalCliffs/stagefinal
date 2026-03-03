-- Migration: Fix double amount in purchase_groups for balance payments
-- Problem: Balance payments create records in both tickets and joincompetition tables,
--          causing amounts to be counted twice in purchase_groups view
-- Solution: Deduplicate by purchase_key - if same purchase_key exists in both tables,
--           only count it once (prefer tickets table as source of truth)
-- Date: 2026-03-03

-- ============================================================================
-- FIX: Recreate purchase_events view with deduplication
-- ============================================================================

CREATE OR REPLACE VIEW public.purchase_events AS
WITH combined_events AS (
  -- Purchases from tickets table
  SELECT 
    t.uid::text AS source_row_id,
    'tickets'::text AS source_table,
    t.user_id,
    t.competition_id,
    t.cost AS amount,
    t.created_at AS occurred_at,
    t.purchase_key,
    1 AS priority  -- Higher priority for tickets
  FROM public.tickets t
  WHERE t.user_id IS NOT NULL 
    AND t.competition_id IS NOT NULL
    AND t.cost IS NOT NULL
    AND t.created_at IS NOT NULL

  UNION ALL

  -- Purchases from joincompetition table
  SELECT 
    jc.uid::text AS source_row_id,
    'joincompetition'::text AS source_table,
    jc.user_id,
    jc.competition_id,
    jc.cost AS amount,
    jc.created_at AS occurred_at,
    jc.purchase_key,
    2 AS priority  -- Lower priority for joincompetition
  FROM public.joincompetition jc
  WHERE jc.user_id IS NOT NULL 
    AND jc.competition_id IS NOT NULL
    AND jc.cost IS NOT NULL
    AND jc.created_at IS NOT NULL
),
deduplicated_events AS (
  -- For each purchase_key, only keep the highest priority record
  -- (tickets over joincompetition). If no purchase_key, keep all records.
  SELECT DISTINCT ON (
    user_id, 
    competition_id, 
    COALESCE(purchase_key, source_row_id),  -- Group by purchase_key OR source_row_id
    occurred_at
  )
    source_row_id,
    source_table,
    user_id,
    competition_id,
    amount,
    occurred_at,
    purchase_key
  FROM combined_events
  ORDER BY 
    user_id, 
    competition_id, 
    COALESCE(purchase_key, source_row_id),
    occurred_at,
    priority ASC  -- tickets (1) comes before joincompetition (2)
)
SELECT 
  source_row_id,
  source_table,
  user_id,
  competition_id,
  amount,
  occurred_at,
  purchase_key
FROM deduplicated_events;

COMMENT ON VIEW public.purchase_events IS 
'Unified view of all purchase events from tickets and joincompetition tables. Deduplicates by purchase_key to prevent double-counting balance payments. Each row represents a single purchase event with timestamp, amount, and source information.';

-- ============================================================================
-- Verification Query (run this after migration to check results)
-- ============================================================================

-- Uncomment to test:
-- SELECT 
--   purchase_key,
--   COUNT(*) as count,
--   SUM(amount) as total_amount,
--   STRING_AGG(DISTINCT source_table, ', ') as source_tables
-- FROM public.purchase_events
-- WHERE purchase_key IS NOT NULL
-- GROUP BY purchase_key
-- HAVING COUNT(*) > 1;
-- -- Should return 0 rows after this migration

-- ============================================================================
-- SUMMARY
-- ============================================================================
-- This migration fixes the double amount issue in purchase breakdowns by:
-- 1. Adding deduplication logic to purchase_events view
-- 2. Using DISTINCT ON with purchase_key to keep only one record per purchase
-- 3. Prioritizing tickets table over joincompetition table when both exist
-- 
-- The purchase_groups view automatically benefits from this fix since it
-- queries purchase_events.
-- ============================================================================
