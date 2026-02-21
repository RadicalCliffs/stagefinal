-- ============================================================
-- DIAGNOSTIC: Why are balance purchase entries not showing?
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor)
-- Copy each section and run separately
-- ============================================================

-- 1. Check recent pending_tickets for this user (CONFIRMED ones)
SELECT 
  id,
  competition_id,
  ticket_numbers,
  status,
  confirmed_at,
  canonical_user_id,
  wallet_address,
  created_at
FROM pending_tickets
WHERE user_id = 'prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363'
   OR canonical_user_id = 'prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363'
   OR LOWER(wallet_address) = '0x0ff51ec0ecc9ae1e5e6048976ba307c849781363'
ORDER BY created_at DESC
LIMIT 5;

-- 2. Check if tickets were created for this user
SELECT 
  id,
  competition_id,
  ticket_number,
  canonical_user_id,
  wallet_address,
  user_id,
  status,
  purchased_at
FROM tickets
WHERE canonical_user_id = 'prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363'
   OR LOWER(wallet_address) = '0x0ff51ec0ecc9ae1e5e6048976ba307c849781363'
   OR LOWER(user_id) = '0x0ff51ec0ecc9ae1e5e6048976ba307c849781363'
ORDER BY purchased_at DESC
LIMIT 5;

-- 3. Check column types
SELECT column_name, data_type, udt_name
FROM information_schema.columns
WHERE table_name IN ('tickets', 'pending_tickets') 
  AND column_name = 'competition_id'
ORDER BY table_name;

-- 4. Check trigger exists
SELECT tgname, tgenabled FROM pg_trigger
WHERE tgrelid = 'pending_tickets'::regclass AND tgname LIKE '%confirm%';

-- 5. Check trigger function definition
SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'trg_fn_confirm_pending_tickets';

-- 6. Test dashboard RPC
SELECT * FROM get_comprehensive_user_dashboard_entries('prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363') LIMIT 3;
