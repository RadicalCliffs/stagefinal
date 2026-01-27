-- Migration: Create exec_sql function for aggressive mode
-- This function allows service-level execution of arbitrary SQL
-- Used by the aggressive schema manager to auto-fix database issues

-- Create exec_sql function (service role only)
CREATE OR REPLACE FUNCTION exec_sql(sql_query TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  -- Only allow service role to execute
  IF current_setting('request.jwt.claims', true)::json->>'role' != 'service_role' THEN
    RAISE EXCEPTION 'Access denied: exec_sql requires service_role';
  END IF;

  -- Execute the SQL query
  EXECUTE sql_query;
  
  -- Return success
  RETURN json_build_object('success', true, 'message', 'SQL executed successfully');
EXCEPTION
  WHEN OTHERS THEN
    -- Return error details
    RETURN json_build_object(
      'success', false,
      'error', SQLERRM,
      'detail', SQLSTATE
    );
END;
$$;

-- Grant execute to service role only
REVOKE ALL ON FUNCTION exec_sql(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION exec_sql(TEXT) TO service_role;

COMMENT ON FUNCTION exec_sql IS 'Execute arbitrary SQL (service role only) - Used by aggressive mode for auto-schema management';
