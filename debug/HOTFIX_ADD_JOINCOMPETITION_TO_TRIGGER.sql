-- ==============================================================================
-- HOTFIX: Add joincompetition entry creation to ticket confirmation trigger
-- 
-- ROOT CAUSE: Tickets are created but joincompetition entries are NOT
-- This causes the landing page live activity to be frozen
-- ==============================================================================

-- Drop and recreate the trigger function with joincompetition creation
CREATE OR REPLACE FUNCTION public.trg_fn_confirm_pending_tickets()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  tnum int;
  v_competition_uuid UUID;
  v_ticket_csv TEXT;
  v_ticket_count INT;
  v_total_amount NUMERIC;
  v_join_id UUID;
BEGIN
  IF (TG_OP = 'UPDATE') AND (OLD.confirmed_at IS NULL) AND (NEW.confirmed_at IS NOT NULL) THEN
    -- Cast TEXT competition_id to UUID for tickets table
    BEGIN
      v_competition_uuid := NEW.competition_id::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE WARNING 'Invalid competition_id format: %, skipping ticket creation', NEW.competition_id;
      RETURN NEW;
    END;
    
    -- Create tickets
    FOREACH tnum IN ARRAY COALESCE(NEW.ticket_numbers, ARRAY[]::int[]) LOOP
      INSERT INTO public.tickets (
        competition_id, ticket_number, status, purchased_at, order_id,
        canonical_user_id, wallet_address
      ) VALUES (
        v_competition_uuid,
        tnum, 
        'sold', 
        NEW.confirmed_at, 
        NULL,
        NEW.canonical_user_id,
        COALESCE(NEW.wallet_address,
                 (SELECT cu.wallet_address FROM public.canonical_users cu
                  WHERE cu.canonical_user_id = NEW.canonical_user_id))
      )
      ON CONFLICT (competition_id, ticket_number) DO UPDATE
      SET status = 'sold',
          purchased_at = EXCLUDED.purchased_at,
          canonical_user_id = EXCLUDED.canonical_user_id,
          wallet_address = EXCLUDED.wallet_address;
    END LOOP;
    
    -- Calculate values for joincompetition
    v_ticket_count := COALESCE(array_length(NEW.ticket_numbers, 1), 0);
    v_ticket_csv := array_to_string(COALESCE(NEW.ticket_numbers, ARRAY[]::int[]), ',');
    v_total_amount := COALESCE(NEW.total_amount, 0);
    v_join_id := gen_random_uuid();
    
    -- CREATE OR UPDATE JOINCOMPETITION ENTRY
    -- NOTE: competitionid, ticketnumbers, numberoftickets are GENERATED columns
    -- Uses ON CONFLICT to merge tickets when user makes additional purchases
    INSERT INTO public.joincompetition (
      id, user_id, competition_id, ticket_numbers, purchase_date,
      canonical_user_id, privy_user_id, wallet_address, status,
      amount_spent, created_at, updated_at
    ) VALUES (
      v_join_id,
      NEW.canonical_user_id,
      NEW.competition_id,
      v_ticket_csv,
      NEW.confirmed_at,
      NEW.canonical_user_id,
      NEW.user_id,
      COALESCE(NEW.wallet_address,
               (SELECT cu.wallet_address FROM public.canonical_users cu
                WHERE cu.canonical_user_id = NEW.canonical_user_id)),
      'sold',
      v_total_amount,
      NEW.confirmed_at,
      NEW.confirmed_at
    )
    ON CONFLICT (canonical_user_id, competition_id) DO UPDATE
    SET ticket_numbers = (
          -- Merge existing tickets with new tickets
          SELECT string_agg(DISTINCT t::text, ',' ORDER BY t::text)
          FROM (
            SELECT unnest(string_to_array(joincompetition.ticket_numbers, ','))::int AS t
            UNION
            SELECT unnest(string_to_array(EXCLUDED.ticket_numbers, ','))::int
          ) merged
        ),
        amount_spent = joincompetition.amount_spent + EXCLUDED.amount_spent,
        purchase_date = EXCLUDED.purchase_date,
        updated_at = EXCLUDED.updated_at;
    
    RAISE NOTICE 'trg_fn_confirm_pending_tickets: Created % tickets AND joincompetition entry for competition %', 
      v_ticket_count, v_competition_uuid;
  END IF;
  RETURN NEW;
END;
$function$;

-- Verify trigger is attached
DROP TRIGGER IF EXISTS trg_confirm_pending_tickets ON pending_tickets;
CREATE TRIGGER trg_confirm_pending_tickets
  AFTER UPDATE ON pending_tickets
  FOR EACH ROW
  EXECUTE FUNCTION trg_fn_confirm_pending_tickets();

-- ==============================================================================
-- BACKFILL: Create joincompetition entries for today's tickets that missed them
-- ==============================================================================
DO $$
DECLARE
  rec RECORD;
  v_ticket_csv TEXT;
  v_total NUMERIC;
BEGIN
  -- Find confirmed pending_tickets from today that don't have joincompetition entries
  FOR rec IN 
    SELECT 
      pt.id,
      pt.competition_id,
      pt.ticket_numbers,
      pt.canonical_user_id,
      pt.wallet_address,
      pt.confirmed_at,
      pt.total_amount
    FROM pending_tickets pt
    WHERE pt.status = 'confirmed'
      AND pt.confirmed_at >= '2026-02-22'::date
      AND NOT EXISTS (
        SELECT 1 FROM joincompetition jc 
        WHERE jc.canonical_user_id = pt.canonical_user_id 
          AND jc.competitionid = pt.competition_id
          AND jc.purchase_date >= '2026-02-22'::date
      )
  LOOP
    v_ticket_csv := array_to_string(COALESCE(rec.ticket_numbers, ARRAY[]::int[]), ',');
    v_total := COALESCE(rec.total_amount, 0);
    
    INSERT INTO public.joincompetition (
      id, user_id, competition_id, ticket_numbers, purchase_date,
      canonical_user_id, wallet_address, status, amount_spent, created_at, updated_at
    ) VALUES (
      gen_random_uuid(),
      rec.canonical_user_id,
      rec.competition_id,
      v_ticket_csv,
      rec.confirmed_at,
      rec.canonical_user_id,
      rec.wallet_address,
      'active',
      v_total,
      rec.confirmed_at,
      rec.confirmed_at
    );
    
    RAISE NOTICE 'Backfilled joincompetition for pending_ticket %', rec.id;
  END LOOP;
END $$;

-- Verify: Check joincompetition entries from today (using view to show username)
SELECT 
  jc.purchase_date, 
  cu.username,
  jc.status,
  jc.numberoftickets
FROM joincompetition jc
LEFT JOIN canonical_users cu ON cu.canonical_user_id = jc.canonical_user_id
WHERE jc.purchase_date >= '2026-02-22'::date
ORDER BY jc.purchase_date DESC
LIMIT 10;
