-- ============================================================================
-- EMERGENCY DIAGNOSTIC: Find triggers referencing balance_usd
-- ============================================================================
-- Error: "record \"new\" has no field \"balance_usd\""
-- This script finds any triggers or functions that reference the non-existent
-- balance_usd column (correct column name is usdc_balance)
-- ============================================================================

-- Find all triggers on canonical_users table
SELECT 
  t.tgname AS trigger_name,
  c.relname AS table_name,
  p.proname AS function_name,
  pg_get_triggerdef(t.oid) AS trigger_definition
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_proc p ON t.tgfoid = p.oid
WHERE c.relname = 'canonical_users'
  AND NOT t.tgisinternal
ORDER BY t.tgname;

-- Find function definitions that might reference balance_usd
SELECT 
  p.proname AS function_name,
  pg_get_functiondef(p.oid) AS function_definition
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND pg_get_functiondef(p.oid) ILIKE '%balance_usd%'
ORDER BY p.proname;

-- Alternative: Search for functions with "NEW" or "OLD" that might be triggers
SELECT 
  p.proname AS function_name,
  n.nspname AS schema_name,
  CASE 
    WHEN pg_get_functiondef(p.oid) ILIKE '%NEW.balance%' THEN 'References NEW.balance'
    WHEN pg_get_functiondef(p.oid) ILIKE '%OLD.balance%' THEN 'References OLD.balance'
    ELSE 'Other'
  END AS balance_reference,
  LEFT(pg_get_functiondef(p.oid), 200) AS function_preview
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname IN ('public', 'util')
  AND (
    pg_get_functiondef(p.oid) ILIKE '%NEW.balance%'
    OR pg_get_functiondef(p.oid) ILIKE '%OLD.balance%'
  )
ORDER BY p.proname;

-- Show canonical_users table columns
SELECT 
  column_name,
  data_type,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'canonical_users'
  AND column_name LIKE '%balance%'
ORDER BY ordinal_position;
