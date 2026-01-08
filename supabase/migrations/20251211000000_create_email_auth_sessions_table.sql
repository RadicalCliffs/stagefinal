-- Create email_auth_sessions table for email verification before Privy login
CREATE TABLE IF NOT EXISTS email_auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  verification_code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  used_at timestamptz
);

-- Index for quick email lookups
CREATE INDEX IF NOT EXISTS email_auth_sessions_email_idx
  ON email_auth_sessions (email);

-- Index for cleanup of expired sessions
CREATE INDEX IF NOT EXISTS email_auth_sessions_expires_at_idx
  ON email_auth_sessions (expires_at);

-- Enable RLS
ALTER TABLE email_auth_sessions ENABLE ROW LEVEL SECURITY;

-- Service role full access policy (this table is only accessed via Edge Functions with service role)
DROP POLICY IF EXISTS "Service role full access to email_auth_sessions" ON email_auth_sessions;
CREATE POLICY "Service role full access to email_auth_sessions"
  ON email_auth_sessions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
