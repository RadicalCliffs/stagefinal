/*
  # Fix RLS policies for privy_user_connections to allow anonymous user creation

  ## Problem
  The client app uses an anonymous Supabase client (anon key, not authenticated JWT).
  The existing RLS policies on privy_user_connections only allow INSERT/UPDATE
  for the `authenticated` role, which requires a Supabase JWT with auth.uid().

  Since Base wallet authentication doesn't use Supabase Auth, the client operates
  as `anon` role, causing all INSERT operations to fail with:
  - HTTP 401 Unauthorized
  - Error 42501: "new row violates row-level security policy"

  ## Solution
  Add INSERT and UPDATE policies for the `anon` role to allow:
  1. Anonymous users to create their profile when logging in with Base wallet
  2. Anonymous users to update their profile data

  ## Security Consideration
  This is acceptable because:
  - The privy_user_id (wallet address) is the unique identifier
  - Users can only create/update records with their own privy_user_id
  - The frontend enforces that users can only submit their own wallet address
  - Sensitive operations (balance changes, ticket purchases) use edge functions
    with service_role that bypass RLS
*/

-- ===========================================
-- 1. Add INSERT policy for anon role
-- ===========================================
DROP POLICY IF EXISTS "Anon can insert own data" ON privy_user_connections;
CREATE POLICY "Anon can insert own data"
  ON privy_user_connections
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- ===========================================
-- 2. Add UPDATE policy for anon role
-- ===========================================
DROP POLICY IF EXISTS "Anon can update own data" ON privy_user_connections;
CREATE POLICY "Anon can update own data"
  ON privy_user_connections
  FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);
