-- FIX: Manually create missing joincompetition entry for 518 tickets ($259 purchase)
-- This purchase was confirmed in pending_tickets but failed to create joincompetition entry

-- Get the ticket numbers from the tickets table
WITH new_tickets AS (
  SELECT 
    array_agg(ticket_number ORDER BY ticket_number) as ticket_numbers,
    COUNT(*) as ticket_count
  FROM tickets
  WHERE canonical_user_id = 'prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363'
    AND competition_id = '98ea9cbc-5d9b-409b-b757-acb9d0292a95'
    AND created_at >= '2026-03-03T12:44:00'
    AND created_at <= '2026-03-03T12:45:00'
)
INSERT INTO joincompetition (
  canonical_user_id,
  competitionid,
  numberoftickets,
  amount_spent,
  ticketnumbers,
  created_at
)
SELECT
  'prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363',
  '98ea9cbc-5d9b-409b-b757-acb9d0292a95',
  ticket_count,
  ticket_count * 0.50, -- $0.50 per ticket = $259.00
  array_to_string(ticket_numbers, ','),
  '2026-03-03T12:44:37+00:00'
FROM new_tickets
RETURNING id, numberoftickets, amount_spent, ticketnumbers;
