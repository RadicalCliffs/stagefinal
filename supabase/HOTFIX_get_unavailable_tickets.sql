-- ============================================================================
-- HOTFIX: Create/Update get_unavailable_tickets function
-- ============================================================================
-- This file can be manually applied via Supabase SQL Editor to immediately
-- fix the 404 error for get_unavailable_tickets RPC function.
--
-- Apply this via:
-- 1. Supabase Dashboard → SQL Editor
-- 2. Copy and paste this entire file
-- 3. Click "Run"
--
-- OR via Supabase CLI:
-- supabase db execute -f supabase/HOTFIX_get_unavailable_tickets.sql
-- ============================================================================

-- Drop any existing versions (handles signature changes)
DROP FUNCTION IF EXISTS get_unavailable_tickets(TEXT) CASCADE;
DROP FUNCTION IF EXISTS get_unavailable_tickets(UUID) CASCADE;

-- Create the comprehensive version of the function
CREATE OR REPLACE FUNCTION get_unavailable_tickets(p_competition_id TEXT)
RETURNS INT4[]
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
  -- Handle NULL or empty input
  IF p_competition_id IS NULL OR TRIM(p_competition_id) = '' THEN
    RETURN ARRAY[]::INTEGER[];
  END IF;

  -- Parse UUID
  BEGIN
    v_competition_uuid := p_competition_id::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    SELECT c.id, c.uid INTO v_competition_uuid, v_comp_uid
    FROM competitions c
    WHERE c.uid = p_competition_id
    LIMIT 1;

    IF v_competition_uuid IS NULL THEN
      RETURN ARRAY[]::INTEGER[];
    END IF;
  END;

  -- Get uid if not already set
  IF v_comp_uid IS NULL THEN
    SELECT c.uid INTO v_comp_uid
    FROM competitions c
    WHERE c.id = v_competition_uuid;
  END IF;

  -- Get sold tickets from joincompetition (competitionid is TEXT)
  SELECT COALESCE(array_agg(DISTINCT ticket_num), ARRAY[]::INTEGER[])
  INTO v_sold_jc
  FROM (
    SELECT CAST(TRIM(unnest(string_to_array(ticketnumbers::TEXT, ','))) AS INTEGER) AS ticket_num
    FROM joincompetition
    WHERE (
      competitionid = v_competition_uuid::TEXT
      OR (v_comp_uid IS NOT NULL AND competitionid = v_comp_uid)
      OR competitionid = p_competition_id
    )
      AND ticketnumbers IS NOT NULL
      AND TRIM(ticketnumbers::TEXT) != ''
  ) AS jc_tickets
  WHERE ticket_num IS NOT NULL;

  v_sold_jc := COALESCE(v_sold_jc, ARRAY[]::INTEGER[]);

  -- Get sold tickets from tickets table (competition_id is TEXT in schema)
  BEGIN
    SELECT COALESCE(array_agg(DISTINCT t.ticket_number), ARRAY[]::INTEGER[])
    INTO v_sold_tickets
    FROM tickets t
    WHERE t.competition_id = p_competition_id
      OR t.competition_id = v_competition_uuid::TEXT
      OR (v_comp_uid IS NOT NULL AND t.competition_id = v_comp_uid);
  EXCEPTION WHEN OTHERS THEN
    v_sold_tickets := ARRAY[]::INTEGER[];
  END;

  v_sold_tickets := COALESCE(v_sold_tickets, ARRAY[]::INTEGER[]);

  -- Get pending tickets from pending_ticket_items (NOT pending_tickets!)
  BEGIN
    SELECT COALESCE(array_agg(DISTINCT pti.ticket_number), ARRAY[]::INTEGER[])
    INTO v_pending
    FROM pending_ticket_items pti
    INNER JOIN pending_tickets pt ON pti.pending_ticket_id = pt.id
    WHERE pti.competition_id = p_competition_id
      AND pt.status IN ('pending', 'confirming')
      AND pt.expires_at > NOW()
      AND pti.ticket_number IS NOT NULL;
  EXCEPTION WHEN undefined_table THEN
    -- If tables don't exist, return empty array
    v_pending := ARRAY[]::INTEGER[];
  END;

  v_pending := COALESCE(v_pending, ARRAY[]::INTEGER[]);

  -- Combine all unavailable tickets
  v_unavailable := v_sold_jc || v_sold_tickets || v_pending;

  -- Remove duplicates and sort
  IF array_length(v_unavailable, 1) IS NOT NULL AND array_length(v_unavailable, 1) > 0 THEN
    SELECT COALESCE(array_agg(DISTINCT u ORDER BY u), ARRAY[]::INTEGER[])
    INTO v_unavailable
    FROM unnest(v_unavailable) AS u
    WHERE u IS NOT NULL;
  ELSE
    v_unavailable := ARRAY[]::INTEGER[];
  END IF;

  RETURN v_unavailable;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_unavailable_tickets(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_unavailable_tickets(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_unavailable_tickets(TEXT) TO service_role;

-- Verify function was created
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc 
    WHERE proname = 'get_unavailable_tickets'
  ) THEN
    RAISE NOTICE '✅ get_unavailable_tickets function created successfully!';
  ELSE
    RAISE WARNING '⚠️  get_unavailable_tickets function was not created';
  END IF;
END $$;

COMMENT ON FUNCTION get_unavailable_tickets(TEXT) IS 
'Returns array of unavailable ticket numbers for a competition. 
Includes:
- Sold tickets from joincompetition.ticketnumbers
- Sold tickets from tickets.ticket_number
- Pending tickets from pending_ticket_items.ticket_number (joined with pending_tickets for validation)
Uses correct schema: pending_ticket_items, not pending_tickets.ticket_numbers';
