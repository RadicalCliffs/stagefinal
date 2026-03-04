-- Check actual column types in production database
SELECT 
  table_name,
  column_name, 
  data_type,
  udt_name
FROM information_schema.columns 
WHERE table_name IN ('joincompetition', 'pending_tickets', 'tickets', 'competitions')
  AND column_name LIKE '%competition%'
ORDER BY table_name, column_name;
