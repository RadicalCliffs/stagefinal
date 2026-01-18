-- Create function to get database indexes
-- This function queries pg_indexes to retrieve all non-system indexes
-- Used by the admin panel to display database index information

CREATE OR REPLACE FUNCTION get_database_indexes()
RETURNS TABLE (
  name text,
  table_name text,
  columns text[],
  is_unique boolean,
  index_type text,
  table_schema text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    i.indexname::text AS name,
    i.tablename::text AS table_name,
    ARRAY(
      SELECT a.attname::text
      FROM pg_index idx
      JOIN pg_attribute a ON a.attrelid = idx.indrelid AND a.attnum = ANY(idx.indkey)
      WHERE idx.indexrelid = (i.schemaname || '.' || i.indexname)::regclass
      ORDER BY array_position(idx.indkey, a.attnum)
    ) AS columns,
    ix.indisunique AS is_unique,
    am.amname::text AS index_type,
    i.schemaname::text AS table_schema
  FROM pg_indexes i
  JOIN pg_class c ON c.relname = i.indexname
  JOIN pg_index ix ON ix.indexrelid = c.oid
  JOIN pg_am am ON am.oid = c.relam
  WHERE i.schemaname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
    AND i.schemaname = 'public'  -- Only show public schema indexes
  ORDER BY i.tablename, i.indexname;
END;
$$;

-- Grant execute permission to authenticated users (admin check is done in edge function)
GRANT EXECUTE ON FUNCTION get_database_indexes() TO authenticated;

COMMENT ON FUNCTION get_database_indexes() IS 
'Returns all database indexes in the public schema with their properties. Admin-only access enforced at API level.';
