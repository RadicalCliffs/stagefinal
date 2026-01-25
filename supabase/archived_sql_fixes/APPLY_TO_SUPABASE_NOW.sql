-- =====================================================
-- CRITICAL FIX: Apply These SQL Commands to Supabase Now
-- =====================================================
-- This script combines all necessary fixes for:
-- 1. Ticket availability showing 0 when all tickets are available
-- 2. Entries not showing in competition pages
-- 3. HTTP 300 errors from multiple function overloads
--
-- HOW TO APPLY:
-- 1. Go to Supabase Dashboard -> SQL Editor
-- 2. Paste this entire script
-- 3. Click "Run"
-- =====================================================

BEGIN;

-- =====================================================
-- PART 1: Ensure competitions.uid column exists
-- =====================================================
DO $$
BEGIN
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

CREATE INDEX IF NOT EXISTS idx_competitions_uid ON competitions(uid);

-- =====================================================
-- PART 2: Drop ALL existing overloads of entry function
-- This prevents HTTP 300 "multiple choices" errors
-- =====================================================
DROP FUNCTION IF EXISTS get_competition_entries_bypass_rls(text) CASCADE;
DROP FUNCTION IF EXISTS get_competition_entries_bypass_rls(uuid) CASCADE;
DROP FUNCTION IF EXISTS get_competition_entries_bypass_rls(text, text) CASCADE;

-- =====================================================
-- PART 3: Create single canonical entry function
-- =====================================================
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
  BEGIN
    comp_uuid := competition_identifier::uuid;
    comp_uid_text := competition_identifier;
  EXCEPTION WHEN invalid_text_representation THEN
    SELECT c.id, c.uid INTO comp_uuid, comp_uid_text
    FROM competitions c
    WHERE c.uid = competition_identifier
    LIMIT 1;
  END;

  IF comp_uuid IS NOT NULL AND comp_uid_text = competition_identifier THEN
    SELECT c.uid INTO comp_uid_text FROM competitions c WHERE c.id = comp_uuid LIMIT 1;
  END IF;

  RETURN QUERY
  -- Source 1: joincompetition table
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
    jc.competitionid = competition_identifier
    OR (comp_uuid IS NOT NULL AND jc.competitionid = comp_uuid::text)
    OR (comp_uid_text IS NOT NULL AND comp_uid_text != '' AND jc.competitionid = comp_uid_text)

  UNION ALL

  -- Source 2: tickets table (fallback)
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

GRANT EXECUTE ON FUNCTION get_competition_entries_bypass_rls(text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_competition_entries_bypass_rls(text) TO anon;
GRANT EXECUTE ON FUNCTION get_competition_entries_bypass_rls(text) TO service_role;

-- =====================================================
-- PART 4: Fix ticket availability function
-- This fixes available_count returning 0 when all tickets are available
-- =====================================================
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
  v_sold_count INTEGER := 0;
  v_available_count INTEGER := 0;
BEGIN
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

  BEGIN
    v_competition_uuid := competition_id_text::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
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

  -- Get sold tickets from joincompetition
  SELECT COALESCE(array_agg(DISTINCT ticket_num), ARRAY[]::INTEGER[])
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

  v_sold_tickets_jc := COALESCE(v_sold_tickets_jc, ARRAY[]::INTEGER[]);

  -- Get sold tickets from tickets table
  SELECT COALESCE(array_agg(DISTINCT ticket_number), ARRAY[]::INTEGER[])
  INTO v_sold_tickets_table
  FROM tickets
  WHERE competition_id = v_competition_uuid;

  v_sold_tickets_table := COALESCE(v_sold_tickets_table, ARRAY[]::INTEGER[]);

  v_unavailable_tickets := v_sold_tickets_jc || v_sold_tickets_table;

  -- Get pending reservations
  BEGIN
    SELECT COALESCE(array_agg(DISTINCT ticket_num), ARRAY[]::INTEGER[])
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

  v_pending_tickets := COALESCE(v_pending_tickets, ARRAY[]::INTEGER[]);
  v_unavailable_tickets := v_unavailable_tickets || v_pending_tickets;

  -- Remove duplicates
  IF array_length(v_unavailable_tickets, 1) IS NOT NULL AND array_length(v_unavailable_tickets, 1) > 0 THEN
    SELECT COALESCE(array_agg(DISTINCT u), ARRAY[]::INTEGER[])
    INTO v_unavailable_tickets
    FROM unnest(v_unavailable_tickets) AS u;
  ELSE
    v_unavailable_tickets := ARRAY[]::INTEGER[];
  END IF;

  -- Calculate counts
  v_sold_count := COALESCE(array_length(v_unavailable_tickets, 1), 0);
  v_available_count := GREATEST(0, v_total_tickets - v_sold_count);

  -- Generate available tickets array
  IF v_available_count > 0 THEN
    FOR v_ticket_num IN 1..v_total_tickets LOOP
      IF v_sold_count = 0 OR NOT (v_ticket_num = ANY(v_unavailable_tickets)) THEN
        v_available_tickets := array_append(v_available_tickets, v_ticket_num);
      END IF;
    END LOOP;
  END IF;

  RETURN json_build_object(
    'competition_id', v_competition_uuid,
    'total_tickets', v_total_tickets,
    'available_tickets', COALESCE(v_available_tickets, ARRAY[]::INTEGER[]),
    'sold_count', v_sold_count,
    'available_count', v_available_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_competition_ticket_availability_text(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_competition_ticket_availability_text(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_competition_ticket_availability_text(TEXT) TO service_role;

-- =====================================================
-- PART 5: Fix get_unavailable_tickets function
-- =====================================================
DROP FUNCTION IF EXISTS get_unavailable_tickets(text) CASCADE;
DROP FUNCTION IF EXISTS get_unavailable_tickets(uuid) CASCADE;

CREATE OR REPLACE FUNCTION get_unavailable_tickets(competition_id TEXT)
RETURNS int4[]
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_competition_uuid UUID;
  v_comp_uid TEXT;
  v_unavailable INTEGER[] := ARRAY[]::INTEGER[];
  v_sold_jc INTEGER[] := ARRAY[]::INTEGER[];
  v_sold_tickets INTEGER[] := ARRAY[]::INTEGER[];
  v_pending INTEGER[] := ARRAY[]::INTEGER[];
BEGIN
  BEGIN
    v_competition_uuid := competition_id::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    SELECT c.id, c.uid INTO v_competition_uuid, v_comp_uid
    FROM competitions c
    WHERE c.uid = competition_id
    LIMIT 1;

    IF v_competition_uuid IS NULL THEN
      RETURN ARRAY[]::INTEGER[];
    END IF;
  END;

  IF v_comp_uid IS NULL THEN
    SELECT c.uid INTO v_comp_uid
    FROM competitions c
    WHERE c.id = v_competition_uuid;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT ticket_num), ARRAY[]::INTEGER[])
  INTO v_sold_jc
  FROM (
    SELECT CAST(trim(unnest(string_to_array(ticketnumbers, ','))) AS integer) AS ticket_num
    FROM joincompetition
    WHERE (
      competitionid = v_competition_uuid::text
      OR (v_comp_uid IS NOT NULL AND competitionid = v_comp_uid)
      OR competitionid = competition_id
    )
      AND ticketnumbers IS NOT NULL
      AND trim(ticketnumbers) != ''
  ) AS jc_tickets
  WHERE ticket_num IS NOT NULL;

  v_sold_jc := COALESCE(v_sold_jc, ARRAY[]::INTEGER[]);

  SELECT COALESCE(array_agg(DISTINCT ticket_number), ARRAY[]::INTEGER[])
  INTO v_sold_tickets
  FROM tickets
  WHERE tickets.competition_id = v_competition_uuid;

  v_sold_tickets := COALESCE(v_sold_tickets, ARRAY[]::INTEGER[]);

  BEGIN
    SELECT COALESCE(array_agg(DISTINCT ticket_num), ARRAY[]::INTEGER[])
    INTO v_pending
    FROM (
      SELECT unnest(ticket_numbers) AS ticket_num
      FROM pending_tickets
      WHERE pending_tickets.competition_id = v_competition_uuid
        AND status = 'pending'
        AND expires_at > NOW()
    ) AS pending
    WHERE ticket_num IS NOT NULL;
  EXCEPTION WHEN undefined_table THEN
    v_pending := ARRAY[]::INTEGER[];
  END;

  v_pending := COALESCE(v_pending, ARRAY[]::INTEGER[]);
  v_unavailable := v_sold_jc || v_sold_tickets || v_pending;

  IF array_length(v_unavailable, 1) IS NOT NULL AND array_length(v_unavailable, 1) > 0 THEN
    SELECT COALESCE(array_agg(DISTINCT u), ARRAY[]::INTEGER[])
    INTO v_unavailable
    FROM unnest(v_unavailable) AS u;
  ELSE
    v_unavailable := ARRAY[]::INTEGER[];
  END IF;

  RETURN v_unavailable;
END;
$$;

GRANT EXECUTE ON FUNCTION get_unavailable_tickets(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_unavailable_tickets(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_unavailable_tickets(TEXT) TO service_role;

-- =====================================================
-- VERIFICATION: Check that everything is in place
-- =====================================================
DO $$
DECLARE
  func_count INTEGER;
  uid_column_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'competitions'
    AND column_name = 'uid'
  ) INTO uid_column_exists;

  SELECT COUNT(*) INTO func_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'get_competition_ticket_availability_text',
      'get_competition_entries_bypass_rls',
      'get_unavailable_tickets'
    );

  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'VERIFICATION RESULTS:';
  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'competitions.uid column exists: %', uid_column_exists;
  RAISE NOTICE 'Functions created: %', func_count;
  RAISE NOTICE '';
  RAISE NOTICE 'Expected: uid_column_exists = true, functions = 3';
  RAISE NOTICE '';
  RAISE NOTICE 'If you see this message, the script executed successfully!';
  RAISE NOTICE '=====================================================';
END $$;

COMMIT;

-- =====================================================
-- TEST: Run this separately to verify the fix works
-- =====================================================
-- Replace 'YOUR-COMPETITION-UUID' with an actual competition ID
--
-- SELECT * FROM get_competition_ticket_availability_text('YOUR-COMPETITION-UUID');
--
-- Expected: available_count should equal total_tickets when no tickets are sold
--
-- SELECT * FROM get_competition_entries_bypass_rls('YOUR-COMPETITION-UUID');
--
-- Expected: Should return entries if any exist
-- =====================================================
