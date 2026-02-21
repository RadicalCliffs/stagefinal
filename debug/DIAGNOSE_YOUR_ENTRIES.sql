-- DIAGNOSE: What is the RPC returning?
-- Run this to see what individual_purchases contains

-- First, get your wallet
SELECT DISTINCT wallet_address FROM joincompetition 
WHERE ticketnumbers LIKE '%3084%' AND ticketnumbers LIKE '%78228%';

-- Then check what the RPC returns (replace YOUR_WALLET below)
-- SELECT * FROM get_user_competition_entries('prize:pid:YOUR_WALLET_HERE');

-- Check the ACTUAL rows in joincompetition for Bonanza
SELECT 
  'RAW DATA' as source,
  id,
  competitionid,
  wallet_address,
  numberoftickets,
  ticketnumbers,
  amountspent,
  purchasedate,
  created_at
FROM joincompetition jc
WHERE wallet_address IN (
  SELECT DISTINCT wallet_address FROM joincompetition 
  WHERE ticketnumbers LIKE '%3084%' AND ticketnumbers LIKE '%78228%'
)
AND EXISTS (SELECT 1 FROM competitions c WHERE c.id::text = jc.competitionid AND c.title ILIKE '%bonanza%')
ORDER BY created_at;

-- COUNT how many rows exist
SELECT COUNT(*) as total_rows FROM joincompetition jc
WHERE wallet_address IN (
  SELECT DISTINCT wallet_address FROM joincompetition 
  WHERE ticketnumbers LIKE '%3084%' AND ticketnumbers LIKE '%78228%'
)
AND EXISTS (SELECT 1 FROM competitions c WHERE c.id::text = jc.competitionid AND c.title ILIKE '%bonanza%');

-- NUCLEAR: Delete ALL Bonanza entries for this wallet and keep only valid ones
-- First show what would be deleted:
SELECT 'WILL DELETE' as action, * FROM joincompetition jc
WHERE wallet_address IN (
  SELECT DISTINCT wallet_address FROM joincompetition 
  WHERE ticketnumbers LIKE '%3084%' AND ticketnumbers LIKE '%78228%'
)
AND EXISTS (SELECT 1 FROM competitions c WHERE c.id::text = jc.competitionid AND c.title ILIKE '%bonanza%')
AND (
  ticketnumbers IS NULL 
  OR ticketnumbers = '' 
  OR TRIM(ticketnumbers) = ''
  OR numberoftickets != array_length(string_to_array(ticketnumbers, ','), 1)
);

-- DO THE DELETE:
DELETE FROM joincompetition 
WHERE wallet_address IN (
  SELECT DISTINCT wallet_address FROM joincompetition 
  WHERE ticketnumbers LIKE '%3084%' AND ticketnumbers LIKE '%78228%'
)
AND EXISTS (SELECT 1 FROM competitions c WHERE c.id::text = jc.competitionid AND c.title ILIKE '%bonanza%')
AND (
  ticketnumbers IS NULL 
  OR ticketnumbers = '' 
  OR TRIM(ticketnumbers) = ''
  OR numberoftickets != array_length(string_to_array(ticketnumbers, ','), 1)
);

-- Also check competition_entries
SELECT 'competition_entries RAW' as source, * FROM competition_entries ce
WHERE wallet_address IN (
  SELECT DISTINCT wallet_address FROM joincompetition 
  WHERE ticketnumbers LIKE '%3084%' AND ticketnumbers LIKE '%78228%'
)
AND EXISTS (SELECT 1 FROM competitions c WHERE c.id = ce.competition_id AND c.title ILIKE '%bonanza%');

-- Delete bad ones from competition_entries too
DELETE FROM competition_entries 
WHERE wallet_address IN (
  SELECT DISTINCT wallet_address FROM joincompetition 
  WHERE ticketnumbers LIKE '%3084%' AND ticketnumbers LIKE '%78228%'
)
AND EXISTS (SELECT 1 FROM competitions c WHERE c.id = competition_entries.competition_id AND c.title ILIKE '%bonanza%')
AND (
  ticket_numbers IS NULL 
  OR ticket_numbers = '{}'
  OR cardinality(ticket_numbers) = 0
  OR ticket_count != cardinality(ticket_numbers)
);
