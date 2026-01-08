-- Migration: Add Ticket Constraints (simplified)
-- Note: Complex functions are created in later migrations

-- Add check constraint for valid ticket numbers
DO $block$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_ticket_number_range') THEN
    ALTER TABLE tickets ADD CONSTRAINT valid_ticket_number_range CHECK (ticket_number >= 1 AND ticket_number <= 1000);
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $block$;

-- Add unique constraint on tickets table
DO $block$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_competition_ticket_assignment') THEN
    ALTER TABLE tickets ADD CONSTRAINT unique_competition_ticket_assignment UNIQUE (competition_id, ticket_number);
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $block$;

-- Add expires_at column to pending_tickets
ALTER TABLE pending_tickets ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '15 minutes');

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_pending_tickets_competition_status ON pending_tickets(competition_id, status);
CREATE INDEX IF NOT EXISTS idx_pending_tickets_expires_at ON pending_tickets(expires_at) WHERE status = 'pending';
