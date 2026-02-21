-- Fix PostgREST Schema Cache Issue
-- The purchase_tickets_with_balance function exists but isn't in the schema cache
-- Run this in Supabase SQL Editor to reload the schema

-- Option 1: Notify PostgREST to reload schema (fastest)
NOTIFY pgrst, 'reload schema';

-- Option 2: If Option 1 doesn't work, verify the function exists
SELECT 
  p.proname as function_name,
  pg_get_function_arguments(p.oid) as arguments
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname LIKE '%purchase%balance%';

-- If the function doesn't exist, it may need to be created.
-- The function definition is in: debug/all functions sheet 2.csv line 983
