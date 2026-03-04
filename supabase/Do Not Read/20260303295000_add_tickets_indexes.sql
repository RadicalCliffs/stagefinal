-- Fix: Add missing unique index on tickets and optimize trigger
-- Problem: The ON CONFLICT in the trigger requires a unique constraint
-- Solution: Add unique index on (competition_id, ticket_number)

-- Add the unique constraint if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'tickets_competition_ticket_unique'
  ) THEN
    ALTER TABLE public.tickets 
    ADD CONSTRAINT tickets_competition_ticket_unique 
    UNIQUE (competition_id, ticket_number);
    
    RAISE NOTICE 'Added unique constraint tickets_competition_ticket_unique';
  ELSE
    RAISE NOTICE 'Unique constraint already exists';
  END IF;
END $$;

-- Add performance indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_tickets_competition_id 
ON public.tickets(competition_id);

CREATE INDEX IF NOT EXISTS idx_tickets_status 
ON public.tickets(status);

CREATE INDEX IF NOT EXISTS idx_tickets_canonical_user 
ON public.tickets(canonical_user_id) 
WHERE canonical_user_id IS NOT NULL;

-- Verify the trigger function is using batch insert
DO $$
DECLARE
  v_func_def TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_func_def
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public' AND p.proname = 'trg_fn_confirm_pending_tickets';
  
  IF v_func_def LIKE '%FOREACH%' THEN
    RAISE WARNING 'Trigger still uses FOREACH loop - apply migration 20260303280000';
  ELSIF v_func_def LIKE '%unnest%' THEN
    RAISE NOTICE 'Trigger correctly uses batch INSERT';
  END IF;
END $$;
