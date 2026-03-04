-- ============================================================================
-- RECALCULATE ALL FINISHED COMPETITION WINNERS WITH SHA256
-- ============================================================================
-- ⚠️ WARNING: This will CHANGE existing winners to use SHA256 algorithm
-- This makes all competitions consistent with the current verification formula
-- Use only if you understand the implications for users who already won

DO $$
DECLARE
  v_competition RECORD;
  v_vrf_seed TEXT;
  v_tickets_sold INTEGER;
  v_winning_ticket_number INTEGER;
  v_winner_user_id TEXT;
  v_winner_address TEXT;
  v_old_winner_address TEXT;
  v_old_ticket_number INTEGER;
  v_now TIMESTAMPTZ := NOW();
  v_hash TEXT;
  v_processed INTEGER := 0;
  v_changed INTEGER := 0;
BEGIN
  RAISE NOTICE '=== RECALCULATING ALL FINISHED COMPETITIONS WITH SHA256 ===';
  RAISE NOTICE '⚠️  This will update existing winners to match SHA256 algorithm';
  RAISE NOTICE '';
  
  -- Find all finished competitions with winners
  FOR v_competition IN
    SELECT id, title, outcomes_vrf_seed, tickets_sold, winner_address, end_date
    FROM competitions
    WHERE outcomes_vrf_seed IS NOT NULL
      AND winner_address IS NOT NULL
      AND is_instant_win = false
      AND tickets_sold > 0
    ORDER BY end_date DESC
  LOOP
    RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
    RAISE NOTICE 'Processing: %', v_competition.title;
    RAISE NOTICE 'Current winner: %', v_competition.winner_address;
    
    -- Store old winner info
    v_old_winner_address := v_competition.winner_address;
    
    -- Get old winning ticket number
    SELECT ticket_number INTO v_old_ticket_number
    FROM winners
    WHERE competition_id = v_competition.id
      AND prize_position = 1
    LIMIT 1;
    
    v_vrf_seed := v_competition.outcomes_vrf_seed;
    v_tickets_sold := v_competition.tickets_sold;
    
    -- Recalculate using SHA256 (correct algorithm)
    v_hash := encode(digest('SELECT-WINNER-' || v_vrf_seed || '-' || v_competition.id::text, 'sha256'), 'hex');
    v_winning_ticket_number := (('x' || substring(v_hash, 1, 16))::bit(64)::bigint % v_tickets_sold) + 1;
    
    RAISE NOTICE 'SHA256 calculated ticket: #%', v_winning_ticket_number;
    RAISE NOTICE 'Old winning ticket: #%', v_old_ticket_number;
    
    -- Find winner with fallback logic
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
        
        RAISE NOTICE '⚠️  Wrapped to first ticket: #%', v_winning_ticket_number;
      ELSE
        RAISE NOTICE '⚠️  Using next available ticket: #%', v_winning_ticket_number;
      END IF;
    END IF;
    
    IF v_winner_user_id IS NOT NULL THEN
      RAISE NOTICE 'New SHA256 winner: % (Ticket #%)', v_winner_address, v_winning_ticket_number;
      
      -- Check if winner changed
      IF v_winner_address != v_old_winner_address THEN
        RAISE NOTICE '🔄 WINNER CHANGED from % to %', v_old_winner_address, v_winner_address;
        v_changed := v_changed + 1;
        
        -- Clear old winner's is_winner flag
        UPDATE joincompetition
        SET is_winner = false
        WHERE competition_id = v_competition.id
          AND is_winner = true;
          
        -- Delete old winner records
        DELETE FROM winners
        WHERE competition_id = v_competition.id;
        
        DELETE FROM competition_winners
        WHERE competitionid = v_competition.id;
      ELSE
        RAISE NOTICE '✓ Winner unchanged';
      END IF;
      
      -- Update competitions table
      UPDATE competitions
      SET 
        winner_address = v_winner_address,
        updated_at = v_now
      WHERE id = v_competition.id;
      
      -- Update/Insert into competition_winners
      DELETE FROM competition_winners WHERE competitionid = v_competition.id;
      INSERT INTO competition_winners (
        competitionid, Winner, ticket_number, user_id, won_at
      ) VALUES (
        v_competition.id, v_winner_address, v_winning_ticket_number, 
        v_winner_user_id, v_now
      );
      
      -- Update/Insert into winners table
      DELETE FROM winners WHERE competition_id = v_competition.id;
      INSERT INTO winners (
        competition_id, user_id, wallet_address, ticket_number,
        prize_position, won_at, created_at, is_instant_win
      ) VALUES (
        v_competition.id, v_winner_user_id, v_winner_address, v_winning_ticket_number,
        1, v_now, v_now, false
      );
      
      -- Set new winner's is_winner flag
      UPDATE joincompetition
      SET is_winner = true
      WHERE competition_id = v_competition.id
        AND user_id = v_winner_user_id;
    ELSE
      RAISE NOTICE '⚠️  No tickets found for this competition!';
    END IF;
    
    v_processed := v_processed + 1;
    RAISE NOTICE '';
  END LOOP;
  
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE 'DONE! Processed % competitions', v_processed;
  RAISE NOTICE 'Winners changed: %', v_changed;
  RAISE NOTICE 'All competitions now use SHA256 algorithm consistently';
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
END $$;
