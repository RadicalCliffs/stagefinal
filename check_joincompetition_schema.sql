-- Check the actual column types for joincompetition table
SELECT 
  column_name, 
  data_type, 
  udt_name AS postgres_type,
  character_maximum_length,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'joincompetition' 
  AND column_name IN ('competitionid', 'competition_id', 'id')
ORDER BY ordinal_position;

-- Also get all columns for reference
\echo ''
\echo 'All columns in joincompetition table:'
\echo ''

SELECT 
  column_name, 
  data_type, 
  udt_name,
  ordinal_position
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'joincompetition'
ORDER BY ordinal_position;
