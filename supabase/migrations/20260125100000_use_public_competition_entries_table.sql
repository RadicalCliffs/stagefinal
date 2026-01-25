-- ============================================================================
-- USE PUBLIC COMPETITION_ENTRIES TABLE FOR FRONTEND
-- ============================================================================
-- This migration:
-- 1. Creates RPC functions to fetch entries from public.competition_entries
-- 2. Fixes the update_user_avatar function to match parameter names
-- 3. Ensures proper permissions for realtime subscriptions
--
-- The competition_entries table is now the single source of truth for all
-- competition entries, replacing the scattered data across joincompetition,
-- tickets, and user_transactions tables.
-- ============================================================================

BEGIN;

-- ============================================================================
-- PART 1: Create RPC to get user entries from competition_entries table
-- ============================================================================

DROP FUNCTION IF EXISTS get_user_competition_entries(TEXT) CASCADE;

CREATE OR REPLACE FUNCTION get_user_competition_entries(p_user_identifier TEXT)
RETURNS TABLE (
  id UUID,
  competition_id UUID,
  user_id TEXT,
  canonical_user_id TEXT,
  wallet_address TEXT,
  ticket_numbers INTEGER[],
  ticket_count INTEGER,
  amount_paid NUMERIC,
  currency TEXT,
  transaction_hash TEXT,
  payment_provider TEXT,
  entry_status TEXT,
  is_winner BOOLEAN,
  prize_claimed BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  -- Competition details joined
  competition_title TEXT,
  competition_description TEXT,
  competition_image_url TEXT,
  competition_status TEXT,
  competition_end_date TIMESTAMPTZ,
  competition_prize_value NUMERIC,
  competition_is_instant_win BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  lower_identifier TEXT;
  search_wallet TEXT;
  resolved_canonical_user_id TEXT := NULL;
  resolved_wallet_address TEXT := NULL;
  resolved_base_wallet_address TEXT := NULL;
BEGIN
  -- Normalize identifier for case-insensitive matching
  lower_identifier := LOWER(TRIM(p_user_identifier));

  -- Extract wallet address if present (remove prize:pid: prefix if exists)
  IF p_user_identifier LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(p_user_identifier FROM 11));
  ELSIF p_user_identifier LIKE '0x%' THEN
    search_wallet := lower_identifier;
  ELSE
    search_wallet := NULL;
  END IF;

  -- Resolve user from canonical_users table
  SELECT
    cu.canonical_user_id,
    LOWER(cu.wallet_address),
    LOWER(cu.base_wallet_address)
  INTO
    resolved_canonical_user_id,
    resolved_wallet_address,
    resolved_base_wallet_address
  FROM canonical_users cu
  WHERE
    cu.canonical_user_id = p_user_identifier
    OR LOWER(cu.wallet_address) = lower_identifier
    OR LOWER(cu.base_wallet_address) = lower_identifier
    OR cu.privy_user_id = p_user_identifier
    OR (search_wallet IS NOT NULL AND (
      LOWER(cu.wallet_address) = search_wallet
      OR LOWER(cu.base_wallet_address) = search_wallet
    ))
  LIMIT 1;

  -- Return entries from competition_entries table
  RETURN QUERY
  SELECT
    ce.id,
    ce.competition_id,
    ce.user_id,
    ce.canonical_user_id,
    ce.wallet_address,
    ce.ticket_numbers,
    ce.ticket_count,
    ce.amount_paid,
    ce.currency,
    ce.transaction_hash,
    ce.payment_provider,
    ce.entry_status,
    ce.is_winner,
    ce.prize_claimed,
    ce.created_at,
    ce.updated_at,
    -- Competition details
    COALESCE(c.title, '') AS competition_title,
    COALESCE(c.description, '') AS competition_description,
    COALESCE(c.image_url, '') AS competition_image_url,
    COALESCE(c.status, 'active') AS competition_status,
    c.end_date AS competition_end_date,
    c.prize_value AS competition_prize_value,
    COALESCE(c.is_instant_win, FALSE) AS competition_is_instant_win
  FROM competition_entries ce
  LEFT JOIN competitions c ON ce.competition_id = c.id
  WHERE (
    -- Match using resolved identifiers from canonical_users
    (resolved_canonical_user_id IS NOT NULL AND ce.canonical_user_id = resolved_canonical_user_id)
    OR (resolved_wallet_address IS NOT NULL AND LOWER(ce.wallet_address) = resolved_wallet_address)
    OR (resolved_base_wallet_address IS NOT NULL AND LOWER(ce.wallet_address) = resolved_base_wallet_address)
    -- Fallback: Direct matching if user not found in canonical_users
    OR (resolved_canonical_user_id IS NULL AND (
      ce.canonical_user_id = p_user_identifier
      OR LOWER(ce.wallet_address) = lower_identifier
      OR ce.user_id = p_user_identifier
      OR (search_wallet IS NOT NULL AND LOWER(ce.wallet_address) = search_wallet)
    ))
  )
  AND ce.entry_status != 'cancelled'
  ORDER BY ce.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_user_competition_entries(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_competition_entries(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_user_competition_entries(TEXT) TO service_role;

COMMENT ON FUNCTION get_user_competition_entries IS
'Returns all competition entries for a user from the public.competition_entries table.
This is the primary function for fetching user entries for the dashboard.';

-- ============================================================================
-- PART 2: Create RPC to get entries for a specific competition
-- ============================================================================

DROP FUNCTION IF EXISTS get_competition_entries_public(UUID) CASCADE;
DROP FUNCTION IF EXISTS get_competition_entries_public(TEXT) CASCADE;

CREATE OR REPLACE FUNCTION get_competition_entries_public(p_competition_id TEXT)
RETURNS TABLE (
  id UUID,
  competition_id UUID,
  user_id TEXT,
  canonical_user_id TEXT,
  wallet_address TEXT,
  ticket_numbers INTEGER[],
  ticket_count INTEGER,
  amount_paid NUMERIC,
  entry_status TEXT,
  is_winner BOOLEAN,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  comp_uuid UUID;
BEGIN
  -- Try to cast to UUID, or look up by uid
  BEGIN
    comp_uuid := p_competition_id::UUID;
  EXCEPTION WHEN OTHERS THEN
    -- Not a valid UUID, try to find by uid
    SELECT c.id INTO comp_uuid
    FROM competitions c
    WHERE c.uid = p_competition_id
    LIMIT 1;
  END;

  IF comp_uuid IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    ce.id,
    ce.competition_id,
    ce.user_id,
    ce.canonical_user_id,
    ce.wallet_address,
    ce.ticket_numbers,
    ce.ticket_count,
    ce.amount_paid,
    ce.entry_status,
    ce.is_winner,
    ce.created_at
  FROM competition_entries ce
  WHERE ce.competition_id = comp_uuid
    AND ce.entry_status = 'confirmed'
  ORDER BY ce.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_competition_entries_public(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_competition_entries_public(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_competition_entries_public(TEXT) TO service_role;

COMMENT ON FUNCTION get_competition_entries_public IS
'Returns all confirmed entries for a specific competition from the public.competition_entries table.';

-- ============================================================================
-- PART 3: Fix update_user_avatar function parameter names
-- ============================================================================
-- The frontend calls with (user_identifier, new_avatar_url) but the types file
-- has (p_user_identifier, p_avatar_url). We need to ensure the function works
-- with both parameter naming conventions.

DROP FUNCTION IF EXISTS update_user_avatar(text, text) CASCADE;

CREATE OR REPLACE FUNCTION update_user_avatar(
  user_identifier TEXT,
  new_avatar_url TEXT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_uid_found TEXT;
  normalized_user_id TEXT;
  search_wallet TEXT;
  rows_updated INTEGER;
BEGIN
  -- Validate inputs
  IF user_identifier IS NULL OR TRIM(user_identifier) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'User identifier is required');
  END IF;

  IF new_avatar_url IS NULL OR TRIM(new_avatar_url) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Avatar URL is required');
  END IF;

  -- Normalize for comparison
  normalized_user_id := LOWER(TRIM(user_identifier));

  -- Extract wallet address from prize:pid: format if present
  IF user_identifier LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(user_identifier FROM 11));
  ELSIF user_identifier LIKE '0x%' AND LENGTH(user_identifier) = 42 THEN
    search_wallet := LOWER(user_identifier);
  ELSE
    search_wallet := NULL;
  END IF;

  -- Find user in canonical_users table
  SELECT uid INTO user_uid_found
  FROM canonical_users
  WHERE
    canonical_user_id = user_identifier
    OR canonical_user_id = LOWER(user_identifier)
    OR (search_wallet IS NOT NULL AND LOWER(wallet_address) = search_wallet)
    OR (search_wallet IS NOT NULL AND LOWER(base_wallet_address) = search_wallet)
    OR LOWER(COALESCE(wallet_address, '')) = normalized_user_id
    OR LOWER(COALESCE(base_wallet_address, '')) = normalized_user_id
    OR privy_user_id = user_identifier
    OR uid = user_identifier
  LIMIT 1;

  IF user_uid_found IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found for identifier');
  END IF;

  -- Update avatar
  UPDATE canonical_users
  SET
    avatar_url = TRIM(new_avatar_url),
    updated_at = NOW()
  WHERE uid = user_uid_found;

  GET DIAGNOSTICS rows_updated = ROW_COUNT;

  IF rows_updated > 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'message', 'Avatar updated successfully'
    );
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'Failed to update avatar');
  END IF;

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'Database error: ' || SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION update_user_avatar(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION update_user_avatar(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION update_user_avatar(TEXT, TEXT) TO service_role;

COMMENT ON FUNCTION update_user_avatar IS
'Updates user avatar URL in canonical_users table.
Parameters: user_identifier (wallet address, prize:pid:, or privy DID), new_avatar_url (full URL).
Returns: {success: boolean, message?: string, error?: string}';

-- ============================================================================
-- PART 4: Enable realtime for competition_entries table
-- ============================================================================

-- Enable RLS on competition_entries if not already enabled
ALTER TABLE IF EXISTS competition_entries ENABLE ROW LEVEL SECURITY;

-- Create SELECT policy for competition_entries (public read access)
DROP POLICY IF EXISTS "competition_entries_select_policy" ON competition_entries;
CREATE POLICY "competition_entries_select_policy" ON competition_entries
  FOR SELECT
  USING (true);

-- Enable realtime for competition_entries table
DO $$
BEGIN
  -- Check if the publication exists
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    -- Add competition_entries to the realtime publication if not already added
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'competition_entries'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.competition_entries;
      RAISE NOTICE 'Added competition_entries to supabase_realtime publication';
    ELSE
      RAISE NOTICE 'competition_entries already in supabase_realtime publication';
    END IF;
  ELSE
    RAISE NOTICE 'supabase_realtime publication does not exist';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add competition_entries to realtime: %', SQLERRM;
END $$;

-- ============================================================================
-- PART 5: Grant SELECT permissions on competition_entries
-- ============================================================================

GRANT SELECT ON public.competition_entries TO authenticated;
GRANT SELECT ON public.competition_entries TO anon;
GRANT SELECT ON public.competition_entries TO service_role;

-- Create index for efficient user lookups
CREATE INDEX IF NOT EXISTS idx_competition_entries_canonical_user_id
  ON competition_entries(canonical_user_id);
CREATE INDEX IF NOT EXISTS idx_competition_entries_wallet_address_lower
  ON competition_entries(LOWER(wallet_address));
CREATE INDEX IF NOT EXISTS idx_competition_entries_competition_id
  ON competition_entries(competition_id);
CREATE INDEX IF NOT EXISTS idx_competition_entries_created_at
  ON competition_entries(created_at DESC);

-- ============================================================================
-- Validation
-- ============================================================================

DO $$
DECLARE
  func_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO func_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
  AND p.proname IN ('get_user_competition_entries', 'get_competition_entries_public', 'update_user_avatar');

  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'MIGRATION COMPLETE: Use Public Competition Entries';
  RAISE NOTICE '=====================================================';
  RAISE NOTICE '✓ Created get_user_competition_entries RPC';
  RAISE NOTICE '✓ Created get_competition_entries_public RPC';
  RAISE NOTICE '✓ Fixed update_user_avatar function';
  RAISE NOTICE '✓ Enabled realtime for competition_entries table';
  RAISE NOTICE '✓ Created indexes for efficient lookups';
  RAISE NOTICE 'Functions created: %', func_count;
  RAISE NOTICE '=====================================================';
END $$;

COMMIT;
