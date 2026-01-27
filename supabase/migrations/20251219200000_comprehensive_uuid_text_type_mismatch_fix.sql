/*
  # Comprehensive UUID-TEXT Type Mismatch Fix for Competition ID Lookups

  ## Background:
  The database schema has a type mismatch situation:
  - competitions.id is stored as TEXT (containing UUID strings)
  - joincompetition.competitionid is TEXT (can contain UUID string or legacy uid)
  - RPC function parameters accept UUID type

  This caused "operator does not exist: uuid = text" errors when PostgreSQL
  couldn't implicitly compare UUID parameters with TEXT columns.

  ## Solution:
  All affected functions have been updated to cast `p_competition_id::text` when
  comparing against competitions.id, and maintain TEXT-only comparisons where
  joincompetition.competitionid is TEXT.

  ## Functions Fixed:
  1. get_joincompetition_entries_for_competition(uuid)
     - WHERE c.id = p_competition_id::text
     - jc.competitionid = p_competition_id::text (TEXT-only comparison)

  2. count_sold_tickets_for_competition(uuid)
     - WHERE c.id = p_competition_id::text

  3. check_joincompetition_entry_exists(uuid, text)
     - WHERE c.id = p_competition_id::text

  4. get_competition_ticket_availability(uuid)
     - Existence/lookup uses WHERE id = p_competition_id::text
     - joincompetition checks remain TEXT-only
     - tickets/pending_tickets continue using UUID where appropriate

  ## Validation:
  All CREATE OR REPLACE completed without errors.
  These patches remove the uuid = text comparison in the competitions lookup path.

  This migration documents the comprehensive fix applied to resolve all
  UUID-TEXT type mismatch issues in competition-related RPC functions.
*/

-- Re-create all affected functions with the ::text cast fix to ensure consistency

-- ============================================================================
-- 1. get_joincompetition_entries_for_competition
-- ============================================================================
DROP FUNCTION IF EXISTS get_joincompetition_entries_for_competition(UUID);

CREATE OR REPLACE FUNCTION get_joincompetition_entries_for_competition(
    p_competition_id UUID
)
RETURNS TABLE (
    uid TEXT,
    competitionid TEXT,
    userid TEXT,
    numberoftickets INTEGER,
    ticketnumbers TEXT,
    amountspent DECIMAL,
    wallet_address TEXT,
    chain TEXT,
    transactionhash TEXT,
    purchasedate TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
    v_comp_uid TEXT;
BEGIN
    -- Cast p_competition_id to TEXT since competitions.id is TEXT type
    SELECT c.uid INTO v_comp_uid
    FROM competitions c
    WHERE c.id = p_competition_id::text;

    RETURN QUERY
    SELECT
        jc.uid,
        jc.competitionid,
        jc.userid,
        jc.numberoftickets,
        jc.ticketnumbers,
        jc.amountspent,
        jc.wallet_address,
        jc.chain,
        jc.transactionhash,
        jc.purchasedate
    FROM joincompetition jc
    WHERE jc.competitionid = p_competition_id::text
       OR (v_comp_uid IS NOT NULL AND jc.competitionid = v_comp_uid);
END;
$$;

-- ============================================================================
-- 2. count_sold_tickets_for_competition
-- ============================================================================
DROP FUNCTION IF EXISTS count_sold_tickets_for_competition(UUID);

CREATE OR REPLACE FUNCTION count_sold_tickets_for_competition(
    p_competition_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_comp_uid TEXT;
    v_total INTEGER := 0;
BEGIN
    -- Cast p_competition_id to TEXT since competitions.id is TEXT type
    SELECT c.uid INTO v_comp_uid
    FROM competitions c
    WHERE c.id = p_competition_id::text;

    SELECT COALESCE(SUM(
        ARRAY_LENGTH(
            STRING_TO_ARRAY(NULLIF(TRIM(jc.ticketnumbers), ''), ','),
            1
        )
    ), 0)
    INTO v_total
    FROM joincompetition jc
    WHERE (jc.competitionid = p_competition_id::text
       OR (v_comp_uid IS NOT NULL AND jc.competitionid = v_comp_uid))
      AND jc.ticketnumbers IS NOT NULL
      AND TRIM(jc.ticketnumbers) != '';

    RETURN v_total;
END;
$$;

-- ============================================================================
-- 3. check_joincompetition_entry_exists
-- ============================================================================
DROP FUNCTION IF EXISTS check_joincompetition_entry_exists(UUID, TEXT);

CREATE OR REPLACE FUNCTION check_joincompetition_entry_exists(
    p_competition_id UUID,
    p_transaction_hash TEXT
)
RETURNS TABLE (
    uid TEXT,
    ticketnumbers TEXT,
    numberoftickets INTEGER,
    amountspent DECIMAL
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_comp_uid TEXT;
BEGIN
    -- Cast p_competition_id to TEXT since competitions.id is TEXT type
    SELECT c.uid INTO v_comp_uid
    FROM competitions c
    WHERE c.id = p_competition_id::text;

    RETURN QUERY
    SELECT
        jc.uid,
        jc.ticketnumbers,
        jc.numberoftickets,
        jc.amountspent
    FROM joincompetition jc
    WHERE (jc.competitionid = p_competition_id::text
       OR (v_comp_uid IS NOT NULL AND jc.competitionid = v_comp_uid))
      AND jc.transactionhash = p_transaction_hash
    LIMIT 1;
END;
$$;

-- ============================================================================
-- 4. get_competition_ticket_availability
-- ============================================================================
DROP FUNCTION IF EXISTS get_competition_ticket_availability(uuid);

CREATE OR REPLACE FUNCTION get_competition_ticket_availability(p_competition_id uuid)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_total_tickets INTEGER;
  v_competition_exists BOOLEAN;
  v_comp_uid TEXT;
  v_sold_tickets_jc INTEGER[] := ARRAY[]::INTEGER[];
  v_sold_tickets_table INTEGER[] := ARRAY[]::INTEGER[];
  v_pending_tickets INTEGER[] := ARRAY[]::INTEGER[];
  v_unavailable_tickets INTEGER[] := ARRAY[]::INTEGER[];
  v_available_tickets INTEGER[] := ARRAY[]::INTEGER[];
  v_ticket_num INTEGER;
  v_result JSON;
BEGIN
  -- Check if competition exists and get total tickets and legacy uid
  -- Cast p_competition_id to TEXT since competitions.id is TEXT type
  SELECT
    EXISTS(SELECT 1 FROM competitions WHERE id = p_competition_id::text),
    COALESCE(total_tickets, 1000),
    uid
  INTO v_competition_exists, v_total_tickets, v_comp_uid
  FROM competitions
  WHERE id = p_competition_id::text;

  IF NOT v_competition_exists THEN
    RETURN json_build_object(
      'competition_id', p_competition_id,
      'total_tickets', 0,
      'available_tickets', ARRAY[]::INTEGER[],
      'sold_count', 0,
      'available_count', 0,
      'error', 'Competition not found'
    );
  END IF;

  -- Get sold tickets from joincompetition table (comma-separated string format)
  -- TEXT-only comparison: competitionid is TEXT
  SELECT array_agg(DISTINCT ticket_num)
  INTO v_sold_tickets_jc
  FROM (
    SELECT CAST(trim(unnest(string_to_array(ticketnumbers, ','))) AS integer) AS ticket_num
    FROM joincompetition
    WHERE (
      competitionid = p_competition_id::text
      OR (v_comp_uid IS NOT NULL AND competitionid = v_comp_uid)
    )
      AND ticketnumbers IS NOT NULL
      AND trim(ticketnumbers) != ''
  ) AS jc_tickets
  WHERE ticket_num IS NOT NULL;

  -- Also get sold tickets from tickets table (UUID comparison is fine here)
  SELECT array_agg(DISTINCT ticket_number)
  INTO v_sold_tickets_table
  FROM tickets
  WHERE competition_id = p_competition_id;

  -- Merge sold tickets from both tables
  v_unavailable_tickets := COALESCE(v_sold_tickets_jc, ARRAY[]::INTEGER[]) || COALESCE(v_sold_tickets_table, ARRAY[]::INTEGER[]);

  -- Get pending reservations that haven't expired (UUID comparison is fine here)
  SELECT array_agg(DISTINCT ticket_num)
  INTO v_pending_tickets
  FROM (
    SELECT unnest(ticket_numbers) AS ticket_num
    FROM pending_tickets
    WHERE competition_id = p_competition_id
      AND status = 'pending'
      AND expires_at > NOW()
  ) AS pending
  WHERE ticket_num IS NOT NULL;

  -- Add pending tickets to unavailable
  v_unavailable_tickets := v_unavailable_tickets || COALESCE(v_pending_tickets, ARRAY[]::INTEGER[]);

  -- Remove duplicates from unavailable
  SELECT array_agg(DISTINCT u) INTO v_unavailable_tickets FROM unnest(v_unavailable_tickets) AS u;

  -- Generate available tickets (1 to total_tickets, excluding unavailable)
  FOR v_ticket_num IN 1..v_total_tickets LOOP
    IF NOT (v_ticket_num = ANY(COALESCE(v_unavailable_tickets, ARRAY[]::INTEGER[]))) THEN
      v_available_tickets := array_append(v_available_tickets, v_ticket_num);
    END IF;
  END LOOP;

  -- Build and return result
  RETURN json_build_object(
    'competition_id', p_competition_id,
    'total_tickets', v_total_tickets,
    'available_tickets', COALESCE(v_available_tickets, ARRAY[]::INTEGER[]),
    'sold_count', COALESCE(array_length(v_unavailable_tickets, 1), 0),
    'available_count', COALESCE(array_length(v_available_tickets, 1), v_total_tickets)
  );
END;
$$;

-- ============================================================================
-- Grant execute permissions
-- ============================================================================
GRANT EXECUTE ON FUNCTION get_joincompetition_entries_for_competition(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_joincompetition_entries_for_competition(UUID) TO anon;
GRANT EXECUTE ON FUNCTION get_joincompetition_entries_for_competition(UUID) TO service_role;

GRANT EXECUTE ON FUNCTION count_sold_tickets_for_competition(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION count_sold_tickets_for_competition(UUID) TO anon;
GRANT EXECUTE ON FUNCTION count_sold_tickets_for_competition(UUID) TO service_role;

GRANT EXECUTE ON FUNCTION check_joincompetition_entry_exists(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION check_joincompetition_entry_exists(UUID, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION check_joincompetition_entry_exists(UUID, TEXT) TO service_role;

GRANT EXECUTE ON FUNCTION get_competition_ticket_availability(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_competition_ticket_availability(uuid) TO anon;
GRANT EXECUTE ON FUNCTION get_competition_ticket_availability(uuid) TO service_role;
