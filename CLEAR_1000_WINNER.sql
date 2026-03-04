-- Clear the broken $1000 competition winner data so we can re-run the fix

DO $$
DECLARE
  v_comp_id UUID;
BEGIN
  -- Get $1000 competition ID
  SELECT id INTO v_comp_id FROM competitions WHERE title = '$1000';
  
  IF v_comp_id IS NOT NULL THEN
    RAISE NOTICE 'Clearing broken winner data for $1000...';
    
    -- Clear competitions table
    UPDATE competitions
    SET 
      winner_address = NULL,
      status = 'ended',
      competitionended = 0,
      drawn_at = NULL,
      vrf_draw_completed_at = NULL,
      outcomes_vrf_seed = NULL
    WHERE id = v_comp_id;
    
    -- Delete from winners
    DELETE FROM winners WHERE competition_id = v_comp_id;
    
    -- Delete from competition_winners
    DELETE FROM competition_winners WHERE competitionid = v_comp_id;
    
    -- Clear is_winner flags
    UPDATE joincompetition
    SET is_winner = false
    WHERE competition_id = v_comp_id;
    
    RAISE NOTICE '✅ Cleared. Ready to re-run fix.';
  ELSE
    RAISE NOTICE '❌ $1000 competition not found';
  END IF;
END $$;
