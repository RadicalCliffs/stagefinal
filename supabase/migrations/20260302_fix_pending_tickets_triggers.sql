-- ============================================================================
-- Fix pending_tickets triggers: stale tickets_sold counter
-- ============================================================================
-- Problem:
--   The validate_pending_tickets() trigger checks competitions.tickets_sold
--   to determine availability. The update_tickets_sold_on_pending() trigger
--   increments tickets_sold on every pending_tickets INSERT. However, nothing
--   decrements tickets_sold when pending reservations are cancelled or expire.
--   Over time, tickets_sold drifts above the real sold count, causing the
--   validation trigger to reject legitimate reservation attempts with:
--     "Cannot create pending ticket for N tickets. Only M available."
--
-- Fix:
--   1. Replace validate_pending_tickets() to count actual sold and pending
--      tickets instead of relying on the stale tickets_sold column.
--   2. Replace update_tickets_sold_on_pending() to recalculate tickets_sold
--      from actual data instead of blindly incrementing.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. Fix the BEFORE INSERT validation trigger
-- ============================================================================
-- The RPC functions (allocate_lucky_dip_tickets_batch, reserve_lucky_dip)
-- already perform thorough availability checks before inserting. This trigger
-- is a safety net that should use accurate counts, not the stale counter.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.validate_pending_tickets()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
    v_total_tickets INT;
    v_comp_uid TEXT;
    v_sold_count INT;
    v_other_pending INT;
    v_available INT;
BEGIN
    -- Get competition details
    SELECT c.total_tickets, c.uid::TEXT
      INTO v_total_tickets, v_comp_uid
    FROM competitions c
    WHERE c.id = NEW.competition_id::UUID AND c.deleted = false
    FOR UPDATE;

    IF v_total_tickets IS NULL THEN
        RAISE EXCEPTION 'Competition not found: %', NEW.competition_id;
    END IF;

    -- Count actual sold tickets from confirmed entries
    -- (joincompetition stores competitionid as either id or uid text)
    SELECT COUNT(DISTINCT tn) INTO v_sold_count
    FROM (
        SELECT CAST(trim(unnest(string_to_array(jc.ticketnumbers, ','))) AS INTEGER) AS tn
        FROM joincompetition jc
        WHERE (jc.competitionid = NEW.competition_id OR jc.competitionid = v_comp_uid)
          AND jc.ticketnumbers IS NOT NULL
          AND trim(jc.ticketnumbers) != ''
        UNION
        SELECT t.ticket_number AS tn
        FROM tickets t
        WHERE t.competition_id = NEW.competition_id::UUID
          AND t.ticket_number IS NOT NULL
    ) sold;

    -- Count pending tickets from OTHER users (current user's old pending
    -- tickets are cancelled by the RPC before this INSERT)
    SELECT COALESCE(SUM(pt.ticket_count), 0) INTO v_other_pending
    FROM pending_tickets pt
    WHERE pt.competition_id = NEW.competition_id
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

-- ============================================================================
-- 2. Fix the AFTER INSERT counter update trigger
-- ============================================================================
-- Instead of blindly incrementing tickets_sold (which drifts when pending
-- reservations are cancelled/expired), recalculate from actual data.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_tickets_sold_on_pending()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
    v_actual_sold INT;
    v_comp_uid TEXT;
    v_pending_count INT;
BEGIN
    -- Get the uid for this competition (joincompetition may use either id or uid)
    SELECT uid::TEXT INTO v_comp_uid
    FROM competitions
    WHERE id = NEW.competition_id::UUID;

    -- Count actual sold tickets from confirmed entries
    SELECT COUNT(DISTINCT tn) INTO v_actual_sold
    FROM (
        SELECT CAST(trim(unnest(string_to_array(jc.ticketnumbers, ','))) AS INTEGER) AS tn
        FROM joincompetition jc
        WHERE (jc.competitionid = NEW.competition_id OR jc.competitionid = v_comp_uid)
          AND jc.ticketnumbers IS NOT NULL
          AND trim(jc.ticketnumbers) != ''
        UNION
        SELECT t.ticket_number AS tn
        FROM tickets t
        WHERE t.competition_id = NEW.competition_id::UUID
          AND t.ticket_number IS NOT NULL
    ) sold;

    -- Count all active pending tickets (including this new reservation)
    SELECT COALESCE(SUM(pt.ticket_count), 0) INTO v_pending_count
    FROM pending_tickets pt
    WHERE pt.competition_id = NEW.competition_id
      AND pt.status = 'pending'
      AND pt.expires_at > NOW();

    -- Update with accurate count (sold + pending) instead of blind increment
    UPDATE competitions
    SET tickets_sold = v_actual_sold + v_pending_count,
        updated_at = NOW()
    WHERE id = NEW.competition_id::UUID;

    RETURN NEW;
END;
$function$;

COMMIT;
