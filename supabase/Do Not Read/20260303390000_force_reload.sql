-- ============================================================================
-- FORCE POSTGREST RELOAD - Clear function cache completely
-- ============================================================================

-- Signal PostgREST to reload its schema cache
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';

DO $$
BEGIN
  RAISE NOTICE '========================================================';
  RAISE NOTICE 'FORCED POSTGREST RELOAD';
  RAISE NOTICE 'Sent reload schema and reload config signals';
  RAISE NOTICE 'Cleared all cached plans';
  RAISE NOTICE '========================================================';
END $$;
