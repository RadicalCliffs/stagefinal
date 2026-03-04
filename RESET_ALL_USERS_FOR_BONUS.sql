-- ============================================================================
-- RESET ALL USERS FOR 50% BONUS
-- ============================================================================
-- This resets has_used_new_user_bonus to false for ALL users
-- So EVERYONE gets the 50% bonus on their NEXT topup

DO $$
DECLARE
  v_reset_count INTEGER;
BEGIN
  RAISE NOTICE '=== RESETTING ALL USERS TO GET 50%% BONUS ===';
  RAISE NOTICE '';
  
  -- Set has_used_new_user_bonus = false for ALL users
  UPDATE canonical_users
  SET 
    has_used_new_user_bonus = false,
    updated_at = NOW()
  WHERE has_used_new_user_bonus = true OR has_used_new_user_bonus IS NULL;
  
  GET DIAGNOSTICS v_reset_count = ROW_COUNT;
  
  RAISE NOTICE '✅ Reset % users to receive 50%% bonus on next topup', v_reset_count;
  RAISE NOTICE '';
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE 'DONE! All users will get 50%% bonus on their NEXT topup';
  RAISE NOTICE 'After that topup, they will NOT get the bonus again';
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
END $$;
