-- RUN THIS IN SUPABASE SQL EDITOR
-- Cleans up duplicate/orphan entries from ALL source tables

-- ============================================
-- CLEANUP joincompetition TABLE
-- ============================================

-- Step 0a: DIAGNOSE - Find orphan entries with empty ticket numbers in joincompetition
SELECT 'joincompetition orphans' as source, id, competitionid, wallet_address, numberoftickets, ticketnumbers, amountspent, purchasedate
FROM joincompetition
WHERE (ticketnumbers IS NULL OR ticketnumbers = '' OR TRIM(ticketnumbers) = '')
ORDER BY created_at DESC
LIMIT 20;

-- Step 0b: DELETE orphan entries with no ticket numbers from joincompetition
DELETE FROM joincompetition
WHERE (ticketnumbers IS NULL OR ticketnumbers = '' OR TRIM(ticketnumbers) = '');

-- ============================================
-- CLEANUP competition_entries TABLE  
-- ============================================

-- Step 1a: DIAGNOSE - Find orphan entries in competition_entries
SELECT 'competition_entries orphans' as source, id, competition_id, wallet_address, ticket_count, ticket_numbers, amount_paid, created_at
FROM competition_entries
WHERE (ticket_numbers IS NULL OR ticket_numbers = '{}' OR cardinality(ticket_numbers) = 0)
ORDER BY created_at DESC
LIMIT 20;

-- Step 1b: DELETE orphan entries from competition_entries
DELETE FROM competition_entries
WHERE (ticket_numbers IS NULL OR ticket_numbers = '{}' OR cardinality(ticket_numbers) = 0);

-- ============================================
-- CLEANUP pending_tickets TABLE
-- ============================================

-- Step 2a: DIAGNOSE - Find orphan entries in pending_tickets
SELECT 'pending_tickets orphans' as source, id, competition_id, wallet_address, ticket_numbers, status, created_at
FROM pending_tickets
WHERE (ticket_numbers IS NULL OR ticket_numbers = '' OR ticket_numbers = '[]')
ORDER BY created_at DESC
LIMIT 20;

-- Step 2b: DELETE orphan entries from pending_tickets
DELETE FROM pending_tickets
WHERE (ticket_numbers IS NULL OR ticket_numbers = '' OR ticket_numbers = '[]');

-- ============================================
-- FIX MISMATCHED COUNTS in joincompetition
-- ============================================

-- Step 3: FIX - Update numberoftickets to match actual ticket count in joincompetition
UPDATE joincompetition
SET numberoftickets = array_length(string_to_array(ticketnumbers, ','), 1),
    amountspent = array_length(string_to_array(ticketnumbers, ','), 1)::numeric
WHERE numberoftickets != array_length(string_to_array(ticketnumbers, ','), 1)
  AND ticketnumbers IS NOT NULL 
  AND ticketnumbers != '';

-- ============================================
-- FIX MISMATCHED COUNTS in competition_entries
-- ============================================

-- Step 4: FIX - Update ticket_count to match actual array length in competition_entries
UPDATE competition_entries
SET ticket_count = cardinality(ticket_numbers),
    amount_paid = cardinality(ticket_numbers)::numeric
WHERE ticket_count != cardinality(ticket_numbers)
  AND ticket_numbers IS NOT NULL;

-- ============================================
-- DELETE DUPLICATES
-- ============================================

-- Step 5: Delete duplicates in joincompetition (keep oldest)
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

-- Step 6: Delete duplicates in competition_entries (keep oldest)
WITH duplicates AS (
  SELECT 
    id,
    ROW_NUMBER() OVER (
      PARTITION BY wallet_address, competition_id, ticket_numbers 
      ORDER BY created_at ASC, id ASC
    ) as rn
  FROM competition_entries
  WHERE ticket_numbers IS NOT NULL
)
DELETE FROM competition_entries
WHERE id IN (
  SELECT id FROM duplicates WHERE rn > 1
);

-- ============================================
-- VERIFY BITCOIN BONANZA
-- ============================================

-- Step 7: Check Bitcoin Bonanza entries for duplicates
SELECT 'joincompetition' as source, id, competitionid, wallet_address, numberoftickets, ticketnumbers, amountspent, purchasedate
FROM joincompetition jc
WHERE EXISTS (SELECT 1 FROM competitions c WHERE c.id::text = jc.competitionid AND c.title ILIKE '%bonanza%')
ORDER BY purchasedate DESC
LIMIT 20;

SELECT 'competition_entries' as source, id, competition_id, wallet_address, ticket_count, ticket_numbers, amount_paid, created_at
FROM competition_entries ce
WHERE EXISTS (SELECT 1 FROM competitions c WHERE c.id = ce.competition_id AND c.title ILIKE '%bonanza%')
ORDER BY created_at DESC
LIMIT 20;
