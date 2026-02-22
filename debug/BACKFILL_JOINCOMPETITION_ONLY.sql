-- ==============================================================================
-- SIMPLE BACKFILL: Just create missing joincompetition entries from today
-- Run this first - no trigger modification to avoid deadlocks
-- ==============================================================================

-- Just backfill today's confirmed tickets that don't have joincompetition entries
INSERT INTO public.joincompetition (
  id, user_id, competition_id, ticket_numbers, purchase_date,
  canonical_user_id, wallet_address, status, amount_spent, created_at, updated_at
)
SELECT 
  gen_random_uuid(),
  pt.canonical_user_id,
  pt.competition_id,
  array_to_string(COALESCE(pt.ticket_numbers, ARRAY[]::int[]), ','),
  pt.confirmed_at,
  pt.canonical_user_id,
  pt.wallet_address,
  'active',
  COALESCE(pt.total_amount, 0),
  pt.confirmed_at,
  pt.confirmed_at
FROM pending_tickets pt
WHERE pt.status = 'confirmed'
  AND pt.confirmed_at >= '2026-02-22'::date
  AND NOT EXISTS (
    SELECT 1 FROM joincompetition jc 
    WHERE jc.canonical_user_id = pt.canonical_user_id 
      AND jc.competition_id = pt.competition_id
  );

-- Verify
SELECT 
  purchase_date, 
  canonical_user_id, 
  status,
  numberoftickets
FROM joincompetition 
WHERE purchase_date >= '2026-02-22'::date
ORDER BY purchase_date DESC
LIMIT 10;
