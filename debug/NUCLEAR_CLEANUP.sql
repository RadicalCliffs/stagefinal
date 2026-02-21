-- NUCLEAR CLEANUP - RUN THIS NOW
-- Deletes ALL bad entries across ALL users

-- Find your wallet address first
-- SELECT DISTINCT wallet_address FROM joincompetition WHERE ticketnumbers LIKE '%3084%' OR ticketnumbers LIKE '%78228%';

-- 1. Delete entries where ticket count doesn't match actual tickets in joincompetition
DELETE FROM joincompetition 
WHERE id IN (
  SELECT id FROM joincompetition 
  WHERE numberoftickets != array_length(string_to_array(ticketnumbers, ','), 1)
);

-- 2. Delete entries where ticket count doesn't match in competition_entries
DELETE FROM competition_entries
WHERE id IN (
  SELECT id FROM competition_entries
  WHERE ticket_count != cardinality(ticket_numbers)
);

-- 3. Delete ALL entries with only 1 ticket that has no valid ticket number
DELETE FROM joincompetition WHERE numberoftickets = 1 AND (ticketnumbers IS NULL OR ticketnumbers = '' OR TRIM(ticketnumbers) = '' OR ticketnumbers = '0');
DELETE FROM competition_entries WHERE ticket_count = 1 AND (ticket_numbers IS NULL OR ticket_numbers = '{}' OR cardinality(ticket_numbers) = 0 OR ticket_numbers = '{0}');

-- 4. Delete from tickets table where ticket_number is 0 or null
DELETE FROM tickets WHERE ticket_number IS NULL OR ticket_number = 0;

-- 5. Delete from pending_tickets with invalid data
DELETE FROM pending_tickets WHERE ticket_numbers IS NULL OR ticket_numbers = '' OR ticket_numbers = '[]' OR ticket_numbers = '[""]' OR ticket_numbers = '[0]' OR ticket_numbers = '["0"]';

-- 6. Find and show Bitcoin Bonanza entries to verify cleanup
SELECT 'AFTER CLEANUP - joincompetition' as status, id, wallet_address, numberoftickets, ticketnumbers, amountspent
FROM joincompetition jc
WHERE EXISTS (SELECT 1 FROM competitions c WHERE c.id::text = jc.competitionid AND c.title ILIKE '%bonanza%')
ORDER BY purchasedate DESC;

SELECT 'AFTER CLEANUP - competition_entries' as status, id, wallet_address, ticket_count, ticket_numbers, amount_paid
FROM competition_entries ce
WHERE EXISTS (SELECT 1 FROM competitions c WHERE c.id = ce.competition_id AND c.title ILIKE '%bonanza%')
ORDER BY created_at DESC;

SELECT 'AFTER CLEANUP - tickets' as status, id, competition_id, wallet_address, ticket_number
FROM tickets t
WHERE EXISTS (SELECT 1 FROM competitions c WHERE c.id = t.competition_id AND c.title ILIKE '%bonanza%')
ORDER BY created_at DESC;
