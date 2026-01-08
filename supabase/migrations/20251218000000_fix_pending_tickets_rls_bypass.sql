/*
  # Fix Pending Tickets RLS Permission Denied Error

  ## Problem:
  The client code in database.ts directly queries the pending_tickets table to get
  unavailable tickets for a competition. However, with Privy authentication, the
  Supabase client doesn't have proper auth tokens (auth.uid() is null), causing
  RLS policy violations:

    Error: permission denied for table pending_tickets

  ## Solution:
  1. Create an RPC function `get_unavailable_tickets_for_competition_bypass_rls` that
     combines sold tickets AND pending tickets in a single query with SECURITY DEFINER
     to bypass RLS.

  2. Grant execute permissions to both authenticated and anon roles.

  3. Also update the pending_tickets RLS policy to allow anonymous SELECT for
     competition-scoped queries (public information needed for ticket selection UI).
*/

-- ============================================================================
-- Part 1: Create RPC function to get all unavailable tickets (sold + pending)
-- ============================================================================

DROP FUNCTION IF EXISTS get_unavailable_tickets_for_competition_bypass_rls(text, text);

CREATE OR REPLACE FUNCTION get_unavailable_tickets_for_competition_bypass_rls(
  competition_identifier text,
  exclude_user_id text DEFAULT NULL
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
  comp_uuid uuid;
BEGIN
  -- Validate input
  IF competition_identifier IS NULL OR trim(competition_identifier) = '' THEN
    RETURN;
  END IF;

  -- Try to parse as UUID
  BEGIN
    comp_uuid := competition_identifier::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    -- Not a UUID, try to lookup by legacy uid field
    SELECT c.id INTO comp_uuid
    FROM competitions c
    WHERE c.uid = competition_identifier
    LIMIT 1;
  END;

  -- If no valid competition found, return empty
  IF comp_uuid IS NULL THEN
    RETURN;
  END IF;

  -- Return unavailable tickets from multiple sources
  RETURN QUERY

  -- Source 1: Sold tickets from joincompetition table (comma-separated string)
  SELECT DISTINCT
    CAST(trim(t_num) AS integer) as ticket_number,
    'sold'::text as source,
    NULL::timestamptz as expires_at
  FROM (
    SELECT unnest(string_to_array(jc.ticketnumbers, ',')) as t_num
    FROM joincompetition jc
    WHERE jc.competitionid = comp_uuid::text
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
  WHERE t.competition_id = comp_uuid

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
    WHERE pt.competition_id = comp_uuid
      AND pt.status = 'pending'
      AND pt.expires_at > NOW()
  ) pending
  WHERE
    -- If exclude_user_id is provided, exclude that user's reservations
    -- This is useful when making new reservations (user's old ones will be cancelled)
    (exclude_user_id IS NULL OR pending.pt_user_id != exclude_user_id)

  ORDER BY ticket_number;
END;
$$;

-- Grant permissions to both authenticated and anonymous users
-- This is public information needed for the ticket selection UI
GRANT EXECUTE ON FUNCTION get_unavailable_tickets_for_competition_bypass_rls(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_unavailable_tickets_for_competition_bypass_rls(text, text) TO anon;
GRANT EXECUTE ON FUNCTION get_unavailable_tickets_for_competition_bypass_rls(text, text) TO service_role;

COMMENT ON FUNCTION get_unavailable_tickets_for_competition_bypass_rls(text, text) IS
'Returns all unavailable tickets (sold + pending) for a competition, bypassing RLS.
Second parameter optionally excludes a specific user''s pending reservations.
This is needed because Privy auth doesn''t set auth.uid() which breaks RLS policies.';


-- ============================================================================
-- Part 2: Update pending_tickets RLS policy to allow public SELECT
-- for competition-scoped queries (needed for ticket grid display)
-- ============================================================================

-- Drop existing SELECT policy if it exists
DROP POLICY IF EXISTS "Users can view own pending tickets" ON pending_tickets;
DROP POLICY IF EXISTS "Public can view pending ticket counts" ON pending_tickets;
DROP POLICY IF EXISTS "Anyone can view pending tickets for availability" ON pending_tickets;

-- Create a more permissive SELECT policy that allows viewing pending tickets
-- for ticket availability checks (public information needed for competition UI)
-- This only allows SELECT, not INSERT/UPDATE/DELETE
CREATE POLICY "Anyone can view pending tickets for availability"
  ON pending_tickets FOR SELECT
  USING (true);

-- Ensure INSERT/UPDATE/DELETE is still restricted to service role
DROP POLICY IF EXISTS "Service role can manage pending tickets" ON pending_tickets;

CREATE POLICY "Service role can manage pending tickets"
  ON pending_tickets FOR ALL
  USING (auth.role() = 'service_role');

-- Also allow authenticated users to manage their own pending tickets via auth.jwt()
DROP POLICY IF EXISTS "Users can manage own pending tickets" ON pending_tickets;

CREATE POLICY "Users can manage own pending tickets"
  ON pending_tickets
  FOR ALL
  USING (
    auth.jwt() ->> 'sub' = user_id
  );


-- ============================================================================
-- Part 3: Create a simpler function for just getting pending ticket numbers
-- (useful for quick availability checks)
-- ============================================================================

DROP FUNCTION IF EXISTS get_pending_tickets_for_competition(uuid, text);

CREATE OR REPLACE FUNCTION get_pending_tickets_for_competition(
  p_competition_id uuid,
  p_exclude_user_id text DEFAULT NULL
)
RETURNS integer[]
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_result integer[];
BEGIN
  SELECT array_agg(DISTINCT pt_ticket)
  INTO v_result
  FROM (
    SELECT unnest(pt.ticket_numbers) as pt_ticket
    FROM pending_tickets pt
    WHERE pt.competition_id = p_competition_id
      AND pt.status = 'pending'
      AND pt.expires_at > NOW()
      AND (p_exclude_user_id IS NULL OR pt.user_id != p_exclude_user_id)
  ) pending;

  RETURN COALESCE(v_result, ARRAY[]::integer[]);
END;
$$;

GRANT EXECUTE ON FUNCTION get_pending_tickets_for_competition(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_pending_tickets_for_competition(uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION get_pending_tickets_for_competition(uuid, text) TO service_role;

COMMENT ON FUNCTION get_pending_tickets_for_competition(uuid, text) IS
'Returns array of pending ticket numbers for a competition, bypassing RLS.
Optionally excludes a specific user''s reservations.';


-- ============================================================================
-- Part 4: Grant SELECT on pending_tickets to anon (backup in case RLS still blocks)
-- ============================================================================

-- Ensure basic SELECT is granted
GRANT SELECT ON pending_tickets TO authenticated;
GRANT SELECT ON pending_tickets TO anon;


-- ============================================================================
-- Part 5: Create RPC function for fetching user's pending tickets (for identity.ts)
-- ============================================================================

DROP FUNCTION IF EXISTS get_user_pending_tickets_bypass_rls(text);

CREATE OR REPLACE FUNCTION get_user_pending_tickets_bypass_rls(
  user_identifier text
)
RETURNS TABLE (
  id uuid,
  user_id text,
  competition_id uuid,
  ticket_numbers integer[],
  ticket_count integer,
  ticket_price numeric,
  total_amount numeric,
  status text,
  session_id text,
  expires_at timestamptz,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF user_identifier IS NULL OR trim(user_identifier) = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    pt.id,
    pt.user_id,
    pt.competition_id,
    pt.ticket_numbers,
    pt.ticket_count,
    pt.ticket_price,
    pt.total_amount,
    pt.status,
    pt.session_id,
    pt.expires_at,
    pt.created_at
  FROM pending_tickets pt
  WHERE pt.user_id = user_identifier
    AND pt.status = 'pending'
    AND pt.expires_at > NOW()
  ORDER BY pt.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_user_pending_tickets_bypass_rls(text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_pending_tickets_bypass_rls(text) TO anon;
GRANT EXECUTE ON FUNCTION get_user_pending_tickets_bypass_rls(text) TO service_role;

COMMENT ON FUNCTION get_user_pending_tickets_bypass_rls(text) IS
'Returns pending ticket reservations for a user, bypassing RLS.';


-- ============================================================================
-- Part 6: Create RPC functions for pending_tickets INSERT/UPDATE operations
-- These are needed since RLS might block direct table access for Privy auth users
-- ============================================================================

-- Create pending ticket reservation (INSERT)
DROP FUNCTION IF EXISTS create_pending_ticket_reservation(text, uuid, integer[], numeric, uuid, timestamptz, text);

CREATE OR REPLACE FUNCTION create_pending_ticket_reservation(
  p_user_id text,
  p_competition_id uuid,
  p_ticket_numbers integer[],
  p_ticket_price numeric DEFAULT 1,
  p_reservation_id uuid DEFAULT gen_random_uuid(),
  p_expires_at timestamptz DEFAULT (NOW() + INTERVAL '10 minutes'),
  p_session_id text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO pending_tickets (
    id,
    user_id,
    competition_id,
    ticket_numbers,
    ticket_count,
    ticket_price,
    total_amount,
    status,
    session_id,
    expires_at,
    created_at,
    updated_at
  ) VALUES (
    p_reservation_id,
    p_user_id,
    p_competition_id,
    p_ticket_numbers,
    array_length(p_ticket_numbers, 1),
    p_ticket_price,
    p_ticket_price * array_length(p_ticket_numbers, 1),
    'pending',
    p_session_id,
    p_expires_at,
    NOW(),
    NOW()
  );

  RETURN p_reservation_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_pending_ticket_reservation(text, uuid, integer[], numeric, uuid, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION create_pending_ticket_reservation(text, uuid, integer[], numeric, uuid, timestamptz, text) TO anon;
GRANT EXECUTE ON FUNCTION create_pending_ticket_reservation(text, uuid, integer[], numeric, uuid, timestamptz, text) TO service_role;


-- Cancel user's existing pending reservations for a competition
DROP FUNCTION IF EXISTS cancel_user_pending_reservations(text, uuid);

CREATE OR REPLACE FUNCTION cancel_user_pending_reservations(
  p_user_id text,
  p_competition_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cancelled_count integer;
BEGIN
  UPDATE pending_tickets
  SET status = 'cancelled', updated_at = NOW()
  WHERE user_id = p_user_id
    AND competition_id = p_competition_id
    AND status = 'pending'
    AND expires_at > NOW();

  GET DIAGNOSTICS v_cancelled_count = ROW_COUNT;
  RETURN v_cancelled_count;
END;
$$;

GRANT EXECUTE ON FUNCTION cancel_user_pending_reservations(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION cancel_user_pending_reservations(text, uuid) TO anon;
GRANT EXECUTE ON FUNCTION cancel_user_pending_reservations(text, uuid) TO service_role;


-- Confirm pending ticket reservation
DROP FUNCTION IF EXISTS confirm_pending_ticket_reservation(uuid);

CREATE OR REPLACE FUNCTION confirm_pending_ticket_reservation(
  p_reservation_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE pending_tickets
  SET status = 'confirmed',
      confirmed_at = NOW(),
      updated_at = NOW()
  WHERE id = p_reservation_id
    AND status = 'pending';

  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION confirm_pending_ticket_reservation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION confirm_pending_ticket_reservation(uuid) TO anon;
GRANT EXECUTE ON FUNCTION confirm_pending_ticket_reservation(uuid) TO service_role;


-- Link reservation to transaction/session
DROP FUNCTION IF EXISTS link_pending_reservation_to_session(uuid, text);

CREATE OR REPLACE FUNCTION link_pending_reservation_to_session(
  p_reservation_id uuid,
  p_session_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE pending_tickets
  SET session_id = p_session_id,
      updated_at = NOW()
  WHERE id = p_reservation_id;

  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION link_pending_reservation_to_session(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION link_pending_reservation_to_session(uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION link_pending_reservation_to_session(uuid, text) TO service_role;


-- ============================================================================
-- Completion Notice
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '============================================================';
  RAISE NOTICE 'Pending Tickets RLS Bypass Migration Complete';
  RAISE NOTICE '============================================================';
  RAISE NOTICE 'Changes:';
  RAISE NOTICE '  - Created get_unavailable_tickets_for_competition_bypass_rls RPC';
  RAISE NOTICE '  - Created get_pending_tickets_for_competition RPC';
  RAISE NOTICE '  - Created get_user_pending_tickets_bypass_rls RPC';
  RAISE NOTICE '  - Created create_pending_ticket_reservation RPC';
  RAISE NOTICE '  - Created cancel_user_pending_reservations RPC';
  RAISE NOTICE '  - Created confirm_pending_ticket_reservation RPC';
  RAISE NOTICE '  - Created link_pending_reservation_to_session RPC';
  RAISE NOTICE '  - Updated RLS policy to allow public SELECT on pending_tickets';
  RAISE NOTICE '  - Granted SELECT on pending_tickets to anon role';
  RAISE NOTICE '============================================================';
END $$;
