-- DIAGNOSTIC: Why is wallet_address not showing on competition entries page?
-- Run in Supabase SQL Editor

-- Step 1: Pick a competition ID that's showing Anonymous entries
-- Replace 'YOUR_COMPETITION_ID' with an actual ID

-- Check what's in joincompetition for this competition
SELECT 
  'joincompetition' as source,
  competitionid,
  wallet_address,
  canonical_user_id,
  userid,
  ticketnumbers,
  created_at
FROM joincompetition
WHERE competitionid = 'YOUR_COMPETITION_ID'  -- Replace this
   OR competitionid IN (SELECT id::text FROM competitions WHERE id::text = 'YOUR_COMPETITION_ID')
   OR competitionid IN (SELECT uid FROM competitions WHERE id::text = 'YOUR_COMPETITION_ID')
LIMIT 20;

-- Step 2: Check what the RPC is actually returning
SELECT * FROM get_competition_entries_bypass_rls('YOUR_COMPETITION_ID') LIMIT 20;

-- Step 3: Compare competitionid formats
-- This shows how competition_id is stored in joincompetition
SELECT DISTINCT 
  competitionid,
  length(competitionid) as len,
  CASE 
    WHEN competitionid ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN 'UUID'
    ELSE 'OTHER'
  END as format_type
FROM joincompetition
WHERE competitionid IS NOT NULL
LIMIT 20;

-- Step 4: Check specific competition by UUID
-- Replace with actual UUID
SELECT 
  c.id as competition_uuid,
  c.uid as competition_uid,
  c.title,
  (SELECT COUNT(*) FROM joincompetition jc WHERE jc.competitionid = c.id::text) as jc_by_uuid,
  (SELECT COUNT(*) FROM joincompetition jc WHERE jc.competitionid = c.uid) as jc_by_uid,
  (SELECT COUNT(*) FROM tickets t WHERE t.competition_id = c.id) as tickets_count
FROM competitions c
WHERE c.id::text = 'YOUR_COMPETITION_ID'  -- Replace this
   OR c.uid = 'YOUR_COMPETITION_ID';

-- Step 5: If joincompetition has data but RPC returns empty wallets,
-- check if the column name is being aliased incorrectly
SELECT 
  'direct query' as method,
  wallet_address,
  COALESCE(wallet_address, '')::TEXT as coalesced_wallet
FROM joincompetition
WHERE competitionid = 'YOUR_COMPETITION_ID'  -- Replace this
LIMIT 5;
