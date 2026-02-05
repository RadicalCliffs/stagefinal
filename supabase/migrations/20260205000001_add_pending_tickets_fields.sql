-- =====================================================
-- UPDATE PENDING_TICKETS SCHEMA TO MATCH PRODUCTION
-- =====================================================
-- This migration adds all missing fields to pending_tickets table
-- to match the production schema as shown in user's example row.
--
-- Fields being added:
-- - canonical_user_id: Canonical user identifier
-- - wallet_address: User's wallet address
-- - hold_minutes: Hold duration (default 15)
-- - reservation_id: Unique reservation identifier
-- - session_id: Session tracking
-- - ticket_price: Price per ticket
-- - confirmed_at: Confirmation timestamp
-- - updated_at: Last update timestamp
-- - transaction_hash: Payment transaction hash
-- - payment_provider: Payment method used
-- - ticket_numbers: JSON array of ticket numbers
-- - payment_id: Payment identifier
-- - idempotency_key: For idempotent operations
-- - privy_user_id: Legacy Privy user ID
-- - user_privy_id: Another Privy field
-- - note: General notes field
-- =====================================================

BEGIN;

-- Add all missing columns to pending_tickets table
-- Use IF NOT EXISTS to make migration idempotent

-- Canonical user ID (matches the user's data format)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pending_tickets' AND column_name = 'canonical_user_id'
  ) THEN
    ALTER TABLE pending_tickets ADD COLUMN canonical_user_id TEXT;
  END IF;
END $$;

-- Wallet address
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pending_tickets' AND column_name = 'wallet_address'
  ) THEN
    ALTER TABLE pending_tickets ADD COLUMN wallet_address TEXT;
  END IF;
END $$;

-- Hold duration in minutes (default 15)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pending_tickets' AND column_name = 'hold_minutes'
  ) THEN
    ALTER TABLE pending_tickets ADD COLUMN hold_minutes INTEGER DEFAULT 15;
  END IF;
END $$;

-- Reservation ID (unique identifier for this reservation)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pending_tickets' AND column_name = 'reservation_id'
  ) THEN
    ALTER TABLE pending_tickets ADD COLUMN reservation_id TEXT;
  END IF;
END $$;

-- Session ID for tracking
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pending_tickets' AND column_name = 'session_id'
  ) THEN
    ALTER TABLE pending_tickets ADD COLUMN session_id TEXT;
  END IF;
END $$;

-- Ticket price per ticket
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pending_tickets' AND column_name = 'ticket_price'
  ) THEN
    ALTER TABLE pending_tickets ADD COLUMN ticket_price NUMERIC(10, 2);
  END IF;
END $$;

-- Confirmation timestamp
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pending_tickets' AND column_name = 'confirmed_at'
  ) THEN
    ALTER TABLE pending_tickets ADD COLUMN confirmed_at TIMESTAMPTZ;
  END IF;
END $$;

-- Updated timestamp (for tracking last modification)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pending_tickets' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE pending_tickets ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
  END IF;
END $$;

-- Transaction hash from payment
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pending_tickets' AND column_name = 'transaction_hash'
  ) THEN
    ALTER TABLE pending_tickets ADD COLUMN transaction_hash TEXT;
  END IF;
END $$;

-- Payment provider (balance, base_account, crypto, etc.)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pending_tickets' AND column_name = 'payment_provider'
  ) THEN
    ALTER TABLE pending_tickets ADD COLUMN payment_provider TEXT;
  END IF;
END $$;

-- Ticket numbers as JSON array
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pending_tickets' AND column_name = 'ticket_numbers'
  ) THEN
    ALTER TABLE pending_tickets ADD COLUMN ticket_numbers JSONB;
  END IF;
END $$;

-- Payment ID
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pending_tickets' AND column_name = 'payment_id'
  ) THEN
    ALTER TABLE pending_tickets ADD COLUMN payment_id TEXT;
  END IF;
END $$;

-- Idempotency key for safe retries
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pending_tickets' AND column_name = 'idempotency_key'
  ) THEN
    ALTER TABLE pending_tickets ADD COLUMN idempotency_key TEXT;
  END IF;
END $$;

-- Legacy Privy user ID fields
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pending_tickets' AND column_name = 'privy_user_id'
  ) THEN
    ALTER TABLE pending_tickets ADD COLUMN privy_user_id TEXT;
  END IF;
END $$;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pending_tickets' AND column_name = 'user_privy_id'
  ) THEN
    ALTER TABLE pending_tickets ADD COLUMN user_privy_id TEXT;
  END IF;
END $$;

-- General notes field for tracking/debugging
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pending_tickets' AND column_name = 'note'
  ) THEN
    ALTER TABLE pending_tickets ADD COLUMN note TEXT;
  END IF;
END $$;

-- =====================================================
-- ADD HELPFUL INDEXES
-- =====================================================

-- Index for canonical_user_id lookups
CREATE INDEX IF NOT EXISTS idx_pending_tickets_canonical_user_id 
ON pending_tickets(canonical_user_id);

-- Index for wallet_address lookups
CREATE INDEX IF NOT EXISTS idx_pending_tickets_wallet_address 
ON pending_tickets(LOWER(wallet_address));

-- Index for reservation_id (unique lookups)
CREATE INDEX IF NOT EXISTS idx_pending_tickets_reservation_id 
ON pending_tickets(reservation_id);

-- Index for transaction_hash (payment tracking)
CREATE INDEX IF NOT EXISTS idx_pending_tickets_transaction_hash 
ON pending_tickets(transaction_hash);

-- Index for payment_provider (filtering by payment method)
CREATE INDEX IF NOT EXISTS idx_pending_tickets_payment_provider 
ON pending_tickets(payment_provider);

-- Index for confirmed_at (finding confirmed reservations)
CREATE INDEX IF NOT EXISTS idx_pending_tickets_confirmed_at 
ON pending_tickets(confirmed_at);

-- =====================================================
-- BACKFILL CANONICAL_USER_ID FROM USER_ID
-- =====================================================
-- Convert existing user_id values to canonical format if needed

UPDATE pending_tickets
SET canonical_user_id = user_id
WHERE canonical_user_id IS NULL 
  AND user_id IS NOT NULL;

-- =====================================================
-- UPDATE TRIGGER FOR UPDATED_AT
-- =====================================================
-- Ensure updated_at is set on modifications (if trigger exists)

DROP TRIGGER IF EXISTS update_pending_tickets_updated_at_v2 ON pending_tickets;
CREATE TRIGGER update_pending_tickets_updated_at_v2
  BEFORE UPDATE ON pending_tickets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

COMMIT;

-- =====================================================
-- VERIFICATION QUERY
-- =====================================================
-- Run this to verify all columns exist:
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'pending_tickets'
-- ORDER BY ordinal_position;
