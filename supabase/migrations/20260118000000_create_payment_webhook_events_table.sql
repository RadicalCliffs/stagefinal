-- =====================================================
-- Add payment_webhook_events table for webhook audit trail
-- =====================================================
-- This migration creates a table to log all webhook events
-- from payment providers (Coinbase Commerce, etc.)
-- 
-- Purpose: Track webhook delivery, debug payment issues,
-- and maintain audit trail for all payment webhooks
--
-- Date: 2026-01-18
-- =====================================================

-- Create payment_webhook_events table
CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Provider information
  provider TEXT NOT NULL, -- 'coinbase_commerce', 'stripe', etc.
  event_type TEXT, -- 'charge:confirmed', 'charge:failed', etc.
  
  -- Webhook metadata
  charge_id TEXT, -- External payment ID (e.g., Coinbase charge ID)
  user_id TEXT, -- Canonical user ID from webhook metadata
  competition_id TEXT, -- Competition ID if entry purchase
  transaction_id UUID, -- Our internal transaction ID
  
  -- Webhook delivery info
  status INTEGER NOT NULL DEFAULT 200, -- HTTP status code returned
  webhook_received_at TIMESTAMP WITH TIME ZONE,
  
  -- Full webhook payload
  payload JSONB NOT NULL, -- Complete webhook payload for debugging
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Indexes for efficient querying
  CONSTRAINT payment_webhook_events_pkey PRIMARY KEY (id)
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_provider 
  ON payment_webhook_events(provider);

CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_created_at 
  ON payment_webhook_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_charge_id 
  ON payment_webhook_events(charge_id) 
  WHERE charge_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_transaction_id 
  ON payment_webhook_events(transaction_id) 
  WHERE transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_user_id 
  ON payment_webhook_events(user_id) 
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_event_type 
  ON payment_webhook_events(event_type) 
  WHERE event_type IS NOT NULL;

-- Add comment to table
COMMENT ON TABLE payment_webhook_events IS 
  'Audit trail of all payment webhook events received from external providers. ' ||
  'Used for debugging payment issues and maintaining compliance audit trail.';

-- Add comments to columns
COMMENT ON COLUMN payment_webhook_events.provider IS 
  'Payment provider identifier (e.g., coinbase_commerce, stripe)';

COMMENT ON COLUMN payment_webhook_events.event_type IS 
  'Type of webhook event (e.g., charge:confirmed, charge:failed)';

COMMENT ON COLUMN payment_webhook_events.charge_id IS 
  'External payment/charge ID from the provider';

COMMENT ON COLUMN payment_webhook_events.user_id IS 
  'Canonical user ID extracted from webhook metadata (prize:pid:...)';

COMMENT ON COLUMN payment_webhook_events.transaction_id IS 
  'Internal transaction ID linking to user_transactions table';

COMMENT ON COLUMN payment_webhook_events.status IS 
  'HTTP status code returned to webhook sender (200=success, 401=invalid sig, 500=error)';

COMMENT ON COLUMN payment_webhook_events.payload IS 
  'Complete webhook payload as JSON for debugging and audit trail';

-- Grant permissions
-- Service role has full access (needed for webhook functions)
GRANT ALL ON payment_webhook_events TO service_role;

-- Anon role has no direct access (webhooks use service role)
REVOKE ALL ON payment_webhook_events FROM anon;
REVOKE ALL ON payment_webhook_events FROM authenticated;

-- Create a view for easy debugging (recent webhooks only)
CREATE OR REPLACE VIEW recent_webhook_events AS
SELECT 
  id,
  provider,
  event_type,
  charge_id,
  user_id,
  competition_id,
  transaction_id,
  status,
  webhook_received_at,
  created_at,
  -- Extract key fields from payload without showing entire payload
  payload->'event'->>'type' as payload_event_type,
  payload->'event'->'data'->>'id' as payload_charge_id,
  (payload->'event'->'data'->'metadata'->>'user_id') as payload_user_id
FROM payment_webhook_events
WHERE created_at > NOW() - INTERVAL '7 days'
ORDER BY created_at DESC;

COMMENT ON VIEW recent_webhook_events IS 
  'View of recent webhook events (last 7 days) with key fields extracted from payload';

-- Grant read access to authenticated users for the view
GRANT SELECT ON recent_webhook_events TO authenticated;
GRANT SELECT ON recent_webhook_events TO service_role;

-- Log migration
DO $$
BEGIN
  RAISE NOTICE 'Created payment_webhook_events table for webhook audit trail';
  RAISE NOTICE 'Created recent_webhook_events view for debugging';
  RAISE NOTICE 'Added indexes for efficient webhook querying';
END $$;
