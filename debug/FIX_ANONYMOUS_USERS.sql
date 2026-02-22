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
-- APPLIED: 2026-02-21 via scripts/fix_anonymous_view.cjs
-- =============================================================================

-- Drop and recreate the view with username included
-- Three-way lookup to handle all edge cases:
-- 1. canonical_user_id match
-- 2. wallet_address match to canonical_users.wallet_address
-- 3. wallet_address match to canonical_users.canonical_user_id (for entries where canonical_user_id was stored in wrong column)
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
      cu1.username,    -- 1. Match by canonical_user_id
      cu2.username,    -- 2. Match wallet_address to canonical_users.wallet_address
      cu3.username     -- 3. Match wallet_address to canonical_users.canonical_user_id (edge case)
    ) AS username,
    COALESCE(cu1.avatar_url, cu2.avatar_url, cu3.avatar_url) AS avatar_url
FROM joincompetition jc
LEFT JOIN canonical_users cu1 ON cu1.canonical_user_id = jc.canonical_user_id
LEFT JOIN canonical_users cu2 ON cu2.wallet_address = jc.wallet_address 
    AND jc.canonical_user_id IS NULL
LEFT JOIN canonical_users cu3 ON cu3.canonical_user_id = jc.wallet_address 
    AND jc.canonical_user_id IS NULL
    AND jc.wallet_address LIKE 'prize:pid:%'
WHERE jc.status = 'active';

-- Verify the view has the new columns
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'v_joincompetition_active'
ORDER BY ordinal_position;

-- Test query to verify usernames are populated
SELECT 
    COUNT(*) as total,
    COUNT(username) as with_username,
    COUNT(*) - COUNT(username) as without_username
FROM v_joincompetition_active;
