-- ============================================================================
-- FIX ALL STUCK VRF COMPETITIONS
-- ============================================================================
-- This finds ALL competitions that should have been drawn and completes them

DO $$
DECLARE
  v_competition RECORD;
  v_vrf_seed TEXT;
  v_tickets_sold INTEGER;
  v_winning_ticket_number INTEGER;
  v_winner_user_id TEXT;
  v_winner_address TEXT;
  v_now TIMESTAMPTZ := NOW();
  v_hash TEXT;
  v_processed INTEGER := 0;
BEGIN
  RAISE NOTICE '=== FIXING ALL STUCK VRF COMPETITIONS ===';
  RAISE NOTICE '';
  
  -- Find all competitions that:
  -- 1. Have passed end_date
  -- 2. Have VRF seed (were deployed to blockchain)
  -- 3. Don't have winner yet
  -- 4. Are not instant win
  FOR v_competition IN
    SELECT id, title, outcomes_vrf_seed, tickets_sold, end_date
    FROM competitions
    WHERE end_date < NOW()
      AND outcomes_vrf_seed IS NOT NULL
      AND winner_address IS NULL
      AND is_instant_win = false
      AND tickets_sold > 0
    ORDER BY end_date DESC
  LOOP
    RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
    RAISE NOTICE 'Processing: %', v_competition.title;
    RAISE NOTICE 'Ended: %', v_competition.end_date;
    
    v_vrf_seed := v_competition.outcomes_vrf_seed;
    v_tickets_sold := v_competition.tickets_sold;
    
    -- Deterministic winner selection
    v_hash := encode(digest('SELECT-WINNER-' || v_vrf_seed || '-' || v_competition.id::text, 'sha256'), 'hex');
    v_winning_ticket_number := (('x' || substring(v_hash, 1, 16))::bit(64)::bigint % v_tickets_sold) + 1;
    
    RAISE NOTICE 'Winning ticket: #%', v_winning_ticket_number;
    
    -- Find winner - try exact ticket first
    SELECT COALESCE(user_id, canonical_user_id, privy_user_id) as user_id, 
           wallet_address, ticket_number
    INTO v_winner_user_id, v_winner_address, v_winning_ticket_number
    FROM tickets
    WHERE competition_id = v_competition.id
      AND ticket_number = v_winning_ticket_number
    LIMIT 1;
    
    -- If exact ticket doesn't exist, find next available ticket (wrapping around)
    IF v_winner_user_id IS NULL OR v_winner_address IS NULL THEN
      RAISE NOTICE '⚠️  Ticket #% does not exist, finding next available ticket', v_winning_ticket_number;
      
      -- Try tickets >= winning number first
      SELECT COALESCE(user_id, canonical_user_id, privy_user_id) as user_id,
             wallet_address, ticket_number
      INTO v_winner_user_id, v_winner_address, v_winning_ticket_number
      FROM tickets
      WHERE competition_id = v_competition.id
        AND ticket_number >= v_winning_ticket_number
      ORDER BY ticket_number ASC
      LIMIT 1;
      
      -- If none found, wrap to beginning
      IF v_winner_user_id IS NULL OR v_winner_address IS NULL THEN
        SELECT COALESCE(user_id, canonical_user_id, privy_user_id) as user_id,
               wallet_address, ticket_number
        INTO v_winner_user_id, v_winner_address, v_winning_ticket_number
        FROM tickets
        WHERE competition_id = v_competition.id
        ORDER BY ticket_number ASC
        LIMIT 1;
      END IF;
    END IF;
    
    IF v_winner_user_id IS NOT NULL THEN
      RAISE NOTICE 'Winner: % (Ticket #%)', v_winner_address, v_winning_ticket_number;
    ELSE
      RAISE NOTICE '⚠️  No tickets found for this competition!';
    END IF;
    
    -- Update competitions
    UPDATE competitions
    SET 
      winner_address = v_winner_address,
      status = 'completed',
      competitionended = 1,
      drawn_at = v_now,
      vrf_draw_completed_at = v_now,
      updated_at = v_now
    WHERE id = v_competition.id;
    
    -- Insert into competition_winners
    INSERT INTO competition_winners (
      competitionid, Winner, ticket_number, user_id, won_at
    ) VALUES (
      v_competition.id, v_winner_address, v_winning_ticket_number, 
      v_winner_user_id, v_now
    )
    ON CONFLICT DO NOTHING;
    
    -- Insert into winners table
    IF v_winner_user_id IS NOT NULL THEN
      -- Check if winner already exists
      IF NOT EXISTS (
        SELECT 1 FROM winners 
        WHERE competition_id = v_competition.id 
        AND prize_position = 1
      ) THEN
        INSERT INTO winners (
          competition_id, user_id, wallet_address, ticket_number,
          prize_position, won_at, created_at, is_instant_win
        ) VALUES (
          v_competition.id, v_winner_user_id, v_winner_address, v_winning_ticket_number,
          1, v_now, v_now, false
        );
      END IF;
      
      -- Set is_winner flag
      UPDATE joincompetition
      SET is_winner = true
      WHERE competition_id = v_competition.id
        AND user_id = v_winner_user_id;
    END IF;
    
    v_processed := v_processed + 1;
    RAISE NOTICE '✅ Completed';
    RAISE NOTICE '';
  END LOOP;
  
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE 'DONE! Processed % competitions', v_processed;
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
END $$;
