-- Migration: Fix competition_entries to populate competition_title
-- Issue: Entries show as "Unknown Competition" because competition_title is never populated
-- Solution: Update trigger to fetch and store competition title/description from competitions table

-- Step 1: Update the trigger function to include competition title and description
CREATE OR REPLACE FUNCTION public.sync_competition_entries_from_joincompetition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_existing_entry_id uuid;
  v_new_ticket_numbers_csv text;
  v_competition_title text;
  v_competition_description text;
BEGIN
  -- Ignore rows without canonical_user_id or competition_id
  IF NEW.canonical_user_id IS NULL OR NEW.competitionid IS NULL THEN
    RETURN NEW;
  END IF;

  -- Fetch competition title and description
  -- Handle both UUID and text competition IDs with safe casting
  BEGIN
    SELECT 
      title,
      description
    INTO v_competition_title, v_competition_description
    FROM competitions
    WHERE id::text = NEW.competitionid
       OR uid::text = NEW.competitionid
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    -- If query fails, use defaults
    v_competition_title := NULL;
    v_competition_description := NULL;
  END;

  -- If competition not found, use default
  IF v_competition_title IS NULL THEN
    v_competition_title := 'Unknown Competition';
    v_competition_description := '';
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
      latest_purchase_at = GREATEST(latest_purchase_at, NEW.purchasedate),
      competition_title = v_competition_title,
      competition_description = v_competition_description,
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
      competition_title,
      competition_description,
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
      v_competition_title,
      v_competition_description,
      NOW(),
      NOW()
    )
    ON CONFLICT (canonical_user_id, competition_id) 
    DO UPDATE SET
      tickets_count = competition_entries.tickets_count + COALESCE(EXCLUDED.tickets_count, 0),
      amount_spent = competition_entries.amount_spent + COALESCE(EXCLUDED.amount_spent, 0),
      ticket_numbers_csv = CASE
        WHEN competition_entries.ticket_numbers_csv IS NULL OR competition_entries.ticket_numbers_csv = ''
          THEN EXCLUDED.ticket_numbers_csv
        WHEN EXCLUDED.ticket_numbers_csv IS NOT NULL AND EXCLUDED.ticket_numbers_csv != ''
          THEN competition_entries.ticket_numbers_csv || ',' || EXCLUDED.ticket_numbers_csv
        ELSE competition_entries.ticket_numbers_csv
      END,
      latest_purchase_at = GREATEST(competition_entries.latest_purchase_at, EXCLUDED.latest_purchase_at),
      competition_title = EXCLUDED.competition_title,
      competition_description = EXCLUDED.competition_description,
      updated_at = NOW();
  END IF;

  RETURN NEW;
END;
$$;

-- Step 2: Backfill existing competition_entries with competition titles
-- Update all existing entries that have NULL or 'Unknown Competition' as title
-- Use safe text comparison to handle both UUID and string IDs
UPDATE public.competition_entries ce
SET 
  competition_title = COALESCE(c.title, 'Unknown Competition'),
  competition_description = COALESCE(c.description, ''),
  updated_at = NOW()
FROM public.competitions c
WHERE (ce.competition_id = c.id::text OR ce.competition_id = c.uid::text)
  AND (ce.competition_title IS NULL 
       OR ce.competition_title = '' 
       OR ce.competition_title = 'Unknown Competition');

-- Step 3: Log completion
DO $$
DECLARE
  v_updated_count integer;
  v_total_count integer;
BEGIN
  -- Count entries with valid titles after backfill
  SELECT COUNT(*) INTO v_updated_count 
  FROM public.competition_entries 
  WHERE competition_title IS NOT NULL AND competition_title != 'Unknown Competition';
  
  SELECT COUNT(*) INTO v_total_count FROM public.competition_entries;
  
  RAISE NOTICE 'Migration complete: Updated competition titles in competition_entries';
  RAISE NOTICE 'Entries with valid titles: % out of %', v_updated_count, v_total_count;
END $$;
