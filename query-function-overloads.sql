-- Query all function overloads in production
SELECT 
  p.proname as function_name,
  pg_get_function_arguments(p.oid) as argument_types,
  pg_get_function_result(p.oid) as return_type,
  format('DROP FUNCTION IF EXISTS %I.%I(%s);', 
    n.nspname, 
    p.proname, 
    pg_get_function_identity_arguments(p.oid)) as drop_statement
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname IN ('reserve_lucky_dip', 'allocate_lucky_dip_tickets_batch', 'get_unavailable_tickets', 'check_and_mark_competition_sold_out')
ORDER BY p.proname, p.oid;
