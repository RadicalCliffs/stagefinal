-- ============================================================
-- HOTFIX: Fix trg_fn_confirm_pending_tickets trigger
-- The trigger was inserting TEXT into UUID column causing silent failures
-- ============================================================

-- First, let's verify the type mismatch
DO $$
DECLARE
  tickets_type TEXT;
  pending_type TEXT;
BEGIN
  SELECT data_type INTO tickets_type 
  FROM information_schema.columns 
  WHERE table_name = 'tickets' AND column_name = 'competition_id';
  
  SELECT data_type INTO pending_type 
  FROM information_schema.columns 
  WHERE table_name = 'pending_tickets' AND column_name = 'competition_id';
  
  RAISE NOTICE 'tickets.competition_id type: %', tickets_type;
  RAISE NOTICE 'pending_tickets.competition_id type: %', pending_type;
END $$;

-- Drop and recreate the trigger function with proper UUID casting
CREATE OR REPLACE FUNCTION public.trg_fn_confirm_pending_tickets()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  tnum int;
  v_competition_uuid UUID;
BEGIN
  IF (TG_OP = 'UPDATE') AND (OLD.confirmed_at IS NULL) AND (NEW.confirmed_at IS NOT NULL) THEN
    -- Cast TEXT competition_id to UUID for tickets table
    BEGIN
      v_competition_uuid := NEW.competition_id::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE WARNING 'Invalid competition_id format: %, skipping ticket creation', NEW.competition_id;
      RETURN NEW;
    END;
    
    FOREACH tnum IN ARRAY COALESCE(NEW.ticket_numbers, ARRAY[]::int[]) LOOP
      INSERT INTO public.tickets (
        competition_id, ticket_number, status, purchased_at, order_id,
        canonical_user_id, wallet_address
      ) VALUES (
        v_competition_uuid,  -- Use UUID instead of TEXT
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
    
    RAISE NOTICE 'trg_fn_confirm_pending_tickets: Created % tickets for competition %', 
      array_length(NEW.ticket_numbers, 1), v_competition_uuid;
  END IF;
  RETURN NEW;
END;
$function$;

-- Make sure the trigger is attached
DROP TRIGGER IF EXISTS trg_confirm_pending_tickets ON pending_tickets;
CREATE TRIGGER trg_confirm_pending_tickets
  AFTER UPDATE ON pending_tickets
  FOR EACH ROW
  EXECUTE FUNCTION trg_fn_confirm_pending_tickets();

-- Test: Manually re-confirm a recently confirmed pending_ticket to create tickets
-- This will re-trigger the function for any confirmed reservations that didn't create tickets
DO $$
DECLARE
  pt RECORD;
  created_count INT := 0;
BEGIN
  -- Find confirmed pending_tickets that might not have created tickets
  FOR pt IN 
    SELECT p.id, p.competition_id, p.ticket_numbers, p.canonical_user_id, p.wallet_address, p.confirmed_at
    FROM pending_tickets p
    WHERE p.status = 'confirmed'
      AND p.confirmed_at IS NOT NULL
      AND p.ticket_numbers IS NOT NULL
      AND p.canonical_user_id LIKE 'prize:pid:0x0ff51ec0%'  -- Your user
    ORDER BY p.confirmed_at DESC
    LIMIT 10
  LOOP
    RAISE NOTICE 'Checking pending_ticket %: tickets=%', pt.id, pt.ticket_numbers;
    
    -- Check if tickets exist
    IF NOT EXISTS (
      SELECT 1 FROM tickets t 
      WHERE t.competition_id = pt.competition_id::UUID 
        AND t.ticket_number = ANY(pt.ticket_numbers)
    ) THEN
      RAISE NOTICE 'Creating missing tickets for reservation %', pt.id;
      
      -- Create the tickets manually
      INSERT INTO tickets (competition_id, ticket_number, status, purchased_at, canonical_user_id, wallet_address)
      SELECT 
        pt.competition_id::UUID,
        unnest(pt.ticket_numbers),
        'sold',
        pt.confirmed_at,
        pt.canonical_user_id,
        COALESCE(pt.wallet_address, (SELECT cu.wallet_address FROM canonical_users cu WHERE cu.canonical_user_id = pt.canonical_user_id))
      ON CONFLICT (competition_id, ticket_number) DO UPDATE
      SET status = 'sold',
          purchased_at = EXCLUDED.purchased_at,
          canonical_user_id = EXCLUDED.canonical_user_id,
          wallet_address = EXCLUDED.wallet_address;
      
      created_count := created_count + array_length(pt.ticket_numbers, 1);
    ELSE
      RAISE NOTICE 'Tickets already exist for reservation %', pt.id;
    END IF;
  END LOOP;
  
  RAISE NOTICE 'Created % missing tickets', created_count;
END $$;

-- Verify tickets were created
SELECT 
  t.ticket_number,
  t.competition_id,
  t.canonical_user_id,
  t.wallet_address,
  t.purchased_at
FROM tickets t
WHERE t.canonical_user_id LIKE 'prize:pid:0x0ff51ec0%'
ORDER BY t.purchased_at DESC
LIMIT 10;
