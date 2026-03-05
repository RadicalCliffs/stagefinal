-- Find what usernames exist that might be Jerry
SELECT username, email, canonical_user_id, wallet_address
FROM canonical_users
WHERE username ILIKE '%jerry%'
   OR email ILIKE '%jerry%'
ORDER BY created_at DESC;
