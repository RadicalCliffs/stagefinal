-- RUN THIS IN SUPABASE SQL EDITOR
-- Cleans up duplicate entries and fixes ticket counts

-- Step 1: DIAGNOSE - Find entries where numberoftickets doesn't match actual ticket count
SELECT 
  id,
  uid,
  competitionid,
  wallet_address,
  numberoftickets,
  ticketnumbers,
  array_length(string_to_array(ticketnumbers, ','), 1) as actual_ticket_count,
  amountspent,
  purchasedate
FROM joincompetition
WHERE numberoftickets != array_length(string_to_array(ticketnumbers, ','), 1)
  AND ticketnumbers IS NOT NULL 
  AND ticketnumbers != ''
ORDER BY purchasedate DESC
LIMIT 50;

-- Step 2: DIAGNOSE - Find true duplicates (same wallet, same competition, same ticket numbers)
SELECT 
  wallet_address,
  competitionid,
  ticketnumbers,
  COUNT(*) as duplicate_count,
  array_agg(id) as entry_ids
FROM joincompetition
WHERE ticketnumbers IS NOT NULL AND ticketnumbers != ''
GROUP BY wallet_address, competitionid, ticketnumbers
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC;

-- Step 3: FIX - Update numberoftickets to match actual ticket count
UPDATE joincompetition
SET numberoftickets = array_length(string_to_array(ticketnumbers, ','), 1),
    amountspent = array_length(string_to_array(ticketnumbers, ','), 1)::numeric
WHERE numberoftickets != array_length(string_to_array(ticketnumbers, ','), 1)
  AND ticketnumbers IS NOT NULL 
  AND ticketnumbers != '';

-- Step 4: FIX - Delete true duplicates (keep the oldest entry)
WITH duplicates AS (
  SELECT 
    id,
    ROW_NUMBER() OVER (
      PARTITION BY wallet_address, competitionid, ticketnumbers 
      ORDER BY created_at ASC, id ASC
    ) as rn
  FROM joincompetition
  WHERE ticketnumbers IS NOT NULL AND ticketnumbers != ''
)
DELETE FROM joincompetition
WHERE id IN (
  SELECT id FROM duplicates WHERE rn > 1
);

-- Step 5: VERIFY - Check the Bitcoin Bonanza entries for the user
-- Replace 'YOUR_WALLET_ADDRESS' with the actual wallet
SELECT 
  id,
  uid,
  competitionid,
  wallet_address,
  numberoftickets,
  ticketnumbers,
  amountspent,
  purchasedate,
  created_at
FROM joincompetition
WHERE competitionid ILIKE '%bonanza%' 
   OR competitionid IN (
     SELECT id::text FROM competitions WHERE title ILIKE '%bonanza%'
   )
ORDER BY created_at DESC
LIMIT 20;
