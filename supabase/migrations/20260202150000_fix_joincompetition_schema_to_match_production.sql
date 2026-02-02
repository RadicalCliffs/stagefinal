-- =====================================================
-- Fix joincompetition table schema to match production
-- =====================================================
-- Production has these columns that are missing from initial schema:
-- - wallet_address, purchasedate, status, uid, chain, transactionhash,
-- - numberoftickets, amountspent, canonical_user_id, privy_user_id, updated_at
--
-- Date: 2026-02-02
-- =====================================================

BEGIN;

-- Add missing columns to joincompetition table
-- EXACT schema from production INSERT statement
ALTER TABLE IF EXISTS public.joincompetition
  ADD COLUMN IF NOT EXISTS wallet_address TEXT,
  ADD COLUMN IF NOT EXISTS purchasedate TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS uid UUID,
  ADD COLUMN IF NOT EXISTS chain TEXT,
  ADD COLUMN IF NOT EXISTS transactionhash TEXT,
  ADD COLUMN IF NOT EXISTS numberoftickets INTEGER,
  ADD COLUMN IF NOT EXISTS amountspent NUMERIC,
  ADD COLUMN IF NOT EXISTS canonical_user_id TEXT,
  ADD COLUMN IF NOT EXISTS privy_user_id TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Change ticketnumbers from INTEGER[] to TEXT to match production
-- (This is a breaking change, but necessary for compatibility)
DO $$
BEGIN
  -- Check if column is INTEGER[] type
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'joincompetition'
      AND column_name = 'ticketnumbers'
      AND data_type = 'ARRAY'
  ) THEN
    -- Convert INTEGER[] to TEXT (comma-separated)
    ALTER TABLE public.joincompetition
      ALTER COLUMN ticketnumbers TYPE TEXT
      USING array_to_string(ticketnumbers, ',');
  END IF;
END $$;

-- Change competitionid from TEXT to UUID to match production
DO $$
BEGIN
  -- Check if column is TEXT type
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'joincompetition'
      AND column_name = 'competitionid'
      AND data_type = 'text'
  ) THEN
    -- Convert TEXT to UUID
    ALTER TABLE public.joincompetition
      ALTER COLUMN competitionid TYPE UUID
      USING competitionid::UUID;
  END IF;
END $$;

-- Change id from TEXT to UUID to match production
DO $$
BEGIN
  -- Check if column is TEXT type
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'joincompetition'
      AND column_name = 'id'
      AND data_type = 'text'
  ) THEN
    -- Convert TEXT to UUID
    ALTER TABLE public.joincompetition
      ALTER COLUMN id TYPE UUID
      USING id::UUID;
  END IF;
END $$;

-- Add foreign key constraints if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'joincompetition_canonical_user_id_fkey'
  ) THEN
    ALTER TABLE public.joincompetition
      ADD CONSTRAINT joincompetition_canonical_user_id_fkey
      FOREIGN KEY (canonical_user_id)
      REFERENCES public.canonical_users(canonical_user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'joincompetition_competitionid_fkey'
  ) THEN
    ALTER TABLE public.joincompetition
      ADD CONSTRAINT joincompetition_competitionid_fkey
      FOREIGN KEY (competitionid)
      REFERENCES public.competitions(id);
  END IF;
END $$;

-- Add indexes for new columns
CREATE INDEX IF NOT EXISTS idx_joincompetition_wallet_address ON public.joincompetition(wallet_address);
CREATE INDEX IF NOT EXISTS idx_joincompetition_canonical_user_id ON public.joincompetition(canonical_user_id);
CREATE INDEX IF NOT EXISTS idx_joincompetition_privy_user_id ON public.joincompetition(privy_user_id);
CREATE INDEX IF NOT EXISTS idx_joincompetition_purchasedate ON public.joincompetition(purchasedate DESC);
CREATE INDEX IF NOT EXISTS idx_joincompetition_status ON public.joincompetition(status);

COMMIT;

-- Log completion
DO $$
BEGIN
  RAISE NOTICE '==============================================';
  RAISE NOTICE 'joincompetition table schema updated to match production';
  RAISE NOTICE '==============================================';
  RAISE NOTICE 'Added columns:';
  RAISE NOTICE '  - wallet_address, purchasedate, status, uid, chain';
  RAISE NOTICE '  - transactionhash, numberoftickets, amountspent';
  RAISE NOTICE '  - canonical_user_id, privy_user_id, updated_at';
  RAISE NOTICE '';
  RAISE NOTICE 'Type changes:';
  RAISE NOTICE '  - ticketnumbers: INTEGER[] -> TEXT';
  RAISE NOTICE '  - competitionid: TEXT -> UUID';
  RAISE NOTICE '  - id: TEXT -> UUID';
  RAISE NOTICE '';
  RAISE NOTICE 'Schema now matches production!';
  RAISE NOTICE '==============================================';
END $$;
