-- ============================================================================
-- FIX: user_transactions INSERT RLS Policies
-- ============================================================================
-- This migration restores the INSERT policies for user_transactions table
-- that were accidentally removed by the godlike migration.
--
-- ISSUE: TopUpWalletModal and other client-side code tries to INSERT into
-- user_transactions directly, but the recent godlike migration only added
-- SELECT policies, not INSERT policies.
--
-- ERROR: "new row violates row-level security policy for table "user_transactions""
-- ============================================================================

BEGIN;

-- Drop existing INSERT policies if they exist (to ensure clean state)
DROP POLICY IF EXISTS "Anon users can insert transactions" ON user_transactions;
DROP POLICY IF EXISTS "Authenticated users can insert transactions" ON user_transactions;

-- Restore INSERT policy for anon users (for payment initiation before auth)
CREATE POLICY "Anon users can insert transactions"
  ON user_transactions
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Restore INSERT policy for authenticated users
CREATE POLICY "Authenticated users can insert transactions"
  ON user_transactions
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Also ensure UPDATE policy exists for authenticated users to update their own transactions
DROP POLICY IF EXISTS "Authenticated users can update own transactions" ON user_transactions;
CREATE POLICY "Authenticated users can update own transactions"
  ON user_transactions
  FOR UPDATE
  TO authenticated
  USING (
    user_id = (SELECT auth.uid()::text) OR
    user_privy_id = (SELECT auth.uid()::text) OR
    wallet_address = (SELECT auth.uid()::text) OR
    -- Also allow updates for canonical user IDs that contain the user's wallet
    user_id LIKE 'prize:pid:' || (SELECT auth.uid()::text) || '%'
  )
  WITH CHECK (
    user_id = (SELECT auth.uid()::text) OR
    user_privy_id = (SELECT auth.uid()::text) OR
    wallet_address = (SELECT auth.uid()::text) OR
    user_id LIKE 'prize:pid:' || (SELECT auth.uid()::text) || '%'
  );

-- Verify the policies exist
DO $$
DECLARE
  policy_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'user_transactions'
    AND policyname IN ('Anon users can insert transactions', 'Authenticated users can insert transactions');

  IF policy_count < 2 THEN
    RAISE WARNING 'Expected 2 INSERT policies but found %', policy_count;
  ELSE
    RAISE NOTICE 'Successfully created % INSERT policies for user_transactions', policy_count;
  END IF;
END $$;

COMMIT;
