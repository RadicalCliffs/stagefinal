-- ============================================================================
-- FIX: Unknown winners on finished competition pages
-- Issue: Winners showing as "Unknown" because wallet addresses don't match
-- ============================================================================

-- Step 1: Check current state of winners table
SELECT 
  'CURRENT WINNERS STATE' as check,
  w.competition_id,
  c.title,
  w.wallet_address as winner_wallet,
  w.ticket_number,
  cu.username,
  cu.wallet_address as canonical_wallet,
  cu.base_wallet_address
FROM winners w
LEFT JOIN competitions c ON c.id = w.competition_id
LEFT JOIN canonical_users cu ON cu.wallet_address ILIKE w.wallet_address 
  OR cu.base_wallet_address ILIKE w.wallet_address
  OR cu.canonical_user_id = w.user_id
WHERE c.status = 'completed'
ORDER BY w.won_at DESC
LIMIT 10;

-- Step 2: Update winners table with correct user_id from canonical_users
-- This ensures the JOIN works properly
UPDATE winners w
SET user_id = cu.canonical_user_id
FROM canonical_users cu
WHERE w.user_id IS NULL
  AND (
    cu.wallet_address ILIKE w.wallet_address
    OR cu.base_wallet_address ILIKE w.wallet_address
  );

-- Step 3: Update competition_winners table (legacy table)
UPDATE competition_winners cw
SET 
  user_id = cu.canonical_user_id,
  username = cu.username
FROM canonical_users cu
WHERE (
    cu.wallet_address ILIKE cw.winner
    OR cu.base_wallet_address ILIKE cw.winner
  )
  AND (cw.user_id IS NULL OR cw.username IS NULL);

-- Step 4: Verify the fix
SELECT 
  'AFTER FIX' as check,
  w.competition_id,
  c.title,
  w.wallet_address,
  w.ticket_number,
  w.user_id,
  cu.username
FROM winners w
LEFT JOIN competitions c ON c.id = w.competition_id
LEFT JOIN canonical_users cu ON cu.canonical_user_id = w.user_id
WHERE c.status = 'completed'
ORDER BY w.won_at DESC
LIMIT 10;

-- Step 5: Check if any winners still have NULL user_id
SELECT 
  'WINNERS WITH NULL USER_ID' as check,
  COUNT(*) as count,
  array_agg(DISTINCT w.wallet_address) as wallet_addresses
FROM winners w
LEFT JOIN competitions c ON c.id = w.competition_id
WHERE c.status = 'completed'
  AND w.user_id IS NULL;
