-- ============================================================================
-- FIX: check_and_mark_competition_sold_out Double Counting Bug
-- ============================================================================
-- The function was adding joincompetition count + tickets count, causing
-- double counting and premature sold_out marking.
-- 
-- FIX: Only count from tickets table (the canonical source) + pending tickets
-- ============================================================================

BEGIN;

-- Drop existing functions
DROP FUNCTION IF EXISTS public.check_and_mark_competition_sold_out(UUID);
DROP FUNCTION IF EXISTS public.check_and_mark_competition_sold_out(TEXT);

-- Create UUID version (for triggers since pending_tickets.competition_id is UUID)
CREATE OR REPLACE FUNCTION public.check_and_mark_competition_sold_out(p_competition_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_tickets INTEGER;
  v_sold_count INTEGER;
  v_pending_count INTEGER;
  v_is_sold_out BOOLEAN := FALSE;
BEGIN
  IF p_competition_id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Get competition total tickets
  SELECT total_tickets INTO v_total_tickets
  FROM competitions
  WHERE id = p_competition_id;

  IF v_total_tickets IS NULL THEN
    RETURN FALSE;
  END IF;

  -- FIX: Only count from tickets table (canonical source for sold tickets)
  -- Do NOT add joincompetition count as it causes double counting
  SELECT COALESCE(COUNT(*), 0) INTO v_sold_count
  FROM tickets
  WHERE competition_id = p_competition_id;

  -- Count active pending reservations
  SELECT COALESCE(SUM(ticket_count), 0) INTO v_pending_count
  FROM pending_tickets
  WHERE competition_id = p_competition_id
    AND status = 'pending'
    AND expires_at > NOW();

  -- Check if sold out (sold + pending >= total)
  IF (v_sold_count + v_pending_count) >= v_total_tickets THEN
    v_is_sold_out := TRUE;

    -- Update competition status to sold_out
    UPDATE competitions
    SET status = 'sold_out',
        updated_at = NOW()
    WHERE id = p_competition_id
      AND status NOT IN ('sold_out', 'drawn', 'completed', 'cancelled');
  END IF;

  RETURN v_is_sold_out;
END;
$$;

-- Create TEXT version (for RPC calls that pass TEXT)
CREATE OR REPLACE FUNCTION public.check_and_mark_competition_sold_out(p_competition_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_competition_uuid UUID;
BEGIN
  IF p_competition_id IS NULL OR TRIM(p_competition_id) = '' THEN
    RETURN FALSE;
  END IF;

  -- Convert TEXT to UUID
  BEGIN
    v_competition_uuid := p_competition_id::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    -- Try to find by uid column if not a valid UUID
    SELECT id INTO v_competition_uuid
    FROM competitions
    WHERE uid = p_competition_id
    LIMIT 1;

    IF v_competition_uuid IS NULL THEN
      RETURN FALSE;
    END IF;
  END;

  -- Call the UUID version
  RETURN check_and_mark_competition_sold_out(v_competition_uuid);
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.check_and_mark_competition_sold_out(UUID) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.check_and_mark_competition_sold_out(TEXT) TO authenticated, anon, service_role;

-- ============================================================================
-- FIX: Reset the incorrectly marked competition
-- ============================================================================

-- Reset competition 799a8e12-38f2-4989-ad24-15c995d673a6 from sold_out to active
UPDATE competitions
SET status = 'active',
    updated_at = NOW()
WHERE id = '799a8e12-38f2-4989-ad24-15c995d673a6'
  AND status = 'sold_out';

-- Verify the fix
DO $$
DECLARE
  v_comp_status TEXT;
  v_tickets_sold INTEGER;
  v_total_tickets INTEGER;
BEGIN
  SELECT status, tickets_sold, total_tickets 
  INTO v_comp_status, v_tickets_sold, v_total_tickets
  FROM competitions
  WHERE id = '799a8e12-38f2-4989-ad24-15c995d673a6';
  
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Competition Status After Fix:';
  RAISE NOTICE '  Status: %', v_comp_status;
  RAISE NOTICE '  Tickets sold: % / %', v_tickets_sold, v_total_tickets;
  RAISE NOTICE '  Remaining: %', v_total_tickets - v_tickets_sold;
  RAISE NOTICE '=================================================================';
END $$;

COMMIT;
