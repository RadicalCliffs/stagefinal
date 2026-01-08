-- Pending Tickets Table
-- Stores ticket reservations before payment is confirmed
-- This creates an "impossible to fail" flow where tickets are reserved immediately
-- and only confirmed after successful payment

CREATE TABLE IF NOT EXISTS pending_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,                          -- Privy user ID
    competition_id UUID NOT NULL,                   -- Competition ID
    ticket_numbers INTEGER[] NOT NULL,              -- Array of selected ticket numbers
    ticket_count INTEGER NOT NULL,                  -- Number of tickets
    ticket_price DECIMAL(10,2) DEFAULT 1.00,        -- Price per ticket
    total_amount DECIMAL(10,2) NOT NULL,            -- Total amount to pay
    status TEXT NOT NULL DEFAULT 'pending',         -- pending, confirmed, expired, cancelled
    session_id TEXT,                                -- Payment session ID for lookup
    transaction_hash TEXT,                          -- Payment transaction hash (after confirmation)
    payment_provider TEXT,                          -- nowpayments, instaxchange, balance
    expires_at TIMESTAMPTZ NOT NULL,                -- When the reservation expires
    confirmed_at TIMESTAMPTZ,                       -- When payment was confirmed
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT valid_status CHECK (status IN ('pending', 'confirmed', 'expired', 'cancelled')),
    CONSTRAINT positive_ticket_count CHECK (ticket_count > 0),
    CONSTRAINT positive_amount CHECK (total_amount >= 0)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_pending_tickets_user_id ON pending_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_pending_tickets_competition_id ON pending_tickets(competition_id);
CREATE INDEX IF NOT EXISTS idx_pending_tickets_status ON pending_tickets(status);
CREATE INDEX IF NOT EXISTS idx_pending_tickets_session_id ON pending_tickets(session_id);
CREATE INDEX IF NOT EXISTS idx_pending_tickets_expires_at ON pending_tickets(expires_at);
CREATE INDEX IF NOT EXISTS idx_pending_tickets_user_comp_status ON pending_tickets(user_id, competition_id, status);

-- Function to automatically expire old pending reservations
CREATE OR REPLACE FUNCTION expire_pending_tickets()
RETURNS void AS $$
BEGIN
    UPDATE pending_tickets
    SET status = 'expired', updated_at = NOW()
    WHERE status = 'pending'
    AND expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- Create a scheduled job to run every minute (if pg_cron is available)
-- This cleans up expired reservations automatically
-- Note: pg_cron must be enabled in Supabase dashboard
DO $$
BEGIN
    -- Try to create the cron job, ignore if pg_cron not available
    PERFORM cron.schedule(
        'expire-pending-tickets',
        '* * * * *',  -- Every minute
        'SELECT expire_pending_tickets()'
    );
EXCEPTION
    WHEN undefined_function THEN
        RAISE NOTICE 'pg_cron not available, skipping scheduled job creation';
    WHEN OTHERS THEN
        RAISE NOTICE 'Could not create cron job: %', SQLERRM;
END $$;

-- RLS Policies
ALTER TABLE pending_tickets ENABLE ROW LEVEL SECURITY;

-- Users can view their own pending tickets
DROP POLICY IF EXISTS "Users can view own pending tickets" ON pending_tickets;
CREATE POLICY "Users can view own pending tickets"
    ON pending_tickets FOR SELECT
    USING (auth.uid()::text = user_id OR auth.jwt() ->> 'sub' = user_id);

-- Only service role can insert/update (via Edge Functions)
DROP POLICY IF EXISTS "Service role can manage pending tickets" ON pending_tickets;
CREATE POLICY "Service role can manage pending tickets"
    ON pending_tickets FOR ALL
    USING (auth.role() = 'service_role');

-- Grant permissions
GRANT SELECT ON pending_tickets TO authenticated;
GRANT ALL ON pending_tickets TO service_role;

-- Add comment for documentation
COMMENT ON TABLE pending_tickets IS 'Stores ticket reservations before payment confirmation. Tickets are held for 15 minutes.';
COMMENT ON COLUMN pending_tickets.ticket_numbers IS 'Array of specific ticket numbers the user selected';
COMMENT ON COLUMN pending_tickets.expires_at IS 'Reservation expires 15 minutes after creation';
COMMENT ON COLUMN pending_tickets.status IS 'pending=awaiting payment, confirmed=payment received, expired=timed out, cancelled=user cancelled';
