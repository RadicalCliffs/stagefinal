-- Migration: Remove InstaxChange and NowPayments payment infrastructure (safe version)
-- This migration cleans up deprecated payment providers and consolidates on Base/USDC payments

-- Add notes column if it doesn't exist
ALTER TABLE user_transactions ADD COLUMN IF NOT EXISTS notes TEXT;

-- Mark legacy nowpayments transactions (preserve data but mark as legacy)
UPDATE user_transactions
SET notes = COALESCE(notes, '') || ' [Legacy: NowPayments provider removed]', updated_at = NOW()
WHERE payment_provider IN ('nowpayments', 'now-payments', 'NowPayments')
  AND status NOT IN ('completed', 'failed', 'cancelled', 'expired');

-- Mark legacy instaxchange transactions
UPDATE user_transactions
SET notes = COALESCE(notes, '') || ' [Legacy: InstaxChange provider removed]', updated_at = NOW()
WHERE payment_provider IN ('instaxchange', 'insta-xchange', 'InstaXchange')
  AND status NOT IN ('completed', 'failed', 'cancelled', 'expired');

-- Cancel stale pending orders from removed providers
UPDATE orders
SET payment_status = 'cancelled', updated_at = NOW()
WHERE payment_method IN ('instaxchange', 'nowpayments', 'card')
  AND payment_status = 'pending'
  AND created_at < NOW() - INTERVAL '24 hours';

-- Drop deprecated tables
DROP TABLE IF EXISTS nowpayments_sub_accounts CASCADE;
DROP TABLE IF EXISTS instaxchange_sessions CASCADE;
DROP TABLE IF EXISTS instaxchange_orders CASCADE;
DROP TABLE IF EXISTS nowpayments_webhook_logs CASCADE;
DROP TABLE IF EXISTS instaxchange_webhook_logs CASCADE;

-- Create improved indexes
CREATE INDEX IF NOT EXISTS idx_user_transactions_base_payments ON user_transactions(payment_provider, status) WHERE payment_provider IN ('base-cdp', 'coinbase', 'balance');
CREATE INDEX IF NOT EXISTS idx_pending_tickets_user_competition ON pending_tickets(user_id, competition_id, status);
CREATE INDEX IF NOT EXISTS idx_tickets_competition_availability ON tickets(competition_id, privy_user_id);
CREATE INDEX IF NOT EXISTS idx_joincompetition_privy_user_id ON joincompetition(privy_user_id);
CREATE INDEX IF NOT EXISTS idx_joincompetition_competition_user ON joincompetition(competitionid, privy_user_id);
