-- ============================================================================
-- ADD MISSING FUNCTION: check_and_mark_competition_sold_out
-- This is called by triggers on pending_tickets UPDATE
-- ============================================================================

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

  -- Count sold tickets from joincompetition (competitionid is UUID)
  SELECT COALESCE(COUNT(DISTINCT CAST(TRIM(t_num) AS INTEGER)), 0) INTO v_sold_count
  FROM (
    SELECT unnest(string_to_array(ticketnumbers, ',')) AS t_num
    FROM joincompetition
    WHERE competitionid = p_competition_id
      AND ticketnumbers IS NOT NULL
      AND TRIM(ticketnumbers) != ''
  ) parsed
  WHERE TRIM(t_num) ~ '^[0-9]+$';

  -- Count tickets from tickets table
  SELECT COALESCE(COUNT(*), 0) + v_sold_count INTO v_sold_count
  FROM tickets
  WHERE competition_id = p_competition_id;

  -- Count pending tickets
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

GRANT EXECUTE ON FUNCTION public.check_and_mark_competition_sold_out(UUID) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.check_and_mark_competition_sold_out(TEXT) TO authenticated, anon, service_role;

-- Verification
SELECT 
    proname AS function_name,
    pg_get_function_arguments(oid) AS arguments,
    'FUNCTION CREATED' AS status
FROM pg_proc 
WHERE proname = 'check_and_mark_competition_sold_out'
  AND pronamespace = 'public'::regnamespace
ORDER BY arguments;
