/*
  # Fix Competition Winners View and Missing RPC Functions

  ## Problems Fixed:
  1. "column competition_winners.competitionid does not exist" - View was not properly created
  2. "Could not find the function public.get_user_tickets_for_competition" - RPC missing
  3. "Could not find the function public.get_unavailable_tickets_for_competition_bypass_rls" - RPC missing

  ## Solution:
  - Recreate competition_winners view as a TABLE (not view) for better RLS compatibility
  - Create all missing RPC functions with correct signatures
*/

-- ============================================================================
-- Part 1: Drop and recreate competition_winners as a MATERIALIZED VIEW or TABLE
-- ============================================================================

-- First check if competition_winners exists as a view and drop it
DROP VIEW IF EXISTS competition_winners CASCADE;

-- Now create competition_winners as a proper table with the expected columns
-- This approach avoids view permission issues with RLS
CREATE TABLE IF NOT EXISTS competition_winners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competitionprize text,
  "Winner" text,
  "crDate" timestamptz,
  competitionname text,
  imageurl text,
  competitionid text,
  txhash text,
  ticket_number integer,
  prize_distributed boolean,
  user_id uuid,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS on competition_winners
ALTER TABLE competition_winners ENABLE ROW LEVEL SECURITY;

-- Create permissive SELECT policy
DROP POLICY IF EXISTS "Anyone can view competition_winners" ON competition_winners;
CREATE POLICY "Anyone can view competition_winners"
  ON competition_winners FOR SELECT
  USING (true);

-- Grant permissions
GRANT SELECT ON competition_winners TO authenticated;
GRANT SELECT ON competition_winners TO anon;
GRANT SELECT ON competition_winners TO service_role;

-- Create a function to sync winners data to competition_winners table
CREATE OR REPLACE FUNCTION sync_competition_winners()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Clear existing data
  TRUNCATE competition_winners;

  -- Insert from winners table joined with competitions
  INSERT INTO competition_winners (
    id,
    competitionprize,
    "Winner",
    "crDate",
    competitionname,
    imageurl,
    competitionid,
    txhash,
    ticket_number,
    prize_distributed,
    user_id,
    created_at
  )
  SELECT
    w.id,
    c.prize_value::text,
    COALESCE(w.wallet_address, u.wallet_address),
    COALESCE(w.crdate, c.created_at),
    c.title,
    c.image_url,
    c.id::text,
    w.prize_tx_hash,
    w.ticket_number,
    COALESCE(w.prize_claimed, w.prize_distributed, false),
    w.user_id,
    COALESCE(w.crdate, c.created_at)
  FROM winners w
  LEFT JOIN competitions c ON w.competition_id = c.id
  LEFT JOIN users u ON w.user_id = u.id;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION sync_competition_winners() TO service_role;

-- Run initial sync
SELECT sync_competition_winners();

-- Create trigger to keep competition_winners in sync when winners changes
CREATE OR REPLACE FUNCTION trigger_sync_competition_winners()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- For simplicity, we'll just do an upsert for the affected row
  IF TG_OP = 'DELETE' THEN
    DELETE FROM competition_winners WHERE id = OLD.id;
    RETURN OLD;
  END IF;

  -- Insert or update the winner
  INSERT INTO competition_winners (
    id,
    competitionprize,
    "Winner",
    "crDate",
    competitionname,
    imageurl,
    competitionid,
    txhash,
    ticket_number,
    prize_distributed,
    user_id,
    created_at
  )
  SELECT
    NEW.id,
    c.prize_value::text,
    COALESCE(NEW.wallet_address, u.wallet_address),
    COALESCE(NEW.crdate, c.created_at),
    c.title,
    c.image_url,
    c.id::text,
    NEW.prize_tx_hash,
    NEW.ticket_number,
    COALESCE(NEW.prize_claimed, NEW.prize_distributed, false),
    NEW.user_id,
    COALESCE(NEW.crdate, c.created_at)
  FROM competitions c
  LEFT JOIN users u ON NEW.user_id = u.id
  WHERE c.id = NEW.competition_id
  ON CONFLICT (id) DO UPDATE SET
    competitionprize = EXCLUDED.competitionprize,
    "Winner" = EXCLUDED."Winner",
    "crDate" = EXCLUDED."crDate",
    competitionname = EXCLUDED.competitionname,
    imageurl = EXCLUDED.imageurl,
    competitionid = EXCLUDED.competitionid,
    txhash = EXCLUDED.txhash,
    ticket_number = EXCLUDED.ticket_number,
    prize_distributed = EXCLUDED.prize_distributed,
    user_id = EXCLUDED.user_id;

  RETURN NEW;
END;
$$;

-- Create trigger on winners table
DROP TRIGGER IF EXISTS sync_competition_winners_trigger ON winners;
CREATE TRIGGER sync_competition_winners_trigger
  AFTER INSERT OR UPDATE OR DELETE ON winners
  FOR EACH ROW
  EXECUTE FUNCTION trigger_sync_competition_winners();


-- ============================================================================
-- Part 2: Create get_user_tickets_for_competition RPC function
-- ============================================================================

DROP FUNCTION IF EXISTS get_user_tickets_for_competition(text, text);

CREATE OR REPLACE FUNCTION get_user_tickets_for_competition(
  p_user_id text,
  p_competition_id text
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_comp_uuid uuid;
  v_tickets integer[];
  v_ticket_count integer;
BEGIN
  -- Validate inputs
  IF p_user_id IS NULL OR trim(p_user_id) = '' OR p_competition_id IS NULL OR trim(p_competition_id) = '' THEN
    RETURN json_build_object(
      'user_id', p_user_id,
      'competition_id', p_competition_id,
      'tickets', ARRAY[]::integer[],
      'ticket_count', 0
    );
  END IF;

  -- Try to parse competition_id as UUID
  BEGIN
    v_comp_uuid := p_competition_id::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    -- Not a UUID, try legacy uid lookup
    SELECT c.id INTO v_comp_uuid
    FROM competitions c
    WHERE c.uid = p_competition_id
    LIMIT 1;
  END;

  -- If no valid competition found, return empty result
  IF v_comp_uuid IS NULL THEN
    RETURN json_build_object(
      'user_id', p_user_id,
      'competition_id', p_competition_id,
      'tickets', ARRAY[]::integer[],
      'ticket_count', 0
    );
  END IF;

  -- Get tickets from multiple sources
  WITH all_tickets AS (
    -- Source 1: joincompetition table (comma-separated ticketnumbers)
    SELECT DISTINCT CAST(trim(t_num) AS integer) AS ticket_num
    FROM (
      SELECT unnest(string_to_array(jc.ticketnumbers, ',')) AS t_num
      FROM joincompetition jc
      WHERE jc.competitionid = v_comp_uuid::text
        AND (
          jc.privy_user_id = p_user_id
          OR jc.wallet_address = p_user_id
          OR jc.userid = p_user_id
        )
        AND jc.ticketnumbers IS NOT NULL
        AND trim(jc.ticketnumbers) != ''
    ) jc_tickets
    WHERE trim(t_num) ~ '^[0-9]+$'

    UNION

    -- Source 2: tickets table
    SELECT DISTINCT t.ticket_number AS ticket_num
    FROM tickets t
    WHERE t.competition_id = v_comp_uuid
      AND (
        t.privy_user_id = p_user_id
        OR t.user_id::text = p_user_id
        OR t.wallet_address = p_user_id
      )

    UNION

    -- Source 3: pending_tickets table (confirmed reservations)
    SELECT DISTINCT pt_ticket AS ticket_num
    FROM (
      SELECT unnest(pt.ticket_numbers) AS pt_ticket
      FROM pending_tickets pt
      WHERE pt.competition_id = v_comp_uuid
        AND pt.user_id = p_user_id
        AND pt.status IN ('confirmed', 'completed')
    ) pending
  )
  SELECT array_agg(ticket_num ORDER BY ticket_num), count(*)::integer
  INTO v_tickets, v_ticket_count
  FROM all_tickets;

  -- Return result as JSON
  RETURN json_build_object(
    'user_id', p_user_id,
    'competition_id', p_competition_id,
    'tickets', COALESCE(v_tickets, ARRAY[]::integer[]),
    'ticket_count', COALESCE(v_ticket_count, 0)
  );
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_user_tickets_for_competition(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_tickets_for_competition(text, text) TO anon;
GRANT EXECUTE ON FUNCTION get_user_tickets_for_competition(text, text) TO service_role;

COMMENT ON FUNCTION get_user_tickets_for_competition(text, text) IS
'Returns user''s tickets for a specific competition from joincompetition, tickets, and pending_tickets tables.
Bypasses RLS using SECURITY DEFINER for Privy auth compatibility.';


-- ============================================================================
-- Part 3: Create get_unavailable_tickets_for_competition_bypass_rls RPC function
-- ============================================================================

DROP FUNCTION IF EXISTS get_unavailable_tickets_for_competition_bypass_rls(text, text);

CREATE OR REPLACE FUNCTION get_unavailable_tickets_for_competition_bypass_rls(
  p_competition_identifier text,
  p_exclude_user_id text DEFAULT NULL
)
RETURNS TABLE (
  ticket_number integer,
  source text,
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_comp_uuid uuid;
  v_comp_uid_legacy text;
BEGIN
  -- Validate input
  IF p_competition_identifier IS NULL OR trim(p_competition_identifier) = '' THEN
    RETURN;
  END IF;

  -- Try to parse as UUID
  BEGIN
    v_comp_uuid := p_competition_identifier::uuid;
    -- Also get the legacy uid for this competition
    SELECT c.uid INTO v_comp_uid_legacy
    FROM competitions c
    WHERE c.id = v_comp_uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    -- Not a UUID, try to lookup by legacy uid field
    SELECT c.id, c.uid INTO v_comp_uuid, v_comp_uid_legacy
    FROM competitions c
    WHERE c.uid = p_competition_identifier
    LIMIT 1;
  END;

  -- If no valid competition found, return empty
  IF v_comp_uuid IS NULL THEN
    RETURN;
  END IF;

  -- Return unavailable tickets from multiple sources
  RETURN QUERY

  -- Source 1: Sold tickets from joincompetition table (comma-separated string)
  -- Check BOTH UUID (as text) AND legacy uid
  SELECT DISTINCT
    CAST(trim(t_num) AS integer) as ticket_number,
    'sold'::text as source,
    NULL::timestamptz as expires_at
  FROM (
    SELECT unnest(string_to_array(jc.ticketnumbers, ',')) as t_num
    FROM joincompetition jc
    WHERE (
      jc.competitionid = v_comp_uuid::text
      OR (v_comp_uid_legacy IS NOT NULL AND jc.competitionid = v_comp_uid_legacy)
    )
      AND jc.ticketnumbers IS NOT NULL
      AND trim(jc.ticketnumbers) != ''
  ) jc_tickets
  WHERE trim(t_num) ~ '^[0-9]+$'  -- Only valid integers

  UNION ALL

  -- Source 2: Sold tickets from tickets table
  SELECT DISTINCT
    t.ticket_number,
    'sold'::text as source,
    NULL::timestamptz as expires_at
  FROM tickets t
  WHERE t.competition_id = v_comp_uuid

  UNION ALL

  -- Source 3: Pending tickets from pending_tickets table (excluding specified user if provided)
  SELECT DISTINCT
    pt_ticket as ticket_number,
    'pending'::text as source,
    pt_expires as expires_at
  FROM (
    SELECT
      unnest(pt.ticket_numbers) as pt_ticket,
      pt.expires_at as pt_expires,
      pt.user_id as pt_user_id
    FROM pending_tickets pt
    WHERE pt.competition_id = v_comp_uuid
      AND pt.status = 'pending'
      AND pt.expires_at > NOW()
  ) pending
  WHERE
    -- If p_exclude_user_id is provided, exclude that user's reservations
    (p_exclude_user_id IS NULL OR pending.pt_user_id != p_exclude_user_id)

  ORDER BY ticket_number;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_unavailable_tickets_for_competition_bypass_rls(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_unavailable_tickets_for_competition_bypass_rls(text, text) TO anon;
GRANT EXECUTE ON FUNCTION get_unavailable_tickets_for_competition_bypass_rls(text, text) TO service_role;

COMMENT ON FUNCTION get_unavailable_tickets_for_competition_bypass_rls(text, text) IS
'Returns all unavailable tickets (sold + pending) for a competition, bypassing RLS.
Second parameter optionally excludes a specific user''s pending reservations.';


-- ============================================================================
-- Part 4: Fix tickets table RLS for SELECT operations
-- ============================================================================

-- Drop existing problematic policies
DROP POLICY IF EXISTS "Public can view tickets" ON tickets;
DROP POLICY IF EXISTS "Anyone can view tickets for availability" ON tickets;
DROP POLICY IF EXISTS "Users can view own tickets" ON tickets;

-- Create permissive SELECT policy for tickets
CREATE POLICY "Anyone can view tickets for availability"
  ON tickets FOR SELECT
  USING (true);

-- Ensure tickets table has RLS enabled but allows SELECT
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;

-- Grant SELECT on tickets to all roles
GRANT SELECT ON tickets TO authenticated;
GRANT SELECT ON tickets TO anon;


-- ============================================================================
-- Completion Notice
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '============================================================';
  RAISE NOTICE 'Competition Winners Table and RPCs Migration Complete';
  RAISE NOTICE '============================================================';
  RAISE NOTICE 'Changes:';
  RAISE NOTICE '  - Created competition_winners TABLE (not view) with all expected columns';
  RAISE NOTICE '  - Added sync function and trigger to keep data in sync with winners table';
  RAISE NOTICE '  - Created get_user_tickets_for_competition RPC with correct signature';
  RAISE NOTICE '  - Created get_unavailable_tickets_for_competition_bypass_rls RPC';
  RAISE NOTICE '  - Fixed tickets table RLS policies';
  RAISE NOTICE '============================================================';
END $$;
