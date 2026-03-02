-- ============================================================================
-- COMPLETE FIX WITH VISIBLE OUTPUT
-- ============================================================================

-- Drop old functions and triggers
DROP FUNCTION IF EXISTS get_unavailable_tickets(TEXT) CASCADE;
DROP FUNCTION IF EXISTS get_unavailable_tickets(UUID) CASCADE;
DROP FUNCTION IF EXISTS get_competition_unavailable_tickets(TEXT) CASCADE;
DROP FUNCTION IF EXISTS get_competition_unavailable_tickets(UUID) CASCADE;
DROP TRIGGER IF EXISTS trg_validate_pending_tickets ON pending_tickets;
DROP FUNCTION IF EXISTS public.validate_pending_tickets() CASCADE;
DROP TRIGGER IF EXISTS trg_update_tickets_sold_on_pending ON pending_tickets;
DROP FUNCTION IF EXISTS public.update_tickets_sold_on_pending() CASCADE;

-- ============================================================================
-- FIX 1: get_unavailable_tickets - Remove recursion
-- ============================================================================

CREATE OR REPLACE FUNCTION get_unavailable_tickets(p_competition_id TEXT)
RETURNS INTEGER[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_competition_uuid UUID := NULL;
  v_comp_uid TEXT := NULL;
  v_result INTEGER[] := ARRAY[]::INTEGER[];
BEGIN
  IF p_competition_id IS NULL OR TRIM(p_competition_id) = '' THEN
    RETURN ARRAY[]::INTEGER[];
  END IF;

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

  IF v_comp_uid IS NULL THEN
    SELECT c.uid INTO v_comp_uid 
    FROM competitions c 
    WHERE c.id = v_competition_uuid;
  END IF;

  WITH all_tickets AS (
    SELECT CAST(TRIM(t_num) AS INTEGER) AS ticket_num
    FROM (
      SELECT unnest(string_to_array(ticketnumbers, ',')) AS t_num
      FROM joincompetition
      WHERE (competitionid = v_competition_uuid
        OR (v_comp_uid IS NOT NULL AND competitionid = v_comp_uid::UUID))
        AND ticketnumbers IS NOT NULL
        AND TRIM(ticketnumbers) != ''
    ) parsed
    WHERE TRIM(t_num) ~ '^[0-9]+$'
    
    UNION ALL
    
    SELECT ticket_number AS ticket_num
    FROM tickets
    WHERE competition_id = v_competition_uuid
      AND ticket_number IS NOT NULL
    
    UNION ALL
    
    SELECT unnest(ticket_numbers) AS ticket_num
    FROM pending_tickets
    WHERE competition_id = v_competition_uuid
      AND status IN ('pending', 'confirming')
      AND expires_at > NOW()
      AND ticket_numbers IS NOT NULL
  )
  SELECT COALESCE(array_agg(DISTINCT ticket_num ORDER BY ticket_num), ARRAY[]::INTEGER[])
  INTO v_result
  FROM all_tickets
  WHERE ticket_num IS NOT NULL AND ticket_num > 0;

  RETURN COALESCE(v_result, ARRAY[]::INTEGER[]);
END;
$$;

GRANT EXECUTE ON FUNCTION get_unavailable_tickets(TEXT) TO authenticated, anon, service_role;

-- ============================================================================
-- FIX 2: validate_pending_tickets - Fix UUID = TEXT comparison
-- ============================================================================

CREATE OR REPLACE FUNCTION public.validate_pending_tickets()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
    v_total_tickets INT;
    v_comp_id_uuid UUID;
    v_comp_uid TEXT;
    v_sold_count INT;
    v_other_pending INT;
    v_available INT;
BEGIN
    v_comp_id_uuid := NEW.competition_id;

    SELECT c.total_tickets, c.uid
      INTO v_total_tickets, v_comp_uid
    FROM competitions c
    WHERE c.id = v_comp_id_uuid 
      AND c.deleted = false
    FOR UPDATE;

    IF v_total_tickets IS NULL THEN
        RAISE EXCEPTION 'Competition not found: %', NEW.competition_id;
    END IF;

    SELECT COUNT(DISTINCT tn) INTO v_sold_count
    FROM (
        SELECT CAST(trim(unnest(string_to_array(jc.ticketnumbers, ','))) AS INTEGER) AS tn
        FROM joincompetition jc
        WHERE (jc.competitionid = v_comp_id_uuid
          OR (v_comp_uid IS NOT NULL AND jc.competitionid = v_comp_uid::UUID))
          AND jc.ticketnumbers IS NOT NULL
          AND trim(jc.ticketnumbers) != ''
        UNION
        SELECT t.ticket_number AS tn
        FROM tickets t
        WHERE t.competition_id = v_comp_id_uuid
          AND t.ticket_number IS NOT NULL
    ) sold;

    SELECT COALESCE(SUM(pt.ticket_count), 0) INTO v_other_pending
    FROM pending_tickets pt
    WHERE pt.competition_id = v_comp_id_uuid
      AND pt.status = 'pending'
      AND pt.expires_at > NOW()
      AND pt.user_id != NEW.user_id;

    v_available := v_total_tickets - v_sold_count - v_other_pending;

    IF NEW.ticket_count > v_available THEN
        RAISE EXCEPTION 'Cannot create pending ticket for % tickets. Only % available.',
            NEW.ticket_count, v_available;
    END IF;

    RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_validate_pending_tickets
BEFORE INSERT ON pending_tickets
FOR EACH ROW
EXECUTE FUNCTION validate_pending_tickets();

-- ============================================================================
-- FIX 3: update_tickets_sold_on_pending - Recalculate properly
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_tickets_sold_on_pending()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
    v_actual_sold INT;
    v_comp_id_uuid UUID;
    v_comp_uid TEXT;
    v_pending_count INT;
BEGIN
    v_comp_id_uuid := NEW.competition_id;
    
    SELECT uid INTO v_comp_uid
    FROM competitions
    WHERE id = v_comp_id_uuid;

    SELECT COUNT(DISTINCT tn) INTO v_actual_sold
    FROM (
        SELECT CAST(trim(unnest(string_to_array(jc.ticketnumbers, ','))) AS INTEGER) AS tn
        FROM joincompetition jc
        WHERE (jc.competitionid = v_comp_id_uuid
          OR (v_comp_uid IS NOT NULL AND jc.competitionid = v_comp_uid::UUID))
          AND jc.ticketnumbers IS NOT NULL
          AND trim(jc.ticketnumbers) != ''
        UNION
        SELECT t.ticket_number AS tn
        FROM tickets t
        WHERE t.competition_id = v_comp_id_uuid
          AND t.ticket_number IS NOT NULL
    ) sold;

    SELECT COALESCE(SUM(pt.ticket_count), 0) INTO v_pending_count
    FROM pending_tickets pt
    WHERE pt.competition_id = v_comp_id_uuid
      AND pt.status = 'pending'
      AND pt.expires_at > NOW();

    UPDATE competitions
    SET tickets_sold = v_actual_sold + v_pending_count,
        updated_at = NOW()
    WHERE id = v_comp_id_uuid;

    RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_update_tickets_sold_on_pending
AFTER INSERT ON pending_tickets
FOR EACH ROW
EXECUTE FUNCTION update_tickets_sold_on_pending();

-- ============================================================================
-- VERIFICATION QUERY - This will show you what got created
-- ============================================================================

SELECT 
    proname AS function_name,
    pg_get_function_arguments(oid) AS arguments,
    'FUNCTION CREATED' AS status
FROM pg_proc 
WHERE proname IN ('get_unavailable_tickets', 'validate_pending_tickets', 'update_tickets_sold_on_pending')
  AND pronamespace = 'public'::regnamespace
ORDER BY proname;
