/*
  # Create User Transactions Table for Payment Tracking

  ## Overview
  This migration creates the user_transactions table to track all payment records
  from NOWPayments and other payment providers. This table bridges payment confirmations
  to ticket creation in the joincompetition table.

  ## Tables Created

  ### user_transactions
  - `id` (uuid, primary key) - Unique transaction identifier
  - `user_id` (text) - User identifier (can be uid, wallet address, or privy_id)
  - `wallet_address` (text) - User's wallet address
  - `competition_id` (text) - Competition UID for this purchase
  - `ticket_count` (integer) - Number of tickets purchased
  - `amount` (numeric) - Amount paid in USD
  - `session_id` (text) - Payment session ID from provider
  - `webhook_ref` (text) - Webhook reference for matching updates
  - `status` (text) - Transaction status: pending, waiting, confirming, finished, failed
  - `payment_status` (text) - Payment provider's status
  - `user_privy_id` (text) - Privy user ID for authentication
  - `order_id` (text) - Internal order ID for tracking
  - `network` (text) - Blockchain network used
  - `tx_id` (text) - Transaction hash or invoice ID
  - `currency` (text) - Currency paid (e.g., usd)
  - `payment_provider` (text) - Provider name (nowpayments, instaxchange)
  - `pay_currency` (text) - Cryptocurrency used (e.g., usdc)
  - `created_at` (timestamptz) - Transaction creation time
  - `updated_at` (timestamptz) - Last update time
  - `completed_at` (timestamptz) - Completion time when finished

  ## Security
  - Enable RLS on user_transactions table
  - Users can read their own transactions
  - Service role can manage all transactions (for webhooks)
  - Anon users can insert transactions (for initial payment creation)

  ## Indexes
  - Index on user_id for fast user lookup
  - Index on wallet_address for wallet-based queries
  - Index on session_id for webhook matching
  - Index on webhook_ref for webhook processing
  - Index on order_id for order tracking
  - Index on competition_id for competition queries
*/

-- Create user_transactions table
CREATE TABLE IF NOT EXISTS user_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text,
  wallet_address text,
  competition_id text,
  ticket_count integer NOT NULL DEFAULT 1,
  amount numeric(10, 2) NOT NULL,
  session_id text,
  webhook_ref text,
  status text NOT NULL DEFAULT 'pending',
  payment_status text,
  user_privy_id text,
  order_id text,
  network text,
  tx_id text,
  currency text DEFAULT 'usd',
  payment_provider text DEFAULT 'nowpayments',
  pay_currency text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

-- Enable RLS
ALTER TABLE user_transactions ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DO $$
BEGIN
  DROP POLICY IF EXISTS "Users can read own transactions" ON user_transactions;
  DROP POLICY IF EXISTS "Service role can manage all transactions" ON user_transactions;
  DROP POLICY IF EXISTS "Anon users can insert transactions" ON user_transactions;
  DROP POLICY IF EXISTS "Authenticated users can insert transactions" ON user_transactions;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Users can read their own transactions
DROP POLICY IF EXISTS "Users can read own transactions" ON user_transactions;
CREATE POLICY "Users can read own transactions"
  ON user_transactions
  FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid()::text) OR
    user_privy_id = (SELECT auth.uid()::text) OR
    wallet_address = (SELECT auth.uid()::text)
  );

-- Service role can manage everything (for webhooks)
DROP POLICY IF EXISTS "Service role can manage all transactions" ON user_transactions;
CREATE POLICY "Service role can manage all transactions"
  ON user_transactions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Allow anon users to insert (for payment initiation)
DROP POLICY IF EXISTS "Anon users can insert transactions" ON user_transactions;
CREATE POLICY "Anon users can insert transactions"
  ON user_transactions
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Allow authenticated users to insert
DROP POLICY IF EXISTS "Authenticated users can insert transactions" ON user_transactions;
CREATE POLICY "Authenticated users can insert transactions"
  ON user_transactions
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_transactions_user_id ON user_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_transactions_wallet_address ON user_transactions(wallet_address);
CREATE INDEX IF NOT EXISTS idx_user_transactions_session_id ON user_transactions(session_id);
CREATE INDEX IF NOT EXISTS idx_user_transactions_webhook_ref ON user_transactions(webhook_ref);
CREATE INDEX IF NOT EXISTS idx_user_transactions_order_id ON user_transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_user_transactions_competition_id ON user_transactions(competition_id);
CREATE INDEX IF NOT EXISTS idx_user_transactions_tx_id ON user_transactions(tx_id);
CREATE INDEX IF NOT EXISTS idx_user_transactions_status ON user_transactions(status);
CREATE INDEX IF NOT EXISTS idx_user_transactions_created_at ON user_transactions(created_at DESC);
