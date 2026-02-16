-- =====================================================
-- VERIFY AND FIX: Ongoing sync from user_transactions to competition_entries
-- =====================================================
-- ISSUE: User reports that new transactions aren't appearing in entries tab
-- The trigger trg_sync_competition_entries_from_ut exists but may not be working
--
-- This migration:
-- 1. Verifies the trigger exists and is correct
-- 2. Adds better error handling
-- 3. Adds logging to diagnose issues
-- 4. Ensures the unique constraint exists
-- =====================================================

BEGIN;

-- =====================================================
-- PART 1: Ensure unique constraint exists (required for trigger ON CONFLICT)
-- =====================================================
-- This was added in migration 20260202062200 but let's ensure it exists

DO $$
BEGIN
  -- Check if constraint already exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'ux_competition_entries_canonical_user_comp'
  ) THEN
    -- Add the constraint if it doesn't exist
    ALTER TABLE public.competition_entries
    ADD CONSTRAINT ux_competition_entries_canonical_user_comp 
    UNIQUE (canonical_user_id, competition_id);
    
    RAISE NOTICE 'Added missing unique constraint on competition_entries';
  ELSE
    RAISE NOTICE 'Unique constraint already exists on competition_entries';
  END IF;
END $$;

-- =====================================================
-- PART 2: Verify and recreate trigger function with better error handling
-- =====================================================
-- The function from migration 20260214150000 should exist, but let's ensure
-- it has proper error handling and logging

CREATE OR REPLACE FUNCTION public.sync_competition_entries_from_user_transactions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_canonical_user_id TEXT;
  v_existing_entry_id uuid;
  v_error_message TEXT;
BEGIN
  -- Only process completed competition entries (not top-ups)
  IF NEW.type != 'topup' 
     AND NEW.competition_id IS NOT NULL 
     AND NEW.status IN ('completed', 'confirmed', 'success')
     AND NEW.ticket_count > 0
  THEN
    BEGIN
      -- Resolve canonical_user_id
      v_canonical_user_id := COALESCE(NEW.canonical_user_id, NEW.user_privy_id, NEW.user_id);
      
      IF v_canonical_user_id IS NULL THEN
        -- Log warning but don't fail
        RAISE WARNING 'user_transactions id % has no canonical_user_id', NEW.id;
        RETURN NEW;
      END IF;

      -- Check if entry already exists
      SELECT id INTO v_existing_entry_id
      FROM public.competition_entries
      WHERE canonical_user_id = v_canonical_user_id
        AND competition_id = NEW.competition_id;

      IF v_existing_entry_id IS NOT NULL THEN
        -- Update existing entry
        UPDATE public.competition_entries
        SET
          tickets_count = COALESCE(tickets_count, 0) + COALESCE(NEW.ticket_count, 0),
          amount_spent = COALESCE(amount_spent, 0) + COALESCE(ABS(NEW.amount), 0),
          latest_purchase_at = GREATEST(
            COALESCE(latest_purchase_at, NEW.completed_at, NEW.created_at),
            COALESCE(NEW.completed_at, NEW.created_at)
          ),
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
          amount_spent,
          latest_purchase_at,
          created_at,
          updated_at
        ) VALUES (
          gen_random_uuid(),
          v_canonical_user_id,
          NEW.competition_id,
          NEW.wallet_address,
          COALESCE(NEW.ticket_count, 0),
          COALESCE(ABS(NEW.amount), 0),
          COALESCE(NEW.completed_at, NEW.created_at),
          NOW(),
          NOW()
        )
        ON CONFLICT (canonical_user_id, competition_id) 
        DO UPDATE SET
          tickets_count = competition_entries.tickets_count + COALESCE(NEW.ticket_count, 0),
          amount_spent = competition_entries.amount_spent + COALESCE(ABS(NEW.amount), 0),
          latest_purchase_at = GREATEST(
            competition_entries.latest_purchase_at,
            COALESCE(NEW.completed_at, NEW.created_at)
          ),
          updated_at = NOW();
      END IF;

      -- Also ensure the purchase is recorded in competition_entries_purchases
      INSERT INTO public.competition_entries_purchases (
        id,
        canonical_user_id,
        competition_id,
        purchase_key,
        tickets_count,
        amount_spent,
        ticket_numbers_csv,
        purchased_at,
        created_at
      ) VALUES (
        gen_random_uuid(),
        v_canonical_user_id,
        NEW.competition_id,
        'ut_' || NEW.id::text,
        COALESCE(NEW.ticket_count, 0),
        COALESCE(ABS(NEW.amount), 0),
        NEW.ticket_numbers,
        COALESCE(NEW.completed_at, NEW.created_at),
        NOW()
      )
      ON CONFLICT (canonical_user_id, competition_id, purchase_key)
      DO UPDATE SET
        tickets_count = EXCLUDED.tickets_count,
        amount_spent = EXCLUDED.amount_spent,
        ticket_numbers_csv = EXCLUDED.ticket_numbers_csv,
        purchased_at = EXCLUDED.purchased_at;
      
    EXCEPTION
      WHEN OTHERS THEN
        -- Log error but don't prevent the insert
        GET STACKED DIAGNOSTICS v_error_message = MESSAGE_TEXT;
        RAISE WARNING 'Error syncing user_transaction % to competition_entries: %', NEW.id, v_error_message;
        -- Continue processing
    END;
  END IF;

  RETURN NEW;
END;
$$;

-- =====================================================
-- PART 3: Ensure trigger exists and is enabled
-- =====================================================
DROP TRIGGER IF EXISTS trg_sync_competition_entries_from_ut ON public.user_transactions;
CREATE TRIGGER trg_sync_competition_entries_from_ut
  AFTER INSERT OR UPDATE ON public.user_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_competition_entries_from_user_transactions();

-- =====================================================
-- PART 4: Test the trigger with a diagnostic query
-- =====================================================
DO $$
DECLARE
  v_trigger_exists BOOLEAN;
  v_function_exists BOOLEAN;
  v_constraint_exists BOOLEAN;
  v_recent_ut_count INTEGER;
  v_recent_ce_count INTEGER;
BEGIN
  -- Check trigger exists
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'trg_sync_competition_entries_from_ut'
      AND tgrelid = 'public.user_transactions'::regclass
  ) INTO v_trigger_exists;
  
  -- Check function exists
  SELECT EXISTS (
    SELECT 1 FROM pg_proc 
    WHERE proname = 'sync_competition_entries_from_user_transactions'
  ) INTO v_function_exists;
  
  -- Check constraint exists
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'ux_competition_entries_canonical_user_comp'
  ) INTO v_constraint_exists;
  
  -- Count recent transactions
  SELECT COUNT(*) INTO v_recent_ut_count
  FROM user_transactions
  WHERE type != 'topup'
    AND competition_id IS NOT NULL
    AND ticket_count > 0
    AND created_at > NOW() - INTERVAL '7 days';
  
  -- Count recent entries
  SELECT COUNT(*) INTO v_recent_ce_count
  FROM competition_entries
  WHERE created_at > NOW() - INTERVAL '7 days';
  
  RAISE NOTICE '';
  RAISE NOTICE '=== ONGOING SYNC VERIFICATION ===';
  RAISE NOTICE 'Trigger exists: %', v_trigger_exists;
  RAISE NOTICE 'Function exists: %', v_function_exists;
  RAISE NOTICE 'Unique constraint exists: %', v_constraint_exists;
  RAISE NOTICE '';
  RAISE NOTICE 'Recent user_transactions (7 days): %', v_recent_ut_count;
  RAISE NOTICE 'Recent competition_entries (7 days): %', v_recent_ce_count;
  RAISE NOTICE '';
  
  IF NOT v_trigger_exists THEN
    RAISE WARNING 'TRIGGER IS MISSING! Ongoing sync will not work!';
  END IF;
  
  IF NOT v_function_exists THEN
    RAISE WARNING 'FUNCTION IS MISSING! Ongoing sync will not work!';
  END IF;
  
  IF NOT v_constraint_exists THEN
    RAISE WARNING 'UNIQUE CONSTRAINT IS MISSING! Trigger may fail!';
  END IF;
  
  IF v_trigger_exists AND v_function_exists AND v_constraint_exists THEN
    RAISE NOTICE 'STATUS: All components for ongoing sync are in place ✓';
    RAISE NOTICE '';
    RAISE NOTICE 'NEXT: Test by inserting a new transaction and verify it appears in competition_entries';
  END IF;
END $$;

COMMIT;

-- =====================================================
-- COMPLETION LOG
-- =====================================================
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== Migration 20260216020000 Complete ===';
  RAISE NOTICE 'Verified and fixed ongoing sync mechanism:';
  RAISE NOTICE '1. ✓ Unique constraint ensured';
  RAISE NOTICE '2. ✓ Trigger function recreated with error handling';
  RAISE NOTICE '3. ✓ Trigger recreated on user_transactions';
  RAISE NOTICE '4. ✓ Diagnostic checks performed';
  RAISE NOTICE '';
  RAISE NOTICE 'ONGOING SYNC: Future user_transactions with:';
  RAISE NOTICE '  - type != ''topup''';
  RAISE NOTICE '  - competition_id IS NOT NULL';
  RAISE NOTICE '  - status IN (''completed'', ''confirmed'', ''success'')';
  RAISE NOTICE '  - ticket_count > 0';
  RAISE NOTICE '';
  RAISE NOTICE 'Will automatically sync to competition_entries and competition_entries_purchases';
END $$;
