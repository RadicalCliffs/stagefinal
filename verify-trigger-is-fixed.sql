-- Run this in Supabase SQL Editor to verify the trigger is using batch INSERT
SELECT 
  CASE 
    WHEN pg_get_functiondef(p.oid) LIKE '%FOREACH%' THEN '❌ OLD: Using slow FOREACH loop'
    WHEN pg_get_functiondef(p.oid) LIKE '%unnest%' THEN '✅ FIXED: Using batch INSERT with unnest'
    ELSE '⚠️  UNKNOWN: Check function manually'
  END as status,
  pg_get_functiondef(p.oid) as full_definition
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname = 'trg_fn_confirm_pending_tickets';
