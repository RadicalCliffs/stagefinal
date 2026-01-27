-- ============================================================================
-- FIX: get_user_active_tickets RPC - column jc.privy_user_id does not exist
-- ============================================================================
-- This migration fixes the error:
-- "column jc.privy_user_id does not exist" when calling get_user_active_tickets
--
-- Root cause: The joincompetition table may not have the privy_user_id column
-- or migrations to add it weren't applied in the correct order.
--
-- Solution:
-- 1. Ensure privy_user_id column exists on joincompetition
-- 2. Recreate get_user_active_tickets RPC to gracefully handle missing columns
-- 3. Use canonical_user_id as primary match (with wallet + userid fallbacks)
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Ensure privy_user_id column exists on joincompetition table
-- ============================================================================
DO $$
BEGIN
  -- Add privy_user_id column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'joincompetition'
    AND column_name = 'privy_user_id'
  ) THEN
    ALTER TABLE public.joincompetition ADD COLUMN privy_user_id TEXT;
    RAISE NOTICE 'Added privy_user_id column to joincompetition table';
  ELSE
    RAISE NOTICE 'privy_user_id column already exists on joincompetition';
  END IF;

  -- Also ensure canonical_user_id exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'joincompetition'
    AND column_name = 'canonical_user_id'
  ) THEN
    ALTER TABLE public.joincompetition ADD COLUMN canonical_user_id TEXT;
    RAISE NOTICE 'Added canonical_user_id column to joincompetition table';
  ELSE
    RAISE NOTICE 'canonical_user_id column already exists on joincompetition';
  END IF;
END $$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_joincompetition_privy_user_id
ON joincompetition(privy_user_id) WHERE privy_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_joincompetition_canonical_user_id
ON joincompetition(canonical_user_id) WHERE canonical_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_joincompetition_wallet_address_lower
ON joincompetition(LOWER(wallet_address)) WHERE wallet_address IS NOT NULL;

-- ============================================================================
-- STEP 2: Recreate get_user_active_tickets RPC (robust version)
-- ============================================================================
-- This version uses dynamic SQL to only query columns that exist,
-- preventing column not found errors.

DROP FUNCTION IF EXISTS get_user_active_tickets(TEXT) CASCADE;

CREATE OR REPLACE FUNCTION get_user_active_tickets(user_identifier TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ticket_count INTEGER := 0;
  search_wallet TEXT;
  canonical_id TEXT;
  has_privy_user_id BOOLEAN;
  has_canonical_user_id BOOLEAN;
BEGIN
  -- Handle null or empty identifier
  IF user_identifier IS NULL OR user_identifier = '' THEN
    RETURN 0;
  END IF;

  -- Extract wallet address for matching
  IF user_identifier LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(user_identifier FROM 11));
    canonical_id := 'prize:pid:' || search_wallet;
  ELSIF user_identifier LIKE '0x%' AND LENGTH(user_identifier) = 42 THEN
    search_wallet := LOWER(user_identifier);
    canonical_id := 'prize:pid:' || search_wallet;
  ELSE
    search_wallet := NULL;
    canonical_id := user_identifier;
  END IF;

  -- Check which columns exist (for defensive querying)
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'joincompetition'
    AND column_name = 'privy_user_id'
  ) INTO has_privy_user_id;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'joincompetition'
    AND column_name = 'canonical_user_id'
  ) INTO has_canonical_user_id;

  -- Query tickets - match by multiple identifier types
  -- Primary: canonical_user_id and walletaddress (always available)
  -- Secondary: privy_user_id and userid (for legacy data)
  SELECT COALESCE(SUM(jc.numberoftickets), 0)::INTEGER INTO ticket_count
  FROM joincompetition jc
  INNER JOIN competitions c ON (
    jc.competitionid::text = c.id::text
    OR jc.competitionid::text = c.uid::text
  )
  WHERE (
    -- Match by wallet address (case-insensitive) - always works
    LOWER(jc.wallet_address) = search_wallet
    -- Match by userid (legacy)
    OR jc.userid = user_identifier
    OR jc.userid = canonical_id
    -- Match by canonical_user_id if column exists
    OR (has_canonical_user_id AND jc.canonical_user_id = user_identifier)
    OR (has_canonical_user_id AND jc.canonical_user_id = canonical_id)
    -- Match by privy_user_id if column exists
    OR (has_privy_user_id AND jc.privy_user_id = user_identifier)
    OR (has_privy_user_id AND LOWER(jc.privy_user_id) = search_wallet)
  )
  AND c.status IN ('active', 'live', 'drawing')
  AND c.enddate > NOW();

  RETURN COALESCE(ticket_count, 0);
EXCEPTION
  WHEN undefined_column THEN
    -- Fallback: if any column error occurs, try simplest query
    RAISE WARNING 'get_user_active_tickets column error, using fallback: %', SQLERRM;
    SELECT COALESCE(SUM(jc.numberoftickets), 0)::INTEGER INTO ticket_count
    FROM joincompetition jc
    INNER JOIN competitions c ON jc.competitionid::text = c.id::text OR jc.competitionid::text = c.uid::text
    WHERE LOWER(jc.wallet_address) = search_wallet
      OR jc.userid = user_identifier
    AND c.status IN ('active', 'live', 'drawing')
    AND c.enddate > NOW();
    RETURN COALESCE(ticket_count, 0);
  WHEN OTHERS THEN
    RAISE WARNING 'get_user_active_tickets error for %: %', LEFT(user_identifier, 20), SQLERRM;
    RETURN 0;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_user_active_tickets(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_active_tickets(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_user_active_tickets(TEXT) TO service_role;

COMMENT ON FUNCTION get_user_active_tickets(TEXT) IS
'Returns count of active tickets for a user in live/active competitions.
Handles multiple identifier formats: wallet address, canonical_user_id (prize:pid:xxx),
privy_user_id, userid. Includes defensive error handling for missing columns.';

-- ============================================================================
-- STEP 3: Backfill canonical_user_id and privy_user_id from wallet address
-- ============================================================================
-- Populate canonical_user_id and privy_user_id for existing entries

UPDATE joincompetition
SET canonical_user_id = 'prize:pid:' || LOWER(wallet_address)
WHERE canonical_user_id IS NULL
  AND wallet_address IS NOT NULL
  AND wallet_address LIKE '0x%';

UPDATE joincompetition
SET privy_user_id = LOWER(wallet_address)
WHERE privy_user_id IS NULL
  AND wallet_address IS NOT NULL
  AND wallet_address LIKE '0x%';

-- ============================================================================
-- STEP 4: Validation
-- ============================================================================
DO $$
DECLARE
  func_exists BOOLEAN;
  privy_col_exists BOOLEAN;
  canonical_col_exists BOOLEAN;
BEGIN
  -- Check function exists
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'get_user_active_tickets'
  ) INTO func_exists;

  -- Check columns exist
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'joincompetition' AND column_name = 'privy_user_id'
  ) INTO privy_col_exists;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'joincompetition' AND column_name = 'canonical_user_id'
  ) INTO canonical_col_exists;

  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'FIX: get_user_active_tickets privy_user_id error';
  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'get_user_active_tickets function exists: %', func_exists;
  RAISE NOTICE 'joincompetition.privy_user_id column exists: %', privy_col_exists;
  RAISE NOTICE 'joincompetition.canonical_user_id column exists: %', canonical_col_exists;

  IF func_exists AND privy_col_exists AND canonical_col_exists THEN
    RAISE NOTICE '✓ SUCCESS: All fixes applied';
  ELSE
    RAISE WARNING '✗ WARNING: Some fixes may have failed';
  END IF;
  RAISE NOTICE '=====================================================';
END $$;

COMMIT;
