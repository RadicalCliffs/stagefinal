-- Migration: Sync competition_entries from joincompetition
-- Issue: Dashboard Entries tab doesn't show purchases because competition_entries is never populated
-- Solution: Create trigger to auto-populate competition_entries whenever joincompetition is inserted/updated

-- Step 1: Add unique constraint to prevent duplicate entries per user/competition
-- This allows us to use ON CONFLICT for upsert operations
ALTER TABLE public.competition_entries
ADD CONSTRAINT ux_competition_entries_canonical_user_comp 
UNIQUE (canonical_user_id, competition_id);

-- Step 2: Create trigger function to sync joincompetition → competition_entries
-- This aggregates all purchases by a user for a specific competition
CREATE OR REPLACE FUNCTION public.sync_competition_entries_from_joincompetition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_existing_entry_id uuid;
  v_new_ticket_numbers_csv text;
BEGIN
  -- Ignore rows without canonical_user_id or competition_id
  IF NEW.canonical_user_id IS NULL OR NEW.competitionid IS NULL THEN
    RETURN NEW;
  END IF;

  -- Lock existing entry if it exists (for atomic updates)
  SELECT id INTO v_existing_entry_id
  FROM public.competition_entries
  WHERE canonical_user_id = NEW.canonical_user_id
    AND competition_id = NEW.competitionid
  FOR UPDATE;

  IF v_existing_entry_id IS NOT NULL THEN
    -- Update existing entry: aggregate tickets and amount
    -- Append ticket numbers to CSV list
    SELECT 
      CASE
        WHEN ce.ticket_numbers_csv IS NULL OR ce.ticket_numbers_csv = '' 
          THEN COALESCE(NEW.ticketnumbers, '')
        WHEN NEW.ticketnumbers IS NOT NULL AND NEW.ticketnumbers != '' 
          THEN ce.ticket_numbers_csv || ',' || NEW.ticketnumbers
        ELSE ce.ticket_numbers_csv
      END
    INTO v_new_ticket_numbers_csv
    FROM public.competition_entries ce
    WHERE ce.id = v_existing_entry_id;

    UPDATE public.competition_entries
    SET
      tickets_count = COALESCE(tickets_count, 0) + COALESCE(NEW.numberoftickets, 0),
      amount_spent = COALESCE(amount_spent, 0) + COALESCE(NEW.amountspent, 0),
      ticket_numbers_csv = v_new_ticket_numbers_csv,
      latest_purchase_at = GREATEST(COALESCE(latest_purchase_at, NEW.purchasedate), NEW.purchasedate),
      updated_at = NOW()
    WHERE id = v_existing_entry_id;
  ELSE
    -- Insert new entry
    INSERT INTO public.competition_entries (
      id,
      canonical_user_id,
      competition_id,
      wallet_address,
      tickets_count,
      ticket_numbers_csv,
      amount_spent,
      latest_purchase_at,
      created_at,
      updated_at
    ) VALUES (
      gen_random_uuid(),
      NEW.canonical_user_id,
      NEW.competitionid,
      NEW.wallet_address,
      COALESCE(NEW.numberoftickets, 0),
      NEW.ticketnumbers,
      COALESCE(NEW.amountspent, 0),
      NEW.purchasedate,
      NOW(),
      NOW()
    )
    ON CONFLICT (canonical_user_id, competition_id) 
    DO UPDATE SET
      tickets_count = competition_entries.tickets_count + COALESCE(NEW.numberoftickets, 0),
      amount_spent = competition_entries.amount_spent + COALESCE(NEW.amountspent, 0),
      ticket_numbers_csv = CASE
        WHEN competition_entries.ticket_numbers_csv IS NULL OR competition_entries.ticket_numbers_csv = ''
          THEN COALESCE(NEW.ticketnumbers, '')
        WHEN NEW.ticketnumbers IS NOT NULL AND NEW.ticketnumbers != ''
          THEN competition_entries.ticket_numbers_csv || ',' || NEW.ticketnumbers
        ELSE competition_entries.ticket_numbers_csv
      END,
      latest_purchase_at = GREATEST(competition_entries.latest_purchase_at, NEW.purchasedate),
      updated_at = NOW();
  END IF;

  RETURN NEW;
END;
$$;

-- Step 3: Create trigger on joincompetition table
-- Fires AFTER INSERT or UPDATE to sync data to competition_entries
DROP TRIGGER IF EXISTS trg_sync_competition_entries ON public.joincompetition;
CREATE TRIGGER trg_sync_competition_entries
  AFTER INSERT OR UPDATE ON public.joincompetition
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_competition_entries_from_joincompetition();

-- Step 4: Backfill existing joincompetition records into competition_entries
-- This populates competition_entries with all historical purchase data
INSERT INTO public.competition_entries (
  id,
  canonical_user_id,
  competition_id,
  wallet_address,
  tickets_count,
  ticket_numbers_csv,
  amount_spent,
  latest_purchase_at,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid() as id,
  jc.canonical_user_id,
  jc.competitionid as competition_id,
  jc.wallet_address,
  SUM(COALESCE(jc.numberoftickets, 0)) as tickets_count,
  string_agg(jc.ticketnumbers, ',' ORDER BY jc.purchasedate) as ticket_numbers_csv,
  SUM(COALESCE(jc.amountspent, 0)) as amount_spent,
  MAX(jc.purchasedate) as latest_purchase_at,
  MIN(jc.created_at) as created_at,
  NOW() as updated_at
FROM public.joincompetition jc
WHERE jc.canonical_user_id IS NOT NULL
  AND jc.competitionid IS NOT NULL
GROUP BY jc.canonical_user_id, jc.competitionid, jc.wallet_address
ON CONFLICT (canonical_user_id, competition_id) 
DO UPDATE SET
  tickets_count = EXCLUDED.tickets_count,
  ticket_numbers_csv = EXCLUDED.ticket_numbers_csv,
  amount_spent = EXCLUDED.amount_spent,
  latest_purchase_at = EXCLUDED.latest_purchase_at,
  updated_at = NOW();

-- Log completion
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count FROM public.competition_entries;
  RAISE NOTICE 'Migration complete: competition_entries now has % records', v_count;
END $$;
