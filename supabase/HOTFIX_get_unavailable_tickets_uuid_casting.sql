-- ============================================================================
-- HOTFIX: Fix get_unavailable_tickets UUID to TEXT casting errors
-- ============================================================================
-- This file can be manually applied via Supabase SQL Editor to immediately
-- fix the "operator does not exist: uuid = text" error (code 42883).
--
-- Apply this via:
-- 1. Supabase Dashboard → SQL Editor
-- 2. Copy and paste this entire file
-- 3. Click "Run"
--
-- OR via Supabase CLI:
-- supabase db execute -f supabase/HOTFIX_get_unavailable_tickets_uuid_casting.sql
-- ============================================================================

BEGIN;

-- Drop existing versions to recreate with proper casting
DROP FUNCTION IF EXISTS get_competition_unavailable_tickets(UUID) CASCADE;
DROP FUNCTION IF EXISTS get_competition_unavailable_tickets(TEXT) CASCADE;
DROP FUNCTION IF EXISTS get_unavailable_tickets(TEXT) CASCADE;

-- ============================================================================
-- Create get_competition_unavailable_tickets (UUID version) with proper casting
-- ============================================================================

CREATE OR REPLACE FUNCTION get_competition_unavailable_tickets(p_competition_id UUID)
RETURNS TABLE(ticket_number INTEGER, source TEXT)
LANGUAGE plpgsql
STABLE 
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_comp_uid TEXT;
  v_competition_id_text TEXT;
BEGIN
  -- Convert UUID to TEXT for comparisons with TEXT columns
  v_competition_id_text := p_competition_id::TEXT;
  
  -- Get the competition UID for legacy lookups
  SELECT uid INTO v_comp_uid
  FROM competitions
  WHERE id = p_competition_id;

  -- Return all unavailable tickets with their source
  RETURN QUERY

  -- From joincompetition (confirmed purchases)
  SELECT
    CAST(trim(t_num) AS INTEGER) AS ticket_number,
    'sold'::TEXT AS source
  FROM (
    SELECT unnest(string_to_array(ticketnumbers, ',')) AS t_num
    FROM joincompetition
    WHERE (
      competitionid = v_competition_id_text
      OR (v_comp_uid IS NOT NULL AND competitionid = v_comp_uid)
    )
    AND ticketnumbers IS NOT NULL
    AND trim(ticketnumbers) != ''
  ) jc_parsed
  WHERE trim(t_num) ~ '^[0-9]+$'

  UNION ALL

  -- From tickets table (competition_id is TEXT, not UUID)
  SELECT
    t.ticket_number,
    'sold'::TEXT AS source
  FROM tickets t
  WHERE t.competition_id = v_competition_id_text
    AND t.ticket_number IS NOT NULL

  UNION ALL

  -- From pending_ticket_items (using the correct table)
  -- NOTE: pending_tickets.ticket_numbers does NOT exist, use pending_ticket_items instead
  SELECT
    pti.ticket_number,
    'pending'::TEXT AS source
  FROM pending_ticket_items pti
  INNER JOIN pending_tickets pt ON pti.pending_ticket_id = pt.id
  WHERE pti.competition_id = v_competition_id_text
    AND pt.status IN ('pending', 'confirming')
    AND pt.expires_at > NOW()
    AND pti.ticket_number IS NOT NULL;
END;
$$;

-- ============================================================================
-- Create get_competition_unavailable_tickets (TEXT version)
-- Wrapper that converts TEXT to UUID and calls UUID version
-- ============================================================================

CREATE OR REPLACE FUNCTION get_competition_unavailable_tickets(p_competition_id TEXT)
RETURNS TABLE(ticket_number INTEGER, source TEXT)
LANGUAGE plpgsql
STABLE 
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uuid UUID;
BEGIN
  -- Try to cast to UUID
  BEGIN
    v_uuid := p_competition_id::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    -- If not a valid UUID, try to look up by uid
    SELECT c.id INTO v_uuid
    FROM competitions c
    WHERE c.uid = p_competition_id
    LIMIT 1;

    IF v_uuid IS NULL THEN
      RETURN; -- Return empty if not found
    END IF;
  END;

  RETURN QUERY SELECT * FROM get_competition_unavailable_tickets(v_uuid);
END;
$$;

-- ============================================================================
-- Create get_unavailable_tickets (TEXT version)
-- Production signature: Returns INTEGER[] (not TABLE)
-- This is the version used by frontend/PostgREST
-- ============================================================================

CREATE OR REPLACE FUNCTION get_unavailable_tickets(p_competition_id TEXT)
RETURNS INTEGER[]
LANGUAGE plpgsql
STABLE 
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_competition_uuid UUID;
  v_comp_uid TEXT;
  v_competition_id_text TEXT;
  v_unavailable INTEGER[] := ARRAY[]::INTEGER[];
  v_sold_jc INTEGER[] := ARRAY[]::INTEGER[];
  v_sold_tickets INTEGER[] := ARRAY[]::INTEGER[];
  v_pending INTEGER[] := ARRAY[]::INTEGER[];
BEGIN
  IF p_competition_id IS NULL OR TRIM(p_competition_id) = '' THEN 
    RETURN ARRAY[]::INTEGER[]; 
  END IF;
  
  -- Try to parse as UUID
  BEGIN 
    v_competition_uuid := p_competition_id::UUID;
    v_competition_id_text := v_competition_uuid::TEXT;
  EXCEPTION WHEN invalid_text_representation THEN
    SELECT c.id, c.uid INTO v_competition_uuid, v_comp_uid 
    FROM competitions c WHERE c.uid = p_competition_id LIMIT 1;
    IF v_competition_uuid IS NULL THEN 
      RETURN ARRAY[]::INTEGER[]; 
    END IF;
    v_competition_id_text := v_competition_uuid::TEXT;
  END;
  
  IF v_comp_uid IS NULL THEN 
    SELECT c.uid INTO v_comp_uid FROM competitions c WHERE c.id = v_competition_uuid; 
  END IF;

  -- Get tickets from joincompetition
  BEGIN 
    SELECT COALESCE(array_agg(DISTINCT ticket_num), ARRAY[]::INTEGER[]) INTO v_sold_jc
    FROM (
      SELECT CAST(TRIM(unnest(string_to_array(ticketnumbers::TEXT, ','))) AS INTEGER) AS ticket_num 
      FROM joincompetition
      WHERE (competitionid = v_competition_id_text OR (v_comp_uid IS NOT NULL AND competitionid = v_comp_uid) OR competitionid = p_competition_id)
      AND ticketnumbers IS NOT NULL AND TRIM(ticketnumbers::TEXT) != ''
    ) AS jc_tickets 
    WHERE ticket_num IS NOT NULL;
  EXCEPTION WHEN OTHERS THEN 
    v_sold_jc := ARRAY[]::INTEGER[]; 
  END;

  -- Get tickets from tickets table (competition_id is TEXT, not UUID)
  BEGIN 
    SELECT COALESCE(array_agg(DISTINCT t.ticket_number), ARRAY[]::INTEGER[]) INTO v_sold_tickets 
    FROM tickets t
    WHERE t.competition_id = v_competition_id_text
      OR (v_comp_uid IS NOT NULL AND t.competition_id = v_comp_uid)
      OR t.competition_id = p_competition_id;
  EXCEPTION WHEN OTHERS THEN 
    v_sold_tickets := ARRAY[]::INTEGER[]; 
  END;

  -- Get pending tickets from pending_ticket_items (NOT pending_tickets.ticket_numbers!)
  -- NOTE: pending_tickets table does not have a ticket_numbers column
  BEGIN 
    SELECT COALESCE(array_agg(DISTINCT pti.ticket_number), ARRAY[]::INTEGER[]) INTO v_pending 
    FROM pending_ticket_items pti
    INNER JOIN pending_tickets pt ON pti.pending_ticket_id = pt.id
    WHERE (pti.competition_id = v_competition_id_text 
      OR (v_comp_uid IS NOT NULL AND pti.competition_id = v_comp_uid)
      OR pti.competition_id = p_competition_id)
      AND pt.status IN ('pending', 'confirming') 
      AND pt.expires_at > NOW()
      AND pti.ticket_number IS NOT NULL;
  EXCEPTION WHEN OTHERS THEN 
    v_pending := ARRAY[]::INTEGER[]; 
  END;

  v_unavailable := COALESCE(v_sold_jc, ARRAY[]::INTEGER[]) || COALESCE(v_sold_tickets, ARRAY[]::INTEGER[]) || COALESCE(v_pending, ARRAY[]::INTEGER[]);
  
  IF array_length(v_unavailable, 1) IS NOT NULL AND array_length(v_unavailable, 1) > 0 THEN
    SELECT COALESCE(array_agg(DISTINCT u ORDER BY u), ARRAY[]::INTEGER[]) INTO v_unavailable 
    FROM unnest(v_unavailable) AS u WHERE u IS NOT NULL;
  ELSE 
    v_unavailable := ARRAY[]::INTEGER[]; 
  END IF;
  
  RETURN v_unavailable;
END;
$$;

-- ============================================================================
-- Grant permissions
-- ============================================================================

GRANT EXECUTE ON FUNCTION get_competition_unavailable_tickets(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_competition_unavailable_tickets(UUID) TO anon;
GRANT EXECUTE ON FUNCTION get_competition_unavailable_tickets(UUID) TO service_role;

GRANT EXECUTE ON FUNCTION get_competition_unavailable_tickets(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_competition_unavailable_tickets(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_competition_unavailable_tickets(TEXT) TO service_role;

GRANT EXECUTE ON FUNCTION get_unavailable_tickets(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_unavailable_tickets(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_unavailable_tickets(TEXT) TO service_role;

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON FUNCTION get_competition_unavailable_tickets(UUID) IS 
'Returns unavailable tickets for a competition with their source (sold/pending).
FIXED: UUID to TEXT casting to prevent "operator does not exist: uuid = text" errors.
FIXED: Uses pending_ticket_items table instead of non-existent pending_tickets.ticket_numbers column.';

COMMENT ON FUNCTION get_competition_unavailable_tickets(TEXT) IS 
'Text wrapper for get_competition_unavailable_tickets. Converts TEXT to UUID.';

COMMENT ON FUNCTION get_unavailable_tickets(TEXT) IS 
'Returns array of unavailable ticket numbers for a competition.
FIXED: UUID to TEXT casting to prevent "operator does not exist: uuid = text" errors.
FIXED: Uses pending_ticket_items table instead of non-existent pending_tickets.ticket_numbers column.';

-- ============================================================================
-- Verify functions were created
-- ============================================================================

DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM pg_proc 
  WHERE proname IN ('get_unavailable_tickets', 'get_competition_unavailable_tickets');
  
  IF v_count >= 3 THEN
    RAISE NOTICE '✅ All functions created successfully! (% functions found)', v_count;
  ELSE
    RAISE WARNING '⚠️  Expected at least 3 functions but found %', v_count;
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- Test the fix (Optional - uncomment to test)
-- ============================================================================

-- Test with a real competition ID (replace with actual ID)
-- SELECT get_unavailable_tickets('47354b08-8167-471e-959a-5fc114dcc532');

-- Expected result: Array of integers (may be empty if no tickets are unavailable)
-- Should NOT return: "operator does not exist: uuid = text" error
