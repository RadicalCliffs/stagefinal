-- ============================================================================
-- BACKFILL: Fix all "Unknown" and NULL usernames in winners table
-- ============================================================================
-- This script finds all winners with missing usernames and tries multiple
-- lookup strategies to find the correct username from canonical_users
-- ============================================================================

DO $$
DECLARE
  v_winner RECORD;
  v_username TEXT;
  v_fixed_count INTEGER := 0;
  v_failed_count INTEGER := 0;
  v_total_count INTEGER;
BEGIN
  -- Count total winners with Unknown/NULL usernames
  SELECT COUNT(*) INTO v_total_count
  FROM winners
  WHERE username IS NULL 
     OR username = '' 
     OR username = 'Unknown' 
     OR username = 'Anonymous'
     OR username = 'Winner';

  RAISE NOTICE '=== BACKFILL WINNER USERNAMES ===';
  RAISE NOTICE 'Found % winners with missing usernames', v_total_count;
  RAISE NOTICE '';

  -- Loop through all problematic winners
  FOR v_winner IN
    SELECT 
      id,
      competition_id,
      user_id,
      wallet_address,
      username as old_username,
      ticket_number
    FROM winners
    WHERE username IS NULL 
       OR username = '' 
       OR username = 'Unknown' 
       OR username = 'Anonymous'
       OR username = 'Winner'
    ORDER BY created_at DESC
  LOOP
    v_username := NULL;

    -- Strategy 1: Try user_id as canonical_user_id
    IF v_winner.user_id IS NOT NULL AND v_username IS NULL THEN
      SELECT cu.username INTO v_username
      FROM canonical_users cu
      WHERE cu.canonical_user_id = v_winner.user_id
        AND cu.username IS NOT NULL
        AND cu.username != ''
      LIMIT 1;
    END IF;

    -- Strategy 2: Try user_id as UUID id
    IF v_winner.user_id IS NOT NULL AND v_username IS NULL THEN
      BEGIN
        SELECT cu.username INTO v_username
        FROM canonical_users cu
        WHERE cu.id = v_winner.user_id::UUID
          AND cu.username IS NOT NULL
          AND cu.username != ''
        LIMIT 1;
      EXCEPTION WHEN OTHERS THEN
        -- user_id is not a valid UUID, skip
      END;
    END IF;

    -- Strategy 3: Try wallet_address (case-insensitive)
    IF v_winner.wallet_address IS NOT NULL AND v_username IS NULL THEN
      SELECT cu.username INTO v_username
      FROM canonical_users cu
      WHERE LOWER(cu.wallet_address) = LOWER(v_winner.wallet_address)
        AND cu.username IS NOT NULL
        AND cu.username != ''
      LIMIT 1;
    END IF;

    -- Strategy 4: Try canonical_user_id derived from wallet_address
    IF v_winner.wallet_address IS NOT NULL AND v_username IS NULL THEN
      SELECT cu.username INTO v_username
      FROM canonical_users cu
      WHERE cu.canonical_user_id = ('prize:pid:' || LOWER(v_winner.wallet_address))
        AND cu.username IS NOT NULL
        AND cu.username != ''
      LIMIT 1;
    END IF;

    -- Strategy 5: Try finding user via tickets table
    IF v_winner.competition_id IS NOT NULL 
       AND v_winner.ticket_number IS NOT NULL 
       AND v_username IS NULL THEN
      SELECT cu.username INTO v_username
      FROM tickets t
      JOIN canonical_users cu ON cu.canonical_user_id = t.canonical_user_id
      WHERE t.competition_id = v_winner.competition_id
        AND t.ticket_number = v_winner.ticket_number
        AND cu.username IS NOT NULL
        AND cu.username != ''
      LIMIT 1;
    END IF;

    -- Update if we found a username
    IF v_username IS NOT NULL THEN
      UPDATE winners
      SET 
        username = v_username,
        updated_at = NOW()
      WHERE id = v_winner.id;

      v_fixed_count := v_fixed_count + 1;
      
      RAISE NOTICE 'Fixed winner ID %: % → %', 
        v_winner.id, 
        v_winner.old_username, 
        v_username;
    ELSE
      v_failed_count := v_failed_count + 1;
      
      RAISE WARNING 'Could not find username for winner ID % (comp: %, user_id: %, wallet: %)', 
        v_winner.id,
        v_winner.competition_id,
        COALESCE(v_winner.user_id, 'NULL'),
        COALESCE(v_winner.wallet_address, 'NULL');
    END IF;
  END LOOP;

  RAISE NOTICE '';
  RAISE NOTICE '=== BACKFILL COMPLETE ===';
  RAISE NOTICE 'Total problematic winners: %', v_total_count;
  RAISE NOTICE 'Successfully fixed: %', v_fixed_count;
  RAISE NOTICE 'Still unresolved: %', v_failed_count;
  
  IF v_failed_count > 0 THEN
    RAISE WARNING 'Some winners still have missing usernames - manual investigation required';
  ELSE
    RAISE NOTICE '✅ All winners now have valid usernames!';
  END IF;
END $$;

-- Verify results
SELECT 
  COUNT(*) as remaining_unknown_count,
  array_agg(DISTINCT username) as remaining_unknown_values
FROM winners
WHERE username IS NULL 
   OR username = '' 
   OR username = 'Unknown' 
   OR username = 'Anonymous'
   OR username = 'Winner';
