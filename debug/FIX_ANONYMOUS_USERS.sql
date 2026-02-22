-- =============================================================================
-- FIX: Add username to v_joincompetition_active view
-- =============================================================================
-- 
-- PROBLEM: Some entries show "Anonymous" because the view doesn't include 
-- username - frontend has to do separate lookups which can fail.
--
-- SOLUTION: Modify the view to JOIN with canonical_users and include 
-- username and avatar_url directly.
--
-- Run this in Supabase SQL Editor
-- =============================================================================

-- First, let's see the current view definition
-- SELECT pg_get_viewdef('v_joincompetition_active'::regclass, true);

-- Drop and recreate the view with username included
CREATE OR REPLACE VIEW v_joincompetition_active AS
SELECT 
    jc.uid AS id,
    jc.uid,
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
    -- NEW: Include username and avatar from canonical_users
    -- Try to join by canonical_user_id first, then by wallet_address
    COALESCE(cu1.username, cu2.username) AS username,
    COALESCE(cu1.avatar_url, cu2.avatar_url) AS avatar_url
FROM joincompetition jc
-- Join by canonical_user_id (primary lookup)
LEFT JOIN canonical_users cu1 ON cu1.canonical_user_id = jc.canonical_user_id
-- Join by wallet_address (fallback lookup)
LEFT JOIN canonical_users cu2 ON cu2.wallet_address = jc.wallet_address 
    AND jc.canonical_user_id IS NULL
WHERE jc.status = 'active';

-- Verify the view has the new columns
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'v_joincompetition_active'
ORDER BY ordinal_position;

-- Test query to verify usernames are populated
SELECT 
    wallet_address,
    canonical_user_id,
    username,
    avatar_url,
    COUNT(*) as entry_count
FROM v_joincompetition_active
GROUP BY wallet_address, canonical_user_id, username, avatar_url
ORDER BY entry_count DESC
LIMIT 20;
