-- CLEAN purchase_groups TABLE
-- This is where the phantom $1 entry is coming from!

-- Find invalid purchase groups
SELECT 
  'purchase_groups invalid' as source,
  id,
  user_id,
  competition_id,
  purchase_group_number,
  total_tickets,
  total_amount,
  events_in_group,
  events,
  group_start_at
FROM purchase_groups
WHERE total_tickets = 1 
  AND (
    events IS NULL
    OR jsonb_array_length(events) = 0
    OR NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(events) e 
      WHERE (e->>'amount')::numeric > 0
    )
  )
ORDER BY created_at DESC
LIMIT 50;

-- DELETE invalid purchase groups with 1 ticket that have no valid event data
DELETE FROM purchase_groups
WHERE total_tickets <= 1 
  AND total_amount <= 1
  AND (
    events IS NULL
    OR jsonb_array_length(events) = 0
  );

-- DELETE purchase groups where total_tickets doesn't match actual ticket count in events
DELETE FROM purchase_groups
WHERE id IN (
  SELECT pg.id 
  FROM purchase_groups pg
  WHERE total_tickets != (
    SELECT COALESCE(SUM((e->>'amount')::numeric), 0) 
    FROM jsonb_array_elements(pg.events) e
  )
);

-- Show remaining purchase groups for Bitcoin Bonanza
SELECT 
  'purchase_groups remaining' as source,
  pg.*
FROM purchase_groups pg
WHERE EXISTS (SELECT 1 FROM competitions c WHERE c.id = pg.competition_id AND c.title ILIKE '%bonanza%')
ORDER BY group_start_at DESC
LIMIT 20;
