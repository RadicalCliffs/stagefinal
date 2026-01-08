/*
  ============================================================================
  SINGLE AUTHORITATIVE FLOW - Schema Changes (Parts 1-4)
  ============================================================================
*/

-- ============================================================================
-- PART 1: PENDING_TICKETS - Reservation Authority
-- ============================================================================

-- Ensure status constraint includes 'confirming' state for atomic locks
ALTER TABLE pending_tickets DROP CONSTRAINT IF EXISTS valid_status;
ALTER TABLE pending_tickets ADD CONSTRAINT valid_status
  CHECK (status IN ('pending', 'confirming', 'confirmed', 'expired', 'cancelled'));

-- Add column for tracking allocation attempts (idempotency)
ALTER TABLE pending_tickets ADD COLUMN IF NOT EXISTS allocation_attempts INTEGER DEFAULT 0;
ALTER TABLE pending_tickets ADD COLUMN IF NOT EXISTS last_allocation_attempt TIMESTAMPTZ;

-- Index for fast expiry lookups
CREATE INDEX IF NOT EXISTS idx_pending_tickets_status_expires
  ON pending_tickets(status, expires_at)
  WHERE status = 'pending';

-- ============================================================================
-- PART 2: TICKETS TABLE - Ownership Authority
-- ============================================================================

-- Add pending_ticket_id reference for audit trail
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS pending_ticket_id UUID;
CREATE INDEX IF NOT EXISTS idx_tickets_pending_ticket_id ON tickets(pending_ticket_id);

-- ============================================================================
-- PART 3: PRIZE_INSTANTPRIZES - Outcome Authority
-- ============================================================================

-- Add VRF audit columns
ALTER TABLE "Prize_Instantprizes" ADD COLUMN IF NOT EXISTS vrf_seed TEXT;
ALTER TABLE "Prize_Instantprizes" ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE "Prize_Instantprizes" ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

-- ============================================================================
-- PART 4: COMPETITIONS - Add Instant-Win State Tracking
-- ============================================================================

-- Track if outcomes have been generated (prevents regeneration)
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS winning_tickets_generated BOOLEAN DEFAULT FALSE;
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS outcomes_generated_at TIMESTAMPTZ;
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS outcomes_vrf_seed TEXT;
