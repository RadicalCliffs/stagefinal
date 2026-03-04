-- ============================================================================
-- Fix: Batch insert tickets in confirm trigger instead of loop
-- ============================================================================
-- The old trigger was timing out because it inserted tickets one-by-one
-- This replaces it with a single batch INSERT statement

CREATE OR REPLACE FUNCTION public.trg_fn_confirm_pending_tickets()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_wallet_address TEXT;
BEGIN
  -- Only fire on confirmation (when confirmed_at changes from NULL to a timestamp)
  IF (TG_OP = 'UPDATE') AND (OLD.confirmed_at IS NULL) AND (NEW.confirmed_at IS NOT NULL) THEN
    
    -- Get wallet address once (instead of per-ticket in loop)
    v_wallet_address := COALESCE(
      NEW.wallet_address,
      (SELECT cu.wallet_address 
       FROM public.canonical_users cu
       WHERE cu.canonical_user_id = NEW.canonical_user_id
       LIMIT 1)
    );

    -- Batch insert all tickets at once
    INSERT INTO public.tickets (
      competition_id,
      ticket_number,
      status,
      purchased_at,
      order_id,
      canonical_user_id,
      wallet_address
    )
    SELECT
      NEW.competition_id,  -- UUID, no cast needed
      ticket_num,
      'sold',
      NEW.confirmed_at,
      NULL,
      NEW.canonical_user_id,
      v_wallet_address
    FROM unnest(COALESCE(NEW.ticket_numbers, ARRAY[]::int[])) AS ticket_num
    ON CONFLICT (competition_id, ticket_number) DO UPDATE
    SET 
      status = 'sold',
      purchased_at = EXCLUDED.purchased_at,
      canonical_user_id = EXCLUDED.canonical_user_id,
      wallet_address = EXCLUDED.wallet_address;
  END IF;
  
  RETURN NEW;
END;
$function$;

-- Trigger is already attached, just replacing the function
