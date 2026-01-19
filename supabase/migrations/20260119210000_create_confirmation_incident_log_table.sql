-- Create table for persistent logging of ticket confirmation errors and incidents
-- This provides observability for debugging confirmation breakages

CREATE TABLE IF NOT EXISTS public.confirmation_incident_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id TEXT NOT NULL,
  request_id TEXT,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Function/proxy context
  source TEXT NOT NULL CHECK (source IN ('netlify_proxy', 'supabase_function', 'webhook')),
  endpoint TEXT NOT NULL, -- e.g., '/api/confirm-pending-tickets', 'confirm-pending-tickets'
  
  -- Error information
  error_type TEXT NOT NULL, -- e.g., 'env_var_missing', 'supabase_error', 'network_error', 'validation_error'
  error_message TEXT NOT NULL,
  error_stack TEXT,
  
  -- Request context
  user_id TEXT,
  competition_id TEXT,
  reservation_id TEXT,
  session_id TEXT,
  transaction_hash TEXT,
  
  -- Environment context (for debugging infra issues)
  env_context JSONB, -- Store non-sensitive env var states, versions, etc.
  request_body JSONB, -- Store sanitized request body (excluding sensitive data)
  
  -- Additional metadata
  metadata JSONB DEFAULT '{}',
  
  -- Indexing for fast lookups
  CONSTRAINT confirmation_incident_log_incident_id_idx UNIQUE (incident_id)
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_confirmation_incident_log_timestamp ON public.confirmation_incident_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_confirmation_incident_log_source ON public.confirmation_incident_log(source);
CREATE INDEX IF NOT EXISTS idx_confirmation_incident_log_error_type ON public.confirmation_incident_log(error_type);
CREATE INDEX IF NOT EXISTS idx_confirmation_incident_log_user_id ON public.confirmation_incident_log(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_confirmation_incident_log_competition_id ON public.confirmation_incident_log(competition_id) WHERE competition_id IS NOT NULL;

-- Grant appropriate permissions
ALTER TABLE public.confirmation_incident_log ENABLE ROW LEVEL SECURITY;

-- Service role can read/write (for functions)
CREATE POLICY "Service role full access" ON public.confirmation_incident_log
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Authenticated users can read their own incidents
CREATE POLICY "Users can read own incidents" ON public.confirmation_incident_log
  FOR SELECT
  USING (auth.uid()::text = user_id OR user_id LIKE '%' || auth.uid()::text || '%');

-- Add comment for documentation
COMMENT ON TABLE public.confirmation_incident_log IS 
  'Persistent log of ticket confirmation errors and incidents for debugging infrastructure and environment issues. Added Jan 2026 for observability enhancement.';

COMMENT ON COLUMN public.confirmation_incident_log.incident_id IS 
  'Unique identifier for this incident, used for correlation across logs';

COMMENT ON COLUMN public.confirmation_incident_log.source IS 
  'Where the incident occurred: netlify_proxy, supabase_function, or webhook';

COMMENT ON COLUMN public.confirmation_incident_log.error_type IS 
  'Category of error for filtering: env_var_missing, supabase_error, network_error, validation_error, etc.';

COMMENT ON COLUMN public.confirmation_incident_log.env_context IS 
  'Non-sensitive environment context like detected environment info, versions, config states';
