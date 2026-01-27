-- ============================================================================
-- EXTRACT CURRENT DATABASE OBJECTS TO CSV
-- ============================================================================
-- Run these queries in your Supabase SQL Editor to export current state
-- ============================================================================

-- ============================================================================
-- 1. EXTRACT ALL FUNCTIONS
-- ============================================================================
\copy (
  SELECT 
    p.proname as function_name,
    pg_get_function_arguments(p.oid) as arguments,
    pg_get_function_result(p.oid) as return_type,
    CASE 
      WHEN p.prosecdef THEN 'DEFINER'
      ELSE 'INVOKER'
    END as security,
    obj_description(p.oid, 'pg_proc') as description
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.prokind = 'f'  -- Only functions, not aggregates or procedures
  ORDER BY p.proname, p.oid
) TO '/tmp/functions_export.csv' WITH CSV HEADER;

-- ============================================================================
-- 2. EXTRACT ALL TRIGGERS
-- ============================================================================
\copy (
  SELECT 
    t.tgname as trigger_name,
    c.relname as table_name,
    p.proname as function_name,
    CASE t.tgtype & 1 WHEN 1 THEN 'ROW' ELSE 'STATEMENT' END as orientation,
    CASE 
      WHEN t.tgtype & 2 = 2 THEN 'BEFORE'
      WHEN t.tgtype & 64 = 64 THEN 'INSTEAD OF'
      ELSE 'AFTER'
    END as timing,
    ARRAY(
      SELECT CASE 
        WHEN t.tgtype & 4 = 4 THEN 'INSERT'
        WHEN t.tgtype & 8 = 8 THEN 'DELETE'
        WHEN t.tgtype & 16 = 16 THEN 'UPDATE'
        WHEN t.tgtype & 32 = 32 THEN 'TRUNCATE'
      END
    ) as events,
    tgenabled as enabled
  FROM pg_trigger t
  JOIN pg_class c ON t.tgrelid = c.oid
  JOIN pg_namespace n ON c.relnamespace = n.oid
  JOIN pg_proc p ON t.tgfoid = p.oid
  WHERE n.nspname = 'public'
    AND NOT t.tgisinternal
  ORDER BY c.relname, t.tgname
) TO '/tmp/triggers_export.csv' WITH CSV HEADER;

-- ============================================================================
-- 3. EXTRACT ALL INDEXES
-- ============================================================================
\copy (
  SELECT 
    i.relname as index_name,
    t.relname as table_name,
    a.attname as column_name,
    ix.indisunique as is_unique,
    ix.indisprimary as is_primary,
    am.amname as index_type,
    pg_get_indexdef(i.oid) as definition
  FROM pg_class t
  JOIN pg_namespace n ON t.relnamespace = n.oid
  JOIN pg_index ix ON t.oid = ix.indrelid
  JOIN pg_class i ON i.oid = ix.indexrelid
  JOIN pg_am am ON i.relam = am.oid
  LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
  WHERE n.nspname = 'public'
    AND t.relkind = 'r'  -- Only regular tables
  ORDER BY t.relname, i.relname, a.attnum
) TO '/tmp/indexes_export.csv' WITH CSV HEADER;

-- ============================================================================
-- ALTERNATIVE: Query to display in Supabase Dashboard
-- ============================================================================

-- Functions summary
SELECT 
  proname as name,
  pg_get_function_arguments(oid) as args,
  CASE WHEN prosecdef THEN 'DEFINER' ELSE 'INVOKER' END as security
FROM pg_proc 
WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  AND prokind = 'f'
ORDER BY proname;

-- Triggers summary
SELECT 
  t.tgname as trigger_name,
  c.relname as table_name,
  p.proname as function_name,
  CASE WHEN t.tgenabled = 'O' THEN 'enabled' ELSE 'disabled' END as status
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_proc p ON t.tgfoid = p.oid
WHERE c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  AND NOT t.tgisinternal
ORDER BY c.relname, t.tgname;

-- Indexes summary
SELECT 
  i.relname as index_name,
  t.relname as table_name,
  ix.indisunique as is_unique,
  ix.indisprimary as is_primary
FROM pg_class t
JOIN pg_index ix ON t.oid = ix.indrelid
JOIN pg_class i ON i.oid = ix.indexrelid
WHERE t.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  AND t.relkind = 'r'
ORDER BY t.relname, i.relname;
