-- =====================================================
-- Fix competitions and competition_entries to use UUID
-- =====================================================
-- Production uses UUID for competitions.id and competition_entries.competition_id
-- Initial schema incorrectly used TEXT
-- This causes JOIN failures in RPC functions, resulting in "Unknown Competition"
-- Date: 2026-02-02
-- =====================================================

BEGIN;

-- Fix competitions.id from TEXT to UUID
DO $$
BEGIN
  -- Check if column is TEXT type
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'competitions'
      AND column_name = 'id'
      AND data_type = 'text'
  ) THEN
    -- Drop dependent objects first
    ALTER TABLE IF EXISTS competition_entries
      DROP CONSTRAINT IF EXISTS fk_competition_entries_competition;
    
    ALTER TABLE IF EXISTS tickets
      DROP CONSTRAINT IF EXISTS tickets_competition_id_fkey;
    
    ALTER TABLE IF EXISTS joincompetition
      DROP CONSTRAINT IF EXISTS joincompetition_competitionid_fkey;

    -- Convert TEXT to UUID
    ALTER TABLE public.competitions
      ALTER COLUMN id TYPE UUID
      USING id::UUID;
    
    -- Also fix uid if it's UUID in production
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'competitions'
        AND column_name = 'uid'
        AND data_type = 'text'
    ) THEN
      ALTER TABLE public.competitions
        ALTER COLUMN uid TYPE UUID
        USING CASE 
          WHEN uid ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' 
          THEN uid::UUID 
          ELSE gen_random_uuid() 
        END;
    END IF;
  END IF;
END $$;

-- Fix competition_entries.id from TEXT to UUID
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'competition_entries'
      AND column_name = 'id'
      AND data_type = 'text'
  ) THEN
    ALTER TABLE public.competition_entries
      ALTER COLUMN id TYPE UUID
      USING id::UUID;
  END IF;
END $$;

-- Fix competition_entries.competition_id from TEXT to UUID
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'competition_entries'
      AND column_name = 'competition_id'
      AND data_type = 'text'
  ) THEN
    ALTER TABLE public.competition_entries
      ALTER COLUMN competition_id TYPE UUID
      USING competition_id::UUID;
  END IF;
END $$;

-- Fix tickets.competition_id from TEXT to UUID if needed
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tickets'
      AND column_name = 'competition_id'
      AND data_type = 'text'
  ) THEN
    ALTER TABLE public.tickets
      ALTER COLUMN competition_id TYPE UUID
      USING competition_id::UUID;
  END IF;
END $$;

-- Re-add foreign key constraints
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_competition_entries_competition'
  ) THEN
    ALTER TABLE public.competition_entries
      ADD CONSTRAINT fk_competition_entries_competition
      FOREIGN KEY (competition_id)
      REFERENCES public.competitions(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'tickets_competition_id_fkey'
  ) THEN
    ALTER TABLE public.tickets
      ADD CONSTRAINT tickets_competition_id_fkey
      FOREIGN KEY (competition_id)
      REFERENCES public.competitions(id);
  END IF;

  -- joincompetition constraint already added in previous migration
END $$;

-- Make competitions.title nullable to match production
ALTER TABLE public.competitions
  ALTER COLUMN title DROP NOT NULL;

COMMIT;

-- Log completion
DO $$
BEGIN
  RAISE NOTICE '==============================================';
  RAISE NOTICE 'competitions and competition_entries tables updated';
  RAISE NOTICE '==============================================';
  RAISE NOTICE 'Type changes:';
  RAISE NOTICE '  - competitions.id: TEXT -> UUID';
  RAISE NOTICE '  - competitions.uid: TEXT -> UUID';
  RAISE NOTICE '  - competition_entries.id: TEXT -> UUID';
  RAISE NOTICE '  - competition_entries.competition_id: TEXT -> UUID';
  RAISE NOTICE '  - tickets.competition_id: TEXT -> UUID';
  RAISE NOTICE '';
  RAISE NOTICE 'Schema changes:';
  RAISE NOTICE '  - competitions.title: NOT NULL -> nullable';
  RAISE NOTICE '';
  RAISE NOTICE 'This fixes JOIN failures causing "Unknown Competition"';
  RAISE NOTICE '==============================================';
END $$;
