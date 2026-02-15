-- Test script for user_overview view
-- Run this to verify the view is working correctly

-- 1. Check if the view exists
SELECT 
    schemaname, 
    viewname, 
    viewowner, 
    definition 
FROM pg_views 
WHERE viewname = 'user_overview';

-- 2. Check view structure (columns)
SELECT 
    column_name, 
    data_type, 
    is_nullable
FROM information_schema.columns
WHERE table_name = 'user_overview'
ORDER BY ordinal_position;

-- 3. Test query: Get sample data for one user
-- Replace 'prize:pid:0x...' with an actual canonical_user_id from your database
SELECT 
    canonical_user_uuid,
    canonical_user_id,
    entries_count,
    tickets_count,
    transactions_count,
    ledger_count,
    total_credits,
    total_debits,
    jsonb_array_length(entries_json::jsonb) as entries_json_length,
    jsonb_array_length(tickets_json::jsonb) as tickets_json_length,
    jsonb_array_length(transactions_json::jsonb) as transactions_json_length,
    jsonb_array_length(ledger_json::jsonb) as ledger_json_length,
    jsonb_object_keys(balances_json) as currency_keys
FROM user_overview
LIMIT 1;

-- 4. Test query: Find a specific user
-- Replace with actual canonical_user_id
SELECT *
FROM user_overview
WHERE canonical_user_id = 'prize:pid:0x...';

-- 5. Verify entries JSON structure
SELECT 
    canonical_user_id,
    jsonb_pretty(entries_json::jsonb) as entries
FROM user_overview
WHERE entries_count > 0
LIMIT 1;

-- 6. Verify balances JSON structure
SELECT 
    canonical_user_id,
    jsonb_pretty(balances_json) as balances
FROM user_overview
WHERE jsonb_object_keys(balances_json) IS NOT NULL
LIMIT 1;

-- 7. Check for any users with data
SELECT 
    canonical_user_id,
    entries_count,
    tickets_count,
    transactions_count
FROM user_overview
WHERE entries_count > 0 OR tickets_count > 0 OR transactions_count > 0
LIMIT 10;

-- 8. Performance test: Count total rows
SELECT COUNT(*) as total_users FROM user_overview;

-- 9. Verify permissions
SELECT 
    grantee, 
    privilege_type 
FROM information_schema.role_table_grants 
WHERE table_name = 'user_overview';

-- Expected Results:
-- 1. View should exist in public schema
-- 2. Should have all expected columns (canonical_user_uuid, canonical_user_id, *_json, *_count, etc.)
-- 3. Sample data should show correct structure
-- 4. JSON fields should be valid JSON arrays/objects
-- 5. Permissions should include SELECT for authenticated and anon roles
