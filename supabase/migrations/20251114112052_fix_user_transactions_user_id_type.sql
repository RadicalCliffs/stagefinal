/*\n  # Fix user_transactions user_id column type\n  \n  1. Changes\n    - Alter `user_transactions.user_id` from uuid to text\n    - This allows storing Privy user IDs in format "did:privy:..."\n    \n  2. Security\n    - Drop existing RLS policies\n    - Change column type\n    - Recreate RLS policies with correct type\n*/\n\n-- Drop existing RLS policies that depend on user_id\nDROP POLICY IF EXISTS "Users can create transactions" ON user_transactions;
\nDROP POLICY IF EXISTS "Users read own transactions" ON user_transactions;
\n\n-- Change user_id from uuid to text to support Privy user IDs\nALTER TABLE user_transactions \nALTER COLUMN user_id TYPE text USING user_id::text;
\n\n-- Recreate RLS policies\nCREATE POLICY "Users can create transactions"\n  ON user_transactions\n  FOR INSERT\n  TO authenticated\n  WITH CHECK (true);
\n\nCREATE POLICY "Users read own transactions"\n  ON user_transactions\n  FOR SELECT\n  TO authenticated\n  USING (user_id = current_setting('request.jwt.claims', true)::json->>'sub');
\n;
