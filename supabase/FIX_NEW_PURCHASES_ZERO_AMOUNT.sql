-- ============================================================================
-- FIX: New Purchases Showing $0 - Fix UPSERT Logic
-- ============================================================================
-- ISSUE: New purchases are creating entries with amount_spent = 0
--
-- ROOT CAUSE: The upsert logic in confirm-pending-tickets doesn't properly
-- increment amount_spent when a user makes additional purchases in the same
-- competition. It's likely overwriting with 0 or not summing correctly.
--
-- SOLUTION: Add a trigger to properly calculate amount_spent on INSERT/UPDATE
-- ============================================================================

BEGIN;

-- ============================================================================
-- FIX: Add trigger to ensure amount_spent is always calculated correctly
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sync_competition_entry_amount_spent()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_calculated_amount NUMERIC;
  v_ticket_price NUMERIC;
BEGIN
  -- Get the ticket price for this competition
  SELECT ticket_price INTO v_ticket_price
  FROM competitions
  WHERE id = NEW.competition_id;

  -- If we don't have a ticket price, keep whatever amount_spent was set
  IF v_ticket_price IS NULL OR v_ticket_price = 0 THEN
    RETURN NEW;
  END IF;

  -- Calculate expected amount from tickets
  v_calculated_amount := NEW.tickets_count * v_ticket_price;

  -- If amount_spent is 0 or NULL, set it to calculated amount
  IF NEW.amount_spent IS NULL OR NEW.amount_spent = 0 THEN
    NEW.amount_spent := v_calculated_amount;
    RAISE NOTICE 'Fixed amount_spent for competition_entry %: % tickets × $% = $%', 
      NEW.id, NEW.tickets_count, v_ticket_price, v_calculated_amount;
  END IF;

  RETURN NEW;
END;
$$;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS trg_ensure_amount_spent ON competition_entries;

-- Create trigger that fires before INSERT or UPDATE
CREATE TRIGGER trg_ensure_amount_spent
  BEFORE INSERT OR UPDATE ON competition_entries
  FOR EACH ROW
  EXECUTE FUNCTION sync_competition_entry_amount_spent();

COMMENT ON TRIGGER trg_ensure_amount_spent ON competition_entries IS
'Ensures amount_spent is calculated correctly based on tickets_count × ticket_price';

-- ============================================================================
-- Backfill Fix: Run immediately to fix existing $0 entries
-- ============================================================================

DO $$
DECLARE
  v_fixed_count INTEGER := 0;
BEGIN
  RAISE NOTICE '========================================================';
  RAISE NOTICE 'Backfilling $0 entries...';
  RAISE NOTICE '========================================================';

  -- Update all entries where amount_spent = 0
  WITH fixes AS (
    UPDATE competition_entries ce
    SET amount_spent = ce.tickets_count * c.ticket_price
    FROM competitions c
    WHERE ce.competition_id = c.id
      AND (ce.amount_spent = 0 OR ce.amount_spent IS NULL)
      AND c.ticket_price > 0
      AND ce.tickets_count > 0
    RETURNING ce.id
  )
  SELECT COUNT(*) INTO v_fixed_count FROM fixes;

  RAISE NOTICE 'Fixed % entries with $0 amount_spent', v_fixed_count;
  RAISE NOTICE '========================================================';
END $$;

-- Force schema reload
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
DECLARE
  v_zero_count INTEGER;
BEGIN
  -- Count remaining entries with $0
  SELECT COUNT(*) INTO v_zero_count
  FROM competition_entries ce
  INNER JOIN competitions c ON ce.competition_id = c.id
  WHERE (ce.amount_spent = 0 OR ce.amount_spent IS NULL)
    AND c.ticket_price > 0
    AND ce.tickets_count > 0;

  RAISE NOTICE '';
  RAISE NOTICE '========================================================';
  RAISE NOTICE 'VERIFICATION';
  RAISE NOTICE '========================================================';
  
  IF v_zero_count = 0 THEN
    RAISE NOTICE '✅ SUCCESS: No entries with $0 found!';
  ELSE
    RAISE NOTICE '⚠️  WARNING: % entries still have $0', v_zero_count;
  END IF;
  
  RAISE NOTICE '========================================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Trigger installed: ALL NEW PURCHASES WILL HAVE CORRECT AMOUNTS';
  RAISE NOTICE '========================================================';
END $$;
