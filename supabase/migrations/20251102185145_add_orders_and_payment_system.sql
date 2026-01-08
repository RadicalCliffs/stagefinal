/*
  # Add Orders and Payment System

  1. New Tables
    - `orders`
      - `id` (uuid, primary key)
      - `user_id` (text, wallet address)
      - `competition_id` (text, references competitions uid)
      - `ticket_count` (integer)
      - `amount_usd` (decimal)
      - `payment_status` (text: 'pending', 'completed', 'failed')
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
    
    - `order_tickets`
      - `id` (uuid, primary key)
      - `order_id` (uuid, foreign key)
      - `ticket_number` (integer)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on both tables
    - Users can read their own orders
    - Users can create orders
    - Public can view orders for activity feed
*/

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  competition_id text REFERENCES competitions(uid) ON DELETE CASCADE,
  ticket_count integer NOT NULL DEFAULT 1,
  amount_usd decimal(10, 2) NOT NULL DEFAULT 0,
  payment_status text NOT NULL DEFAULT 'pending',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
  ticket_number integer NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own orders" ON orders;
CREATE POLICY "Users can view own orders"
  ON orders
  FOR SELECT
  TO authenticated
  USING (user_id::text = auth.uid()::text OR user_id::text = (current_setting('request.jwt.claims', true)::json->>'sub'));

DROP POLICY IF EXISTS "Users can create orders" ON orders;
CREATE POLICY "Users can create orders"
  ON orders
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id::text = auth.uid()::text OR user_id::text = (current_setting('request.jwt.claims', true)::json->>'sub'));

DROP POLICY IF EXISTS "Users can view own order tickets" ON order_tickets;
CREATE POLICY "Users can view own order tickets"
  ON order_tickets
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = order_tickets.order_id
      AND (orders.user_id::text = auth.uid()::text OR orders.user_id::text = (current_setting('request.jwt.claims', true)::json->>'sub'))
    )
  );

DROP POLICY IF EXISTS "Public can view all orders" ON orders;
CREATE POLICY "Public can view all orders"
  ON orders
  FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "Public can view all order tickets" ON order_tickets;
CREATE POLICY "Public can view all order tickets"
  ON order_tickets
  FOR SELECT
  TO anon
  USING (true);

CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_competition_id ON orders(competition_id);
CREATE INDEX IF NOT EXISTS idx_order_tickets_order_id ON order_tickets(order_id);