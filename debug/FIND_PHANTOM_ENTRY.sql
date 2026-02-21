-- RUN THIS TO FIND THE PHANTOM $1 ENTRY
-- Searches ALL tables for entries with 1 ticket that might have invalid data

-- Check joincompetition for entries with 1 ticket
SELECT 'joincompetition' as source, 
       id, competitionid, wallet_address, numberoftickets, 
       ticketnumbers, 
       LENGTH(ticketnumbers) as ticket_str_len,
       amountspent, purchasedate
FROM joincompetition
WHERE numberoftickets = 1
  AND (
    ticketnumbers IS NULL 
    OR ticketnumbers = '' 
    OR ticketnumbers = '0'
    OR ticketnumbers = 'null'
    OR ticketnumbers NOT SIMILAR TO '%[0-9]%'
    OR LENGTH(TRIM(ticketnumbers)) < 2
  )
ORDER BY created_at DESC
LIMIT 50;

-- Check competition_entries for entries with 1 ticket
SELECT 'competition_entries' as source,
       id, competition_id, wallet_address, ticket_count,
       ticket_numbers,
       amount_paid, created_at
FROM competition_entries
WHERE ticket_count = 1
  AND (
    ticket_numbers IS NULL 
    OR ticket_numbers = '{}'
    OR ticket_numbers = '{0}'
    OR ticket_numbers = '{null}'
    OR cardinality(ticket_numbers) = 0
    OR (cardinality(ticket_numbers) = 1 AND ticket_numbers[1] = 0)
  )
ORDER BY created_at DESC
LIMIT 50;

-- Check ALL $1 entries from 2/20
SELECT 'joincompetition ALL $1 on 2/20' as source,
       id, competitionid, wallet_address, numberoftickets, ticketnumbers, amountspent, purchasedate
FROM joincompetition
WHERE amountspent = 1
  AND purchasedate::date = '2026-02-20'
ORDER BY created_at DESC;

SELECT 'competition_entries ALL $1 on 2/20' as source,
       id, competition_id, wallet_address, ticket_count, ticket_numbers, amount_paid, created_at
FROM competition_entries
WHERE amount_paid = 1
  AND created_at::date = '2026-02-20'
ORDER BY created_at DESC;

-- NUCLEAR OPTION: Delete ALL entries where ticket count doesn't match actual tickets
-- joincompetition
DELETE FROM joincompetition
WHERE numberoftickets = 1
  AND (
    ticketnumbers IS NULL 
    OR ticketnumbers = '' 
    OR ticketnumbers = '0'
    OR LENGTH(TRIM(ticketnumbers)) < 2
  );

-- competition_entries with invalid single tickets
DELETE FROM competition_entries
WHERE ticket_count = 1
  AND (
    ticket_numbers IS NULL 
    OR ticket_numbers = '{}'
    OR ticket_numbers = '{0}'
    OR cardinality(ticket_numbers) = 0
    OR (cardinality(ticket_numbers) = 1 AND ticket_numbers[1] = 0)
  );
