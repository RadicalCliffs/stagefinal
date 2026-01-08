-- Migration: Create balance_ledger table (documentation/reference)
-- Purpose: Store audit trail for all balance credits/debits (top-ups, refunds, bonus credits)
-- Required by: process-balance-payments, onramp-webhook, secure-write edge functions
-- Priority: CRITICAL - Functions fail without this table
--
-- NOTE: This table may already exist in production with the schema below.
-- This migration uses IF NOT EXISTS to be idempotent.
--
-- IMPORTANT SCHEMA NOTES:
-- - user_id is UUID type, referencing privy_user_connections.id (NOT text/privy_user_id)
-- - transaction_id is UUID type, referencing user_transactions.id
-- - created_at and expires_at are TIMESTAMP (not TIMESTAMPTZ)
-- - balance_type allows: 'real', 'bonus', 'pending'

-- Create the balance_ledger table
CREATE TABLE IF NOT EXISTS public.balance_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  balance_type TEXT NOT NULL CHECK (balance_type IN ('real', 'bonus', 'pending')),
  source TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  transaction_id UUID,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP
);

-- Add comment for documentation
COMMENT ON TABLE public.balance_ledger IS 'Audit trail for user balance changes (top-ups, purchases, refunds, bonuses)';
COMMENT ON COLUMN public.balance_ledger.user_id IS 'UUID referencing privy_user_connections.id';
COMMENT ON COLUMN public.balance_ledger.balance_type IS 'Type of balance: real (USD), bonus (promotional), or pending';
COMMENT ON COLUMN public.balance_ledger.source IS 'Source of the balance change (topup, topup_onramp, purchase, refund, bonus, etc.)';
COMMENT ON COLUMN public.balance_ledger.amount IS 'Amount credited/debited (positive for credits, negative for debits)';
COMMENT ON COLUMN public.balance_ledger.transaction_id IS 'UUID reference to associated transaction (user_transactions.id or external)';
COMMENT ON COLUMN public.balance_ledger.metadata IS 'Additional data about the transaction';
COMMENT ON COLUMN public.balance_ledger.expires_at IS 'Expiration date for bonus balances (null for real balance)';

-- Create indexes for efficient queries (IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS idx_balance_ledger_user_id ON public.balance_ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_balance_ledger_created_at ON public.balance_ledger(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_balance_ledger_transaction_id ON public.balance_ledger(transaction_id) WHERE transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_balance_ledger_balance_type ON public.balance_ledger(balance_type);

-- Enable RLS (Row Level Security) if not already enabled
ALTER TABLE public.balance_ledger ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Note: These policies may already exist. Using DROP IF EXISTS to handle gracefully.

-- Policy: Allow reads for the row owner (authenticated users)
DROP POLICY IF EXISTS "balance_ledger_select_own" ON public.balance_ledger;
CREATE POLICY "balance_ledger_select_own"
  ON public.balance_ledger
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- Policy: Allow inserts for the row owner (authenticated users)
DROP POLICY IF EXISTS "balance_ledger_insert_own" ON public.balance_ledger;
CREATE POLICY "balance_ledger_insert_own"
  ON public.balance_ledger
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- Grant permissions
GRANT ALL ON public.balance_ledger TO service_role;
GRANT SELECT, INSERT ON public.balance_ledger TO authenticated;
