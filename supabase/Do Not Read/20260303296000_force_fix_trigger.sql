-- FORCE FIX: Replace the confirm trigger with batch insert (no migration tracking)
-- This runs the fix directly without touching schema_migrations

CREATE OR REPLACE FUNCTION public.trg_fn_confirm_pending_tickets()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_wallet_address TEXT;
BEGIN
  IF (TG_OP = 'UPDATE') AND (OLD.confirmed_at IS NULL) AND (NEW.confirmed_at IS NOT NULL) THEN
    v_wallet_address := COALESCE(
      NEW.wallet_address,
      (SELECT cu.wallet_address 
       FROM public.canonical_users cu
       WHERE cu.canonical_user_id = NEW.canonical_user_id
       LIMIT 1)
    );

    -- BATCH INSERT ALL TICKETS AT ONCE (not loop!)
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
      NEW.competition_id,
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

-- Verify it worked
DO $$
DECLARE
  v_func_def TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_func_def
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public' AND p.proname = 'trg_fn_confirm_pending_tickets';
  
  IF v_func_def LIKE '%FOREACH%' THEN
    RAISE EXCEPTION 'FAILED: Trigger still uses FOREACH loop!';
  ELSIF v_func_def LIKE '%unnest%' THEN
    RAISE NOTICE '✅ SUCCESS: Trigger now uses batch INSERT with unnest';
  END IF;
END $$;
