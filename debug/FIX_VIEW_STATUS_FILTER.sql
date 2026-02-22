-- FIX: v_joincompetition_active view is filtering out 'sold' entries
-- The view has: WHERE jc.status = 'active'
-- But many purchase functions insert with status = 'sold'
-- 
-- This is why the landing page shows data that's "10 hours behind" -
-- all new entries have status='sold' and are filtered out!

-- First, let's see what statuses exist:
SELECT status, COUNT(*) as count 
FROM joincompetition 
GROUP BY status 
ORDER BY count DESC;

-- Fix: Update the view to include both 'active' AND 'sold' entries
-- (or any non-negative status)
CREATE OR REPLACE VIEW v_joincompetition_active AS
SELECT 
    jc.id,
    jc.user_id,
    jc.user_id AS userid,
    jc.competition_id,
    jc.competition_id AS competitionid,
    jc.ticket_numbers,
    jc.ticket_numbers AS ticketnumbers,
    jc.purchase_date,
    jc.purchase_date AS purchasedate,
    jc.transaction_hash,
    jc.transaction_hash AS transactionhash,
    jc.canonical_user_id,
    jc.privy_user_id,
    jc.wallet_address,
    jc.status,
    COALESCE(
      cu1.username,
      cu2.username,
      cu3.username
    ) AS username,
    COALESCE(cu1.avatar_url, cu2.avatar_url, cu3.avatar_url) AS avatar_url
FROM joincompetition jc
LEFT JOIN canonical_users cu1 ON cu1.canonical_user_id = jc.canonical_user_id
LEFT JOIN canonical_users cu2 ON cu2.wallet_address = jc.wallet_address 
    AND jc.canonical_user_id IS NULL
LEFT JOIN canonical_users cu3 ON cu3.canonical_user_id = jc.wallet_address 
    AND jc.canonical_user_id IS NULL
    AND jc.wallet_address LIKE 'prize:pid:%'
WHERE jc.status IN ('active', 'sold');  -- FIXED: Include 'sold' entries!

-- Verify the fix worked - should now show recent entries
SELECT purchasedate, username, status 
FROM v_joincompetition_active 
ORDER BY purchasedate DESC 
LIMIT 10;
