/*
  # Add INSERT and UPDATE policies for users table

  ## Problem
  The users table has RLS enabled but only has SELECT policy.
  When client-side code or triggers try to insert/update users,
  it fails with RLS policy violation.

  ## Solution
  Add INSERT and UPDATE policies for both anon and authenticated roles.
*/

-- ===========================================
-- 1. Add INSERT policy for users table (anon)
-- ===========================================
DROP POLICY IF EXISTS "Anon can insert users" ON users;
CREATE POLICY "Anon can insert users"
  ON users
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- ===========================================
-- 2. Add INSERT policy for users table (authenticated)
-- ===========================================
DROP POLICY IF EXISTS "Authenticated can insert users" ON users;
CREATE POLICY "Authenticated can insert users"
  ON users
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- ===========================================
-- 3. Add UPDATE policy for users table (anon)
-- ===========================================
DROP POLICY IF EXISTS "Anon can update users" ON users;
CREATE POLICY "Anon can update users"
  ON users
  FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

-- ===========================================
-- 4. Add UPDATE policy for users table (authenticated)
-- ===========================================
DROP POLICY IF EXISTS "Authenticated can update users" ON users;
CREATE POLICY "Authenticated can update users"
  ON users
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);
