/*
  # Add Missing Orders Table Columns
  
  Adds columns required for InstaXchange payment integration:
  - payment_method: Track the cryptocurrency used (USDC, USDT, SOL)
  - order_type: Distinguish between competition purchases and wallet top-ups
  - payment_session_id: Store InstaXchange session ID for tracking
  - payment_url: Store the checkout URL for user redirects
*/

-- Add payment_method column to track cryptocurrency used
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS payment_method text;

-- Add order_type column to distinguish order types
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS order_type text DEFAULT 'competition_purchase';

-- Add payment_session_id to store InstaXchange session ID
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS payment_session_id text;

-- Add payment_url to store checkout URL
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS payment_url text;

-- Create index for faster lookups by payment session
CREATE INDEX IF NOT EXISTS idx_orders_payment_session_id 
ON orders(payment_session_id);

-- Create index for order type filtering
CREATE INDEX IF NOT EXISTS idx_orders_order_type 
ON orders(order_type);
