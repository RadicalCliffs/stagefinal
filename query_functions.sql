-- Create minimal test to see what's actually in the database
SELECT 
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS arguments
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND (p.proname ILIKE '%lucky%' OR p.proname ILIKE '%allocate%')
ORDER BY p.proname;
