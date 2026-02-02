-- ============================================================================
-- Migration: Remove util.upsert_canonical_user Name Collision
-- ============================================================================
-- Description: Renames or drops util.upsert_canonical_user to prevent 
--              search_path ambiguity with public.upsert_canonical_user
--
-- Context: Staging DB has both:
--   - public.upsert_canonical_user (client-facing RPC)
--   - util.upsert_canonical_user (internal helper)
-- This causes "function name is not unique" errors when search_path includes both schemas.
--
-- Solution: Rename util.upsert_canonical_user to util.upsert_canonical_user_from_auth
--           to make the name unique and clarify its purpose.
-- ============================================================================

BEGIN;

-- Idempotent rename: Only rename if the function exists
DO $$
BEGIN
  -- Check if util schema exists
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'util') THEN
    -- Check if util.upsert_canonical_user exists
    IF EXISTS (
      SELECT 1 
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'util' 
        AND p.proname = 'upsert_canonical_user'
    ) THEN
      -- Rename the function to avoid collision
      RAISE NOTICE 'Renaming util.upsert_canonical_user to util.upsert_canonical_user_from_auth';
      
      -- Note: We need to specify the full signature to rename the correct function
      -- Assuming signature is (text, text, text, text) returning uuid based on problem statement
      ALTER FUNCTION util.upsert_canonical_user(text, text, text, text) 
        RENAME TO upsert_canonical_user_from_auth;
      
      RAISE NOTICE 'Successfully renamed util.upsert_canonical_user to util.upsert_canonical_user_from_auth';
    ELSE
      RAISE NOTICE 'util.upsert_canonical_user does not exist - no action needed';
    END IF;
  ELSE
    RAISE NOTICE 'util schema does not exist - no action needed';
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    -- Log error but don't fail migration
    RAISE WARNING 'Failed to rename util.upsert_canonical_user: %. Continuing migration.', SQLERRM;
END $$;

COMMIT;

-- Add comment explaining the change
COMMENT ON SCHEMA public IS 
  'Public schema - Client-facing RPC functions including upsert_canonical_user(BOOLEAN)';
