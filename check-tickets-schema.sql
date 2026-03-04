-- Check tickets table indexes, constraints, and triggers
SELECT 
  'INDEXES' as type,
  indexname as name,
  indexdef as definition
FROM pg_indexes
WHERE tablename = 'tickets' AND schemaname = 'public'

UNION ALL

SELECT 
  'TRIGGERS' as type,
  tgname as name,
  pg_get_triggerdef(oid) as definition
FROM pg_trigger
WHERE tgrelid = 'public.tickets'::regclass
  AND tgisinternal = false

UNION ALL

SELECT 
  'CONSTRAINTS' as type,
  conname as name,
  pg_get_constraintdef(oid) as definition
FROM pg_constraint
WHERE conrelid = 'public.tickets'::regclass

ORDER BY type, name;
