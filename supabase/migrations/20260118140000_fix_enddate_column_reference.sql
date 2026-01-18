-- ============================================================================
-- FIX: Replace c.enddate with c.end_date in get_user_active_tickets RPC
-- ============================================================================
-- This migration fixes the error:
-- "column c.enddate does not exist" when calling get_user_active_tickets
--
-- Root cause: The competitions table uses end_date (with underscore) but
-- the RPC function was referencing enddate (without underscore)
--
-- Solution: Update get_user_active_tickets to use the correct column name
-- ============================================================================

BEGIN;

-- Drop the existing function
DROP FUNCTION IF EXISTS get_user_active_tickets(TEXT);

-- Recreate with correct column name (end_date instead of enddate)
CREATE OR REPLACE FUNCTION get_user_active_tickets(user_identifier TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ticket_count INTEGER;
  canonical_id TEXT;
  search_wallet TEXT;
  has_canonical_user_id BOOLEAN;
  has_privy_user_id BOOLEAN;
BEGIN
  -- Handle null or empty identifier
  IF user_identifier IS NULL OR user_identifier = '' THEN
    RETURN 0;
  END IF;

  -- Normalize wallet address to lowercase if it's a wallet
  IF user_identifier ~ '^0x[a-fA-F0-9]{40}$' THEN
    search_wallet := LOWER(user_identifier);
    canonical_id := 'prize:pid:' || search_wallet;
  ELSE
    search_wallet := NULL;
    canonical_id := user_identifier;
  END IF;

  -- Check if canonical_user_id column exists
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'joincompetition'
    AND column_name = 'canonical_user_id'
  ) INTO has_canonical_user_id;

  -- Check if privy_user_id column exists
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'joincompetition'
    AND column_name = 'privy_user_id'
  ) INTO has_privy_user_id;

  -- Count tickets in active competitions
  -- CRITICAL FIX: Use c.end_date (with underscore) instead of c.enddate
  SELECT COALESCE(SUM(jc.numberoftickets), 0)::INTEGER INTO ticket_count
  FROM joincompetition jc
  INNER JOIN competitions c ON (
    jc.competitionid::text = c.id::text
    OR jc.competitionid::text = c.uid::text
  )
  WHERE (
    -- Match by wallet address (case-insensitive) - always works
    LOWER(jc.walletaddress) = search_wallet
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
  AND c.end_date > NOW(); -- FIXED: Changed from c.enddate to c.end_date

  RETURN COALESCE(ticket_count, 0);
EXCEPTION
  WHEN undefined_column THEN
    -- Fallback: if any column error occurs, try simplest query
    RAISE WARNING 'get_user_active_tickets column error, using fallback: %', SQLERRM;
    SELECT COALESCE(SUM(jc.numberoftickets), 0)::INTEGER INTO ticket_count
    FROM joincompetition jc
    INNER JOIN competitions c ON jc.competitionid::text = c.id::text OR jc.competitionid::text = c.uid::text
    WHERE LOWER(jc.walletaddress) = search_wallet
      OR jc.userid = user_identifier
    AND c.status IN ('active', 'live', 'drawing')
    AND c.end_date > NOW(); -- FIXED: Changed from c.enddate to c.end_date
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

COMMIT;
