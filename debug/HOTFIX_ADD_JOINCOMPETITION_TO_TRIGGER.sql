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
    
    -- CREATE JOINCOMPETITION ENTRY (this is what was missing!)
    INSERT INTO public.joincompetition (
      id,
      user_id,
      competition_id,
      competitionid,
      ticket_numbers,
      ticketnumbers,
      purchase_date,
      canonical_user_id,
      privy_user_id,
      wallet_address,
      status,
      numberoftickets,
      amount_spent,
      created_at,
      updated_at
    ) VALUES (
      v_join_id,
      NEW.canonical_user_id,
      NEW.competition_id,
      NEW.competition_id,
      v_ticket_csv,
      v_ticket_csv,
      NEW.confirmed_at,
      NEW.canonical_user_id,
      NEW.user_id,
      COALESCE(NEW.wallet_address,
               (SELECT cu.wallet_address FROM public.canonical_users cu
                WHERE cu.canonical_user_id = NEW.canonical_user_id)),
      'active',
      v_ticket_count,
      v_total_amount,
      NEW.confirmed_at,
      NEW.confirmed_at
    )
    ON CONFLICT (canonical_user_id, competitionid) 
    DO UPDATE SET
      ticket_numbers = CASE 
        WHEN joincompetition.ticket_numbers IS NULL OR joincompetition.ticket_numbers = '' 
        THEN EXCLUDED.ticket_numbers
        ELSE joincompetition.ticket_numbers || ',' || EXCLUDED.ticket_numbers
      END,
      ticketnumbers = CASE 
        WHEN joincompetition.ticketnumbers IS NULL OR joincompetition.ticketnumbers = '' 
        THEN EXCLUDED.ticketnumbers
        ELSE joincompetition.ticketnumbers || ',' || EXCLUDED.ticketnumbers
      END,
      numberoftickets = COALESCE(joincompetition.numberoftickets, 0) + EXCLUDED.numberoftickets,
      amount_spent = COALESCE(joincompetition.amount_spent, 0) + EXCLUDED.amount_spent,
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
  v_count INT;
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
    v_count := COALESCE(array_length(rec.ticket_numbers, 1), 0);
    v_total := COALESCE(rec.total_amount, 0);
    
    INSERT INTO public.joincompetition (
      id, user_id, competition_id, competitionid,
      ticket_numbers, ticketnumbers, purchase_date,
      canonical_user_id, wallet_address, status,
      numberoftickets, amount_spent, created_at, updated_at
    ) VALUES (
      gen_random_uuid(),
      rec.canonical_user_id,
      rec.competition_id,
      rec.competition_id,
      v_ticket_csv,
      v_ticket_csv,
      rec.confirmed_at,
      rec.canonical_user_id,
      rec.wallet_address,
      'active',
      v_count,
      v_total,
      rec.confirmed_at,
      rec.confirmed_at
    )
    ON CONFLICT (canonical_user_id, competitionid) DO UPDATE SET
      ticket_numbers = CASE 
        WHEN joincompetition.ticket_numbers IS NULL OR joincompetition.ticket_numbers = '' 
        THEN EXCLUDED.ticket_numbers
        ELSE joincompetition.ticket_numbers || ',' || EXCLUDED.ticket_numbers
      END,
      numberoftickets = COALESCE(joincompetition.numberoftickets, 0) + EXCLUDED.numberoftickets,
      amount_spent = COALESCE(joincompetition.amount_spent, 0) + EXCLUDED.amount_spent,
      purchase_date = EXCLUDED.purchase_date,
      updated_at = now();
    
    RAISE NOTICE 'Backfilled joincompetition for pending_ticket %', rec.id;
  END LOOP;
END $$;

-- Verify: Check joincompetition entries from today
SELECT 
  purchase_date, 
  canonical_user_id, 
  status,
  numberoftickets
FROM joincompetition 
WHERE purchase_date >= '2026-02-22'::date
ORDER BY purchase_date DESC
LIMIT 10;
