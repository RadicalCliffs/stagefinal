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
    c_idx.relname::text AS name,
    c_tbl.relname::text AS table_name,
    ARRAY(
      SELECT a.attname::text
      FROM pg_attribute a
      WHERE a.attrelid = idx.indrelid 
        AND a.attnum = ANY(idx.indkey)
      ORDER BY array_position(idx.indkey, a.attnum)
    ) AS columns,
    idx.indisunique AS is_unique,
    am.amname::text AS index_type,
    n.nspname::text AS table_schema
  FROM pg_index idx
  JOIN pg_class c_idx ON c_idx.oid = idx.indexrelid
  JOIN pg_class c_tbl ON c_tbl.oid = idx.indrelid
  JOIN pg_am am ON am.oid = c_idx.relam
  JOIN pg_namespace n ON n.oid = c_tbl.relnamespace
  WHERE n.nspname = 'public'  -- Only show public schema indexes
    AND c_idx.relkind = 'i'   -- Only indexes
  ORDER BY c_tbl.relname, c_idx.relname;
END;
$$;

-- Grant execute permission to authenticated users (admin check is done in edge function)
GRANT EXECUTE ON FUNCTION get_database_indexes() TO authenticated;

COMMENT ON FUNCTION get_database_indexes() IS 
'Returns all database indexes in the public schema with their properties. Admin-only access enforced at API level.';
