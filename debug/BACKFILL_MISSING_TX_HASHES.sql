-- BACKFILL: Populate missing transactionhash values in joincompetition
-- Run this in Supabase SQL Editor
-- This fixes old entries that show "-" for TX Hash in the UI

-- First, let's see how many entries are affected
SELECT 
  COUNT(*) as total_entries,
  COUNT(CASE WHEN transactionhash IS NULL OR transactionhash = '' THEN 1 END) as missing_tx_hash,
  COUNT(CASE WHEN transactionhash LIKE 'balance_%' THEN 1 END) as balance_entries,
  COUNT(CASE WHEN transactionhash LIKE '0x%' THEN 1 END) as blockchain_entries
FROM joincompetition;

-- Preview entries that will be updated
SELECT 
  id,
  uid,
  competitionid,
  userid,
  canonical_user_id,
  wallet_address,
  ticketnumbers,
  transactionhash,
  created_at
FROM joincompetition
WHERE transactionhash IS NULL OR transactionhash = ''
ORDER BY created_at DESC
LIMIT 50;

-- ============================================================
-- BACKFILL: Set transactionhash = 'balance_payment_{uid}' for missing entries
-- This creates a unique identifier that the frontend classifies as 'balance_payment'
-- and displays with a wallet icon instead of a broken link
-- ============================================================

UPDATE joincompetition
SET 
  transactionhash = 'balance_payment_' || COALESCE(uid, id::TEXT),
  updated_at = NOW()
WHERE 
  (transactionhash IS NULL OR transactionhash = '')
  AND uid IS NOT NULL;

-- For entries without uid, use the id
UPDATE joincompetition
SET 
  transactionhash = 'balance_payment_' || id::TEXT,
  updated_at = NOW()
WHERE 
  (transactionhash IS NULL OR transactionhash = '')
  AND uid IS NULL;

-- Verify the update
SELECT 
  COUNT(*) as total_entries,
  COUNT(CASE WHEN transactionhash IS NULL OR transactionhash = '' THEN 1 END) as still_missing,
  COUNT(CASE WHEN transactionhash LIKE 'balance_payment_%' THEN 1 END) as backfilled_entries,
  COUNT(CASE WHEN transactionhash LIKE 'balance_%' AND transactionhash NOT LIKE 'balance_payment_%' THEN 1 END) as other_balance_entries,
  COUNT(CASE WHEN transactionhash LIKE '0x%' THEN 1 END) as blockchain_entries
FROM joincompetition;

-- ============================================================
-- OPTIONAL: Also backfill the tickets table if needed
-- ============================================================

-- Check tickets table
SELECT 
  COUNT(*) as total_tickets,
  COUNT(CASE WHEN payment_tx_hash IS NULL OR payment_tx_hash = '' THEN 1 END) as missing_tx_hash
FROM tickets;

-- Backfill tickets using their joincompetition entry's transactionhash
UPDATE tickets t
SET payment_tx_hash = jc.transactionhash
FROM joincompetition jc
WHERE 
  t.competition_id::TEXT = jc.competitionid
  AND t.canonical_user_id = jc.canonical_user_id
  AND (t.payment_tx_hash IS NULL OR t.payment_tx_hash = '')
  AND jc.transactionhash IS NOT NULL
  AND jc.transactionhash != '';

-- Final verification
SELECT 
  'joincompetition' as table_name,
  COUNT(*) as total,
  COUNT(CASE WHEN transactionhash IS NULL OR transactionhash = '' THEN 1 END) as missing
FROM joincompetition
UNION ALL
SELECT 
  'tickets' as table_name,
  COUNT(*) as total,
  COUNT(CASE WHEN payment_tx_hash IS NULL OR payment_tx_hash = '' THEN 1 END) as missing
FROM tickets;
