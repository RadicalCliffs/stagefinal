-- Query ALL tables with competition columns in production
SELECT 
  table_schema,
  table_name,
  column_name, 
  data_type,
  udt_name
FROM information_schema.columns 
WHERE table_schema = 'public'
  AND (
    column_name LIKE '%competition%'
    OR column_name = 'competitionid'
  )
ORDER BY table_name, column_name;
