/*
  # Fix Competitions Table RLS Security

  ## Problem
  The `competitions` table has overly permissive RLS policies that allow ANY user
  (including anonymous/public) to INSERT, UPDATE, and DELETE competitions.
  This is a critical security vulnerability as competition management should be
  restricted to admin users only.

  ## Solution
  Replace the permissive public policies with properly scoped policies:

  1. **SELECT**: Keep public read access (competitions should be visible to everyone)
  2. **INSERT**: Only allow via service_role (edge functions with admin auth)
  3. **UPDATE**: Only allow via service_role (edge functions with admin auth)
  4. **DELETE**: Only allow via service_role (edge functions with admin auth)

  ## Security Model
  Admin operations on competitions go through Supabase Edge Functions which:
  - Verify admin authentication via admin_sessions table
  - Use service_role key to bypass RLS
  - This prevents direct client-side manipulation while allowing authenticated admins
*/

-- ============================================
-- STEP 1: Drop existing overly permissive policies
-- ============================================

-- Drop the dangerous public policies
DROP POLICY IF EXISTS "Allow inserts to competitions" ON competitions;
DROP POLICY IF EXISTS "Allow updates to competitions" ON competitions;
DROP POLICY IF EXISTS "Allow deletes from competitions" ON competitions;

-- ============================================
-- STEP 2: Ensure SELECT policy exists for public read
-- ============================================

-- Public can read all competitions (this is expected for a lottery/competition site)
DROP POLICY IF EXISTS "Public can view competitions" ON competitions;
CREATE POLICY "Public can view competitions"
  ON competitions FOR SELECT
  TO public
  USING (true);

-- ============================================
-- STEP 3: Create restricted write policies
-- ============================================

-- Only service_role can insert competitions
-- Admin operations go through Edge Functions that use service_role
DROP POLICY IF EXISTS "Service role can insert competitions" ON competitions;
CREATE POLICY "Service role can insert competitions"
  ON competitions FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Only service_role can update competitions
DROP POLICY IF EXISTS "Service role can update competitions" ON competitions;
CREATE POLICY "Service role can update competitions"
  ON competitions FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Only service_role can delete competitions
DROP POLICY IF EXISTS "Service role can delete competitions" ON competitions;
CREATE POLICY "Service role can delete competitions"
  ON competitions FOR DELETE
  TO service_role
  USING (true);

-- ============================================
-- STEP 4: Add audit logging for competition changes (optional but recommended)
-- ============================================

-- Create an audit table for competition changes if it doesn't exist
CREATE TABLE IF NOT EXISTS competition_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  old_data JSONB,
  new_data JSONB,
  changed_by TEXT,
  changed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for efficient querying
CREATE INDEX IF NOT EXISTS idx_competition_audit_competition_id ON competition_audit_log(competition_id);
CREATE INDEX IF NOT EXISTS idx_competition_audit_changed_at ON competition_audit_log(changed_at);

-- Enable RLS on audit table (only service_role can write)
ALTER TABLE competition_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can insert audit logs" ON competition_audit_log;
CREATE POLICY "Service role can insert audit logs"
  ON competition_audit_log FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Admins can read audit logs
DROP POLICY IF EXISTS "Service role can read audit logs" ON competition_audit_log;
CREATE POLICY "Service role can read audit logs"
  ON competition_audit_log FOR SELECT
  TO service_role
  USING (true);

-- ============================================
-- STEP 5: Create trigger function for audit logging
-- ============================================

CREATE OR REPLACE FUNCTION log_competition_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO competition_audit_log (competition_id, action, new_data, changed_by)
    VALUES (NEW.id, 'INSERT', to_jsonb(NEW), current_user);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO competition_audit_log (competition_id, action, old_data, new_data, changed_by)
    VALUES (NEW.id, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW), current_user);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO competition_audit_log (competition_id, action, old_data, changed_by)
    VALUES (OLD.id, 'DELETE', to_jsonb(OLD), current_user);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

-- Create the trigger (drop first if exists to avoid duplicates)
DROP TRIGGER IF EXISTS competition_audit_trigger ON competitions;
CREATE TRIGGER competition_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON competitions
  FOR EACH ROW
  EXECUTE FUNCTION log_competition_changes();
