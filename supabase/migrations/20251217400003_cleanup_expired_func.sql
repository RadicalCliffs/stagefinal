-- PART 8: CLEANUP FUNCTION FOR EXPIRED RESERVATIONS

CREATE OR REPLACE FUNCTION cleanup_expired_pending_tickets()
RETURNS INTEGER AS $func$
DECLARE
  v_expired_count INTEGER;
BEGIN
  WITH expired AS (
    UPDATE pending_tickets
    SET status = 'expired', updated_at = NOW()
    WHERE status = 'pending'
      AND expires_at < NOW()
    RETURNING id
  )
  SELECT COUNT(*) INTO v_expired_count FROM expired;

  RETURN v_expired_count;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;
