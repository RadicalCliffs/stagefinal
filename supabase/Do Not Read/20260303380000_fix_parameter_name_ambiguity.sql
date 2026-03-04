-- ============================================================================
-- FIX: Parameter name ambiguity in get_unavailable_tickets and get_competition_unavailable_tickets
-- Problem: Parameter named 'competition_id' conflicts with column name 'competition_id'
-- Solution: Rename parameter to 'p_competition_id' for clarity
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_unavailable_tickets(UUID) CASCADE;

CREATE OR REPLACE FUNCTION public.get_unavailable_tickets(p_competition_id UUID)
RETURNS INTEGER[]
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_sold_jc INTEGER[];
  v_sold_tickets INTEGER[];
  v_pending INTEGER[];
  v_all_unavailable INTEGER[];
BEGIN
  IF p_competition_id IS NULL THEN
    RETURN ARRAY[]::INTEGER[];
  END IF;

  -- joincompetition - use competition_id column NOT competitionid
  SELECT COALESCE(array_agg(DISTINCT ticket_num), ARRAY[]::INTEGER[])
  INTO v_sold_jc
  FROM (
    SELECT CAST(TRIM(unnest(string_to_array(ticketnumbers, ','))) AS INTEGER) AS ticket_num
    FROM joincompetition
    WHERE competition_id = p_competition_id
      AND ticketnumbers IS NOT NULL AND TRIM(ticketnumbers) != ''
  ) AS jc_tickets
  WHERE ticket_num IS NOT NULL;

  v_sold_jc := COALESCE(v_sold_jc, ARRAY[]::INTEGER[]);

  -- tickets table
  SELECT COALESCE(array_agg(DISTINCT t.ticket_number), ARRAY[]::INTEGER[])
  INTO v_sold_tickets
  FROM tickets t
  WHERE t.competition_id = p_competition_id AND t.ticket_number IS NOT NULL;

  v_sold_tickets := COALESCE(v_sold_tickets, ARRAY[]::INTEGER[]);

  -- pending_tickets
  SELECT COALESCE(array_agg(DISTINCT pnum), ARRAY[]::INTEGER[])
  INTO v_pending
  FROM (
    SELECT unnest(ticket_numbers) AS pnum
    FROM pending_tickets
    WHERE competition_id = p_competition_id
      AND status = 'pending'
      AND expires_at > NOW()
  ) AS pending_nums;

  v_pending := COALESCE(v_pending, ARRAY[]::INTEGER[]);

  v_all_unavailable := v_sold_jc || v_sold_tickets || v_pending;
  SELECT COALESCE(array_agg(DISTINCT u), ARRAY[]::INTEGER[]) INTO v_all_unavailable
  FROM unnest(v_all_unavailable) AS u WHERE u IS NOT NULL;

  RETURN COALESCE(v_all_unavailable, ARRAY[]::INTEGER[]);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_unavailable_tickets(UUID) TO authenticated, service_role, anon;

-- Force PostgREST schema reload
NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '========================================================';
  RAISE NOTICE 'FIXED: get_unavailable_tickets parameter ambiguity';
  RAISE NOTICE 'Parameter renamed to p_competition_id';
  RAISE NOTICE 'PostgREST reload signal sent';
  RAISE NOTICE '========================================================';
END $$;
