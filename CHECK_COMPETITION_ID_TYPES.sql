-- Check data types for competition_id in all relevant tables
SELECT 
  table_name,
  column_name,
  data_type,
  udt_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('joincompetition', 'tickets', 'pending_tickets', 'competitions')
  AND column_name LIKE '%competition%'
ORDER BY table_name, ordinal_position;
