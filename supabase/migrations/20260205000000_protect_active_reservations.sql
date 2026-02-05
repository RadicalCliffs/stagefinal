-- =====================================================
-- PROTECT ACTIVE RESERVATIONS FROM AUTO-EXPIRATION
-- =====================================================
-- This migration prevents premature expiration of reservations
-- that are still within their hold_minutes window.
--
-- Problem: Reservations were being marked as expired by triggers
-- and cron jobs even though they were still within their valid
-- 15-minute hold period.
--
-- Solution: Add grace period check to ensure reservations are
-- NEVER expired while still within their intended hold window.
-- =====================================================

BEGIN;

-- =====================================================
-- SECTION 1: UPDATE AUTO-EXPIRE TRIGGER FUNCTION
-- =====================================================
-- Modify the trigger to respect the hold_minutes grace period
-- Reservations within their hold window are PROTECTED from expiration

CREATE OR REPLACE FUNCTION auto_expire_reservations()
RETURNS TRIGGER AS $$
DECLARE
  v_grace_period_minutes INTEGER := 15; -- Default grace period
  v_hold_minutes INTEGER;
  v_time_since_creation INTERVAL;
  v_should_expire BOOLEAN := FALSE;
BEGIN
  -- Called on INSERT or UPDATE
  -- Only process if expires_at is set and status is pending
  IF NEW.expires_at IS NOT NULL AND NEW.status = 'pending' THEN
    
    -- Get the hold_minutes value (default to 15 if not set)
    v_hold_minutes := COALESCE(NEW.hold_minutes, v_grace_period_minutes);
    
    -- Calculate time since creation
    v_time_since_creation := NOW() - NEW.created_at;
    
    -- Determine if reservation should expire
    -- CRITICAL: NEVER expire if within hold_minutes window
    -- This protects active reservations from premature expiration
    IF NEW.expires_at < NOW() THEN
      -- Check if we're past the grace period
      IF v_time_since_creation > (v_hold_minutes || ' minutes')::INTERVAL THEN
        v_should_expire := TRUE;
      END IF;
    END IF;
    
    -- Only mark as expired if truly past the grace period
    IF v_should_expire THEN
      NEW.status := 'expired';
      RAISE NOTICE 'Reservation % expired after % minutes (hold window: % minutes)', 
        NEW.id, 
        EXTRACT(EPOCH FROM v_time_since_creation) / 60,
        v_hold_minutes;
    ELSE
      -- Log that we're protecting this reservation
      IF NEW.expires_at < NOW() THEN
        RAISE NOTICE 'Reservation % protected from expiration (within %min grace period, age: %min)', 
          NEW.id,
          v_hold_minutes,
          EXTRACT(EPOCH FROM v_time_since_creation) / 60;
      END IF;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- SECTION 2: ADD CLEANUP HELPER FUNCTION
-- =====================================================
-- Function to safely expire old reservations while respecting grace period
-- This can be called by cron jobs or maintenance tasks

CREATE OR REPLACE FUNCTION cleanup_expired_reservations(
  p_grace_period_minutes INTEGER DEFAULT 15
)
RETURNS TABLE (
  expired_count INTEGER,
  protected_count INTEGER
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expired_count INTEGER := 0;
  v_protected_count INTEGER := 0;
  v_cutoff_time TIMESTAMPTZ;
BEGIN
  -- Calculate the cutoff time: NOW - grace_period
  v_cutoff_time := NOW() - (p_grace_period_minutes || ' minutes')::INTERVAL;
  
  -- Count reservations that would be protected
  SELECT COUNT(*) INTO v_protected_count
  FROM pending_tickets
  WHERE status = 'pending'
    AND expires_at < NOW()
    AND created_at > v_cutoff_time;
  
  -- Only expire reservations that are truly old (past grace period)
  UPDATE pending_tickets
  SET 
    status = 'expired',
    updated_at = NOW(),
    note = COALESCE(note || ' | ', '') || 'Auto-expired by cleanup function'
  WHERE status = 'pending'
    AND expires_at < NOW()
    AND created_at <= v_cutoff_time;
  
  GET DIAGNOSTICS v_expired_count = ROW_COUNT;
  
  -- Log the results
  RAISE NOTICE 'Cleanup complete: % expired, % protected (within %min grace period)', 
    v_expired_count, v_protected_count, p_grace_period_minutes;
  
  RETURN QUERY SELECT v_expired_count, v_protected_count;
END;
$$;

-- =====================================================
-- SECTION 3: GRANT PERMISSIONS
-- =====================================================

-- Grant execute on cleanup function
GRANT EXECUTE ON FUNCTION cleanup_expired_reservations TO service_role;
GRANT EXECUTE ON FUNCTION cleanup_expired_reservations TO authenticated;

-- =====================================================
-- SECTION 4: ADD HELPFUL INDEXES
-- =====================================================

-- Index to efficiently find expired but still in grace period
CREATE INDEX IF NOT EXISTS idx_pending_tickets_expiry_check 
ON pending_tickets(status, expires_at, created_at) 
WHERE status = 'pending';

-- Index for hold_minutes queries
CREATE INDEX IF NOT EXISTS idx_pending_tickets_hold_minutes 
ON pending_tickets(hold_minutes) 
WHERE status = 'pending';

COMMIT;

-- =====================================================
-- VERIFICATION QUERIES (for manual testing)
-- =====================================================

-- Check protected reservations:
-- SELECT id, created_at, expires_at, hold_minutes, status,
--        NOW() - created_at AS age,
--        expires_at - NOW() AS time_until_expiry
-- FROM pending_tickets
-- WHERE status = 'pending'
-- AND expires_at < NOW()
-- AND created_at > NOW() - INTERVAL '15 minutes'
-- ORDER BY created_at DESC;

-- Test cleanup function:
-- SELECT * FROM cleanup_expired_reservations(15);
