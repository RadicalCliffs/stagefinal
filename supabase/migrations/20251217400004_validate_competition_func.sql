-- PART 9: VALIDATION FUNCTION - Check Competition Ready for Sales

CREATE OR REPLACE FUNCTION validate_competition_for_sales(
  p_competition_id UUID
)
RETURNS JSONB AS $func$
DECLARE
  v_competition RECORD;
  v_outcome_count INTEGER;
  v_errors TEXT[] := '{}';
BEGIN
  SELECT * INTO v_competition
  FROM competitions
  WHERE id = p_competition_id;

  IF v_competition IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'errors', ARRAY['Competition not found']);
  END IF;

  -- Check status
  IF v_competition.status != 'active' THEN
    v_errors := array_append(v_errors, 'Competition is not active (status: ' || v_competition.status || ')');
  END IF;

  -- Check total tickets
  IF v_competition.total_tickets IS NULL OR v_competition.total_tickets <= 0 THEN
    v_errors := array_append(v_errors, 'Competition has no ticket allocation');
  END IF;

  -- For instant-win, check outcomes are generated
  IF v_competition.is_instant_win THEN
    SELECT COUNT(*) INTO v_outcome_count
    FROM "Prize_Instantprizes"
    WHERE "competitionId" = p_competition_id;

    IF v_outcome_count = 0 THEN
      v_errors := array_append(v_errors, 'Instant-win outcomes not generated');
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'valid', array_length(v_errors, 1) IS NULL OR array_length(v_errors, 1) = 0,
    'errors', v_errors,
    'competition_id', p_competition_id,
    'title', v_competition.title,
    'is_instant_win', v_competition.is_instant_win,
    'total_tickets', v_competition.total_tickets,
    'tickets_sold', v_competition.tickets_sold
  );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;
