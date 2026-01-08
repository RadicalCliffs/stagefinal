-- =====================================================
-- FIX WINNERS TABLE: user_id UUID to TEXT
-- =====================================================
-- The winners.user_id column is defined as UUID, but since the
-- December 23rd canonical ID migration, all user IDs are now
-- stored in the prize:pid:<identifier> TEXT format.
--
-- This mismatch causes winner insertion failures because
-- text values like "prize:pid:0x..." cannot be cast to UUID.
--
-- This migration:
-- 1. Drops any foreign key constraints on winners.user_id
-- 2. Changes the column type from UUID to TEXT
-- 3. Converts existing UUID values to the canonical format
-- =====================================================

BEGIN;

-- Step 1: Drop any foreign key constraints on user_id
-- (The winners table may have an FK to profiles or other tables)
DO $$
DECLARE
  fk_name TEXT;
BEGIN
  FOR fk_name IN
    SELECT tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_name = 'winners'
      AND kcu.column_name = 'user_id'
  LOOP
    EXECUTE format('ALTER TABLE winners DROP CONSTRAINT IF EXISTS %I', fk_name);
    RAISE NOTICE 'Dropped foreign key constraint: %', fk_name;
  END LOOP;
END $$;

-- Step 2: Change the user_id column from UUID to TEXT
-- First, check if it's currently UUID type and convert
DO $$
DECLARE
  current_type TEXT;
BEGIN
  SELECT data_type INTO current_type
  FROM information_schema.columns
  WHERE table_name = 'winners'
    AND column_name = 'user_id';

  IF current_type = 'uuid' THEN
    -- Convert UUID to TEXT, preserving existing values
    ALTER TABLE winners
      ALTER COLUMN user_id TYPE text
      USING user_id::text;
    RAISE NOTICE 'Changed winners.user_id from UUID to TEXT';
  ELSIF current_type = 'text' OR current_type = 'character varying' THEN
    RAISE NOTICE 'winners.user_id is already TEXT type, no change needed';
  ELSE
    RAISE NOTICE 'winners.user_id has unexpected type: %, attempting conversion', current_type;
    ALTER TABLE winners
      ALTER COLUMN user_id TYPE text
      USING user_id::text;
  END IF;
END $$;

-- Step 3: Convert existing UUID values to canonical prize:pid: format
-- Only convert values that look like UUIDs (not already in prize:pid: format)
UPDATE winners
SET user_id = 'prize:pid:' || LOWER(user_id)
WHERE user_id IS NOT NULL
  AND user_id NOT LIKE 'prize:pid:%'
  AND user_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

-- Step 4: Normalize wallet addresses in user_id (if they're raw wallet addresses)
UPDATE winners
SET user_id = 'prize:pid:' || LOWER(user_id)
WHERE user_id IS NOT NULL
  AND user_id NOT LIKE 'prize:pid:%'
  AND user_id ~ '^0x[0-9a-fA-F]{40}$';

-- Step 5: Create index on user_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_winners_user_id ON winners(user_id);

-- Step 6: Log the migration results
DO $$
DECLARE
  total_count INTEGER;
  canonical_count INTEGER;
  null_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO total_count FROM winners;
  SELECT COUNT(*) INTO canonical_count FROM winners WHERE user_id LIKE 'prize:pid:%';
  SELECT COUNT(*) INTO null_count FROM winners WHERE user_id IS NULL;

  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'WINNERS TABLE user_id MIGRATION COMPLETE';
  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'Total winners records: %', total_count;
  RAISE NOTICE 'Records with canonical user_id: %', canonical_count;
  RAISE NOTICE 'Records with NULL user_id: %', null_count;
  RAISE NOTICE '=====================================================';
END $$;

COMMIT;
