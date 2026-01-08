-- =====================================================
-- FIX: RPC Functions for Ticket Availability and Competition Entries
-- =====================================================
-- This migration addresses three issues:
--
-- 1. HTTP 404 on get_competition_ticket_availability_text RPC
--    - Ensures the function exists with correct signature (competition_id_text TEXT)
--
-- 2. Error 42703 (column does not exist) on competitions.uid queries
--    - Ensures the uid column exists on competitions table
--    - Creates index for performance
--
-- 3. HTTP 300 on get_competition_entries_bypass_rls RPC
--    - Removes any duplicate function overloads
--    - Ensures single canonical function with (competition_identifier text) signature
-- =====================================================

BEGIN;

-- =====================================================
-- PART 1: Ensure competitions.uid column exists
-- =====================================================
-- The uid column is used as a text-based identifier for competitions
-- which may be different from the UUID primary key (id)

DO $$
BEGIN
  -- Add uid column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'competitions'
    AND column_name = 'uid'
  ) THEN
    ALTER TABLE competitions ADD COLUMN uid text;
    RAISE NOTICE 'Added uid column to competitions table';
  ELSE
    RAISE NOTICE 'uid column already exists on competitions table';
  END IF;
END $$;

-- Create index on uid for faster lookups (idempotent)
CREATE INDEX IF NOT EXISTS idx_competitions_uid ON competitions(uid);


-- =====================================================
-- PART 2: Consolidate get_competition_entries_bypass_rls
-- =====================================================
-- Drop ALL existing overloads to prevent HTTP 300 (multiple choices)

DROP FUNCTION IF EXISTS get_competition_entries_bypass_rls(text) CASCADE;
DROP FUNCTION IF EXISTS get_competition_entries_bypass_rls(uuid) CASCADE;
DROP FUNCTION IF EXISTS get_competition_entries_bypass_rls(text, text) CASCADE;

-- Recreate with single canonical signature
CREATE OR REPLACE FUNCTION get_competition_entries_bypass_rls(competition_identifier text)
RETURNS TABLE (
  uid text,
  competitionid text,
  userid text,
  privy_user_id text,
  numberoftickets integer,
  ticketnumbers text,
  amountspent numeric,
  walletaddress text,
  chain text,
  transactionhash text,
  purchasedate timestamp with time zone,
  created_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $func$
DECLARE
  comp_uuid uuid;
  comp_uid_text text;
BEGIN
  -- Normalize the competition identifier
  -- Try to parse as UUID first
  BEGIN
    comp_uuid := competition_identifier::uuid;
    comp_uid_text := competition_identifier;
  EXCEPTION WHEN invalid_text_representation THEN
    -- Not a UUID, try to lookup by legacy uid field
    SELECT c.id, c.uid INTO comp_uuid, comp_uid_text
    FROM competitions c
    WHERE c.uid = competition_identifier
    LIMIT 1;
  END;

  -- If we have a UUID but uid is still the input, look up the actual uid
  IF comp_uuid IS NOT NULL AND comp_uid_text = competition_identifier THEN
    SELECT c.uid INTO comp_uid_text FROM competitions c WHERE c.id = comp_uuid LIMIT 1;
  END IF;

  RETURN QUERY
  -- Source 1: joincompetition table (primary source for confirmed entries)
  SELECT
    COALESCE(jc.uid::text, jc.id::text, gen_random_uuid()::text) as uid,
    COALESCE(jc.competitionid, '')::text as competitionid,
    COALESCE(jc.userid, '')::text as userid,
    COALESCE(jc.privy_user_id, jc.walletaddress, '')::text as privy_user_id,
    COALESCE(jc.numberoftickets, 1)::integer as numberoftickets,
    COALESCE(jc.ticketnumbers, '')::text as ticketnumbers,
    COALESCE(jc.amountspent, 0)::numeric as amountspent,
    COALESCE(jc.walletaddress, '')::text as walletaddress,
    COALESCE(jc.chain, 'Base')::text as chain,
    COALESCE(jc.transactionhash, '')::text as transactionhash,
    COALESCE(jc.purchasedate, jc.created_at, NOW())::timestamptz as purchasedate,
    COALESCE(jc.created_at, NOW())::timestamptz as created_at
  FROM joincompetition jc
  WHERE
    -- Match against competition identifier as TEXT (the column type)
    jc.competitionid = competition_identifier
    -- Also match against UUID cast to text
    OR (comp_uuid IS NOT NULL AND jc.competitionid = comp_uuid::text)
    -- Also match against legacy uid
    OR (comp_uid_text IS NOT NULL AND comp_uid_text != '' AND jc.competitionid = comp_uid_text)

  UNION ALL

  -- Source 2: tickets table (fallback for entries where joincompetition insert may have failed)
  -- Group by user to aggregate their tickets
  SELECT
    ('tickets-' || COALESCE(t.privy_user_id, 'unknown') || '-' || t.competition_id::text)::text as uid,
    COALESCE(t.competition_id::text, '')::text as competitionid,
    COALESCE(t.privy_user_id, '')::text as userid,
    COALESCE(t.privy_user_id, '')::text as privy_user_id,
    COUNT(*)::integer as numberoftickets,
    string_agg(t.ticket_number::text, ',' ORDER BY t.ticket_number)::text as ticketnumbers,
    COALESCE(SUM(t.purchase_price), 0)::numeric as amountspent,
    ''::text as walletaddress,
    'USDC'::text as chain,
    ''::text as transactionhash,
    MIN(t.created_at)::timestamptz as purchasedate,
    MIN(t.created_at)::timestamptz as created_at
  FROM tickets t
  WHERE
    t.competition_id = comp_uuid
    -- Exclude users who already have entries in joincompetition (avoid duplicates)
    AND NOT EXISTS (
      SELECT 1 FROM joincompetition jc2
      WHERE (
        jc2.competitionid = competition_identifier
        OR (comp_uuid IS NOT NULL AND jc2.competitionid = comp_uuid::text)
        OR (comp_uid_text IS NOT NULL AND comp_uid_text != '' AND jc2.competitionid = comp_uid_text)
      )
      AND (
        jc2.privy_user_id = t.privy_user_id
        OR jc2.walletaddress = t.privy_user_id
        OR jc2.userid = t.privy_user_id
      )
    )
  GROUP BY t.competition_id, t.privy_user_id

  ORDER BY purchasedate DESC;
END;
$func$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_competition_entries_bypass_rls(text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_competition_entries_bypass_rls(text) TO anon;
GRANT EXECUTE ON FUNCTION get_competition_entries_bypass_rls(text) TO service_role;

COMMENT ON FUNCTION get_competition_entries_bypass_rls(text) IS
'Returns all entries for a competition from joincompetition table with fallback to tickets table.
Accepts competition_identifier as TEXT parameter (can be UUID string or legacy uid).
Single canonical function - no overloads to prevent HTTP 300 errors.';


-- =====================================================
-- PART 3: Ensure get_competition_ticket_availability_text exists
-- =====================================================
-- This function is called by frontend with { competition_id_text: "..." }

DROP FUNCTION IF EXISTS get_competition_ticket_availability_text(text) CASCADE;

CREATE OR REPLACE FUNCTION get_competition_ticket_availability_text(competition_id_text TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_competition_uuid uuid;
  v_total_tickets INTEGER;
  v_competition_exists BOOLEAN;
  v_comp_uid TEXT;
  v_sold_tickets_jc INTEGER[] := ARRAY[]::INTEGER[];
  v_sold_tickets_table INTEGER[] := ARRAY[]::INTEGER[];
  v_pending_tickets INTEGER[] := ARRAY[]::INTEGER[];
  v_unavailable_tickets INTEGER[] := ARRAY[]::INTEGER[];
  v_available_tickets INTEGER[] := ARRAY[]::INTEGER[];
  v_ticket_num INTEGER;
BEGIN
  -- Validate input
  IF competition_id_text IS NULL OR trim(competition_id_text) = '' THEN
    RETURN json_build_object(
      'competition_id', competition_id_text,
      'total_tickets', 0,
      'available_tickets', ARRAY[]::INTEGER[],
      'sold_count', 0,
      'available_count', 0,
      'error', 'Invalid competition ID'
    );
  END IF;

  -- Try to cast to UUID
  BEGIN
    v_competition_uuid := competition_id_text::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    -- Not a valid UUID format, try to lookup by uid
    SELECT id INTO v_competition_uuid
    FROM competitions
    WHERE uid = competition_id_text
    LIMIT 1;

    IF v_competition_uuid IS NULL THEN
      RETURN json_build_object(
        'competition_id', competition_id_text,
        'total_tickets', 0,
        'available_tickets', ARRAY[]::INTEGER[],
        'sold_count', 0,
        'available_count', 0,
        'error', 'Competition not found'
      );
    END IF;
  END;

  -- Check if competition exists and get basic info
  SELECT
    EXISTS(SELECT 1 FROM competitions WHERE id = v_competition_uuid),
    COALESCE(total_tickets, 1000),
    uid
  INTO v_competition_exists, v_total_tickets, v_comp_uid
  FROM competitions
  WHERE id = v_competition_uuid;

  IF NOT v_competition_exists THEN
    RETURN json_build_object(
      'competition_id', competition_id_text,
      'total_tickets', 0,
      'available_tickets', ARRAY[]::INTEGER[],
      'sold_count', 0,
      'available_count', 0,
      'error', 'Competition not found'
    );
  END IF;

  -- Get sold tickets from joincompetition table (comma-separated string format)
  SELECT array_agg(DISTINCT ticket_num)
  INTO v_sold_tickets_jc
  FROM (
    SELECT CAST(trim(unnest(string_to_array(ticketnumbers, ','))) AS integer) AS ticket_num
    FROM joincompetition
    WHERE (
      competitionid = v_competition_uuid::text
      OR (v_comp_uid IS NOT NULL AND competitionid = v_comp_uid)
      OR competitionid = competition_id_text
    )
      AND ticketnumbers IS NOT NULL
      AND trim(ticketnumbers) != ''
  ) AS jc_tickets
  WHERE ticket_num IS NOT NULL;

  -- Get sold tickets from tickets table
  SELECT array_agg(DISTINCT ticket_number)
  INTO v_sold_tickets_table
  FROM tickets
  WHERE competition_id = v_competition_uuid;

  -- Merge sold tickets from both tables
  v_unavailable_tickets := COALESCE(v_sold_tickets_jc, ARRAY[]::INTEGER[]) || COALESCE(v_sold_tickets_table, ARRAY[]::INTEGER[]);

  -- Get pending reservations that haven't expired
  BEGIN
    SELECT array_agg(DISTINCT ticket_num)
    INTO v_pending_tickets
    FROM (
      SELECT unnest(ticket_numbers) AS ticket_num
      FROM pending_tickets
      WHERE competition_id = v_competition_uuid
        AND status = 'pending'
        AND expires_at > NOW()
    ) AS pending
    WHERE ticket_num IS NOT NULL;
  EXCEPTION WHEN undefined_table THEN
    v_pending_tickets := ARRAY[]::INTEGER[];
  END;

  -- Add pending tickets to unavailable
  v_unavailable_tickets := v_unavailable_tickets || COALESCE(v_pending_tickets, ARRAY[]::INTEGER[]);

  -- Remove duplicates
  SELECT array_agg(DISTINCT u) INTO v_unavailable_tickets FROM unnest(v_unavailable_tickets) AS u;

  -- Generate available tickets (1 to total_tickets, excluding unavailable)
  FOR v_ticket_num IN 1..v_total_tickets LOOP
    IF NOT (v_ticket_num = ANY(COALESCE(v_unavailable_tickets, ARRAY[]::INTEGER[]))) THEN
      v_available_tickets := array_append(v_available_tickets, v_ticket_num);
    END IF;
  END LOOP;

  -- Build and return result
  RETURN json_build_object(
    'competition_id', v_competition_uuid,
    'total_tickets', v_total_tickets,
    'available_tickets', COALESCE(v_available_tickets, ARRAY[]::INTEGER[]),
    'sold_count', COALESCE(array_length(v_unavailable_tickets, 1), 0),
    'available_count', COALESCE(array_length(v_available_tickets, 1), v_total_tickets)
  );
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_competition_ticket_availability_text(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_competition_ticket_availability_text(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_competition_ticket_availability_text(TEXT) TO service_role;

COMMENT ON FUNCTION get_competition_ticket_availability_text(TEXT) IS
'Returns ticket availability for a competition. Parameter: competition_id_text (TEXT).
Accepts both UUID strings and legacy uid values.
Returns JSON with: competition_id, total_tickets, available_tickets array, sold_count, available_count.';


-- =====================================================
-- VALIDATION
-- =====================================================

DO $$
DECLARE
  func_count INTEGER;
  uid_column_exists BOOLEAN;
BEGIN
  -- Check uid column exists
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'competitions'
    AND column_name = 'uid'
  ) INTO uid_column_exists;

  -- Count our functions
  SELECT COUNT(*) INTO func_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'get_competition_ticket_availability_text',
      'get_competition_entries_bypass_rls'
    );

  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'FIX: RPC Functions for Ticket Availability and Entries';
  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'competitions.uid column exists: %', uid_column_exists;
  RAISE NOTICE 'Functions created/updated: %', func_count;
  RAISE NOTICE '';
  RAISE NOTICE 'Functions:';
  RAISE NOTICE '  - get_competition_ticket_availability_text(TEXT) -> JSON';
  RAISE NOTICE '  - get_competition_entries_bypass_rls(TEXT) -> TABLE';
  RAISE NOTICE '';
  RAISE NOTICE 'Expected payloads:';
  RAISE NOTICE '  - get_competition_ticket_availability_text: { competition_id_text: "uuid-or-uid" }';
  RAISE NOTICE '  - get_competition_entries_bypass_rls: { competition_identifier: "uuid-or-uid" }';
  RAISE NOTICE '=====================================================';
END $$;

COMMIT;
