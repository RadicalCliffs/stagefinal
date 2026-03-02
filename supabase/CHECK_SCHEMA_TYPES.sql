-- Query to check ACTUAL column types in the database
SELECT 
  table_name,
  column_name,
  data_type,
  udt_name AS pg_type
FROM information_schema.columns
WHERE table_name IN ('pending_tickets', 'tickets', 'competitions', 'joincompetition')
  AND column_name IN ('competition_id', 'competitionid', 'id')
ORDER BY table_name, column_name;
