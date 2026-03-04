-- ============================================================================
-- MANUALLY COMPLETE A COMPETITION WITH VRF WINNER SELECTION
-- ============================================================================
-- This SQL does what vrf-draw-winner function does, but directly in SQL
-- Use this to manually complete a stuck competition

DO $$
DECLARE
  v_competition_id UUID := 'YOUR_COMPETITION_ID_HERE'; -- CHANGE THIS
  v_competition RECORD;
  v_vrf_seed TEXT;
  v_tickets_sold INTEGER;
  v_winning_ticket_number INTEGER;
  v_winner_user_id TEXT;
  v_winner_address TEXT;
  v_now TIMESTAMPTZ := NOW();
  v_hash TEXT;
BEGIN
  RAISE NOTICE '=== MANUAL VRF WINNER SELECTION ===';
  RAISE NOTICE '';
  
  -- Get competition details
  SELECT id, title, outcomes_vrf_seed, tickets_sold, winner_address
  INTO v_competition
  FROM competitions
  WHERE id = v_competition_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Competition not found: %', v_competition_id;
  END IF;
  
  IF v_competition.winner_address IS NOT NULL THEN
    RAISE NOTICE '⚠️  Winner already selected: %', v_competition.winner_address;
    RETURN;
  END IF;
  
  v_vrf_seed := v_competition.outcomes_vrf_seed;
  v_tickets_sold := v_competition.tickets_sold;
  
  IF v_vrf_seed IS NULL THEN
    RAISE EXCEPTION 'No VRF seed found for competition';
  END IF;
  
  IF v_tickets_sold = 0 THEN
    RAISE EXCEPTION 'No tickets sold';
  END IF;
  
  RAISE NOTICE 'Competition: %', v_competition.title;
  RAISE NOTICE 'Tickets sold: %', v_tickets_sold;
  RAISE NOTICE 'VRF Seed: %', v_vrf_seed;
  RAISE NOTICE '';
  
  -- Deterministic winner selection using VRF seed
  -- Simulates keccak256 by using PostgreSQL's digest function
  v_hash := encode(digest('SELECT-WINNER-' || v_vrf_seed || '-' || v_competition_id::text, 'sha256'), 'hex');
  
  -- Convert first 16 hex chars to number and mod by tickets_sold
  v_winning_ticket_number := (('x' || substring(v_hash, 1, 16))::bit(64)::bigint % v_tickets_sold) + 1;
  
  RAISE NOTICE '🎫 Winning ticket number: %', v_winning_ticket_number;
  
  -- Find ticket owner
  SELECT user_id, wallet_address
  INTO v_winner_user_id, v_winner_address
  FROM tickets
  WHERE competition_id = v_competition_id
    AND ticket_number = v_winning_ticket_number
  LIMIT 1;
  
  IF v_winner_user_id IS NULL THEN
    RAISE NOTICE '⚠️  Could not find ticket owner';
  ELSE
    RAISE NOTICE '🏆 Winner: %', v_winner_address;
  END IF;
  
  -- Update competitions table
  UPDATE competitions
  SET 
    winner_address = v_winner_address,
    status = 'completed',
    competitionended = 1,
    drawn_at = v_now,
    vrf_draw_completed_at = v_now,
    updated_at = v_now
  WHERE id = v_competition_id;
  
  RAISE NOTICE '✅ Competition updated to completed';
  
  -- Insert into competition_winners
  INSERT INTO competition_winners (
    competitionid, Winner, ticket_number, user_id, won_at
  ) VALUES (
    v_competition_id, v_winner_address, v_winning_ticket_number, 
    v_winner_user_id, v_now
  )
  ON CONFLICT DO NOTHING;
  
  RAISE NOTICE '✅ Inserted into competition_winners';
  
  -- Insert into winners table (CRITICAL for frontend)
  IF v_winner_user_id IS NOT NULL THEN
    -- Check if winner already exists
    IF NOT EXISTS (
      SELECT 1 FROM winners 
      WHERE competition_id = v_competition_id 
      AND prize_position = 1
    ) THEN
      INSERT INTO winners (
        competition_id, user_id, wallet_address, ticket_number,
        prize_position, won_at, created_at, is_instant_win
      ) VALUES (
        v_competition_id, v_winner_user_id, v_winner_address, v_winning_ticket_number,
        1, v_now, v_now, false
      );
    END IF;
    
    RAISE NOTICE '✅ Inserted into winners table';
    
    -- Set is_winner flag in joincompetition
    UPDATE joincompetition
    SET is_winner = true
    WHERE competition_id = v_competition_id
      AND user_id = v_winner_user_id;
    
    RAISE NOTICE '✅ Set is_winner flag';
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE '🎉 WINNER SELECTION COMPLETE!';
  RAISE NOTICE '  Competition: %', v_competition.title;
  RAISE NOTICE '  Winning Ticket: #%', v_winning_ticket_number;
  RAISE NOTICE '  Winner: %', COALESCE(v_winner_address, 'UNKNOWN');
END $$;
