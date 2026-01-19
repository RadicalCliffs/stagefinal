-- Create helper RPC for logging confirmation incidents
-- This allows both Netlify functions and Supabase Edge Functions to log consistently

CREATE OR REPLACE FUNCTION public.log_confirmation_incident(
  p_incident_id TEXT,
  p_source TEXT,
  p_endpoint TEXT,
  p_error_type TEXT,
  p_error_message TEXT,
  p_error_stack TEXT DEFAULT NULL,
  p_user_id TEXT DEFAULT NULL,
  p_competition_id TEXT DEFAULT NULL,
  p_reservation_id TEXT DEFAULT NULL,
  p_session_id TEXT DEFAULT NULL,
  p_transaction_hash TEXT DEFAULT NULL,
  p_env_context JSONB DEFAULT NULL,
  p_request_body JSONB DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_log_id UUID;
BEGIN
  INSERT INTO public.confirmation_incident_log (
    incident_id,
    source,
    endpoint,
    error_type,
    error_message,
    error_stack,
    user_id,
    competition_id,
    reservation_id,
    session_id,
    transaction_hash,
    env_context,
    request_body,
    metadata
  ) VALUES (
    p_incident_id,
    p_source,
    p_endpoint,
    p_error_type,
    p_error_message,
    p_error_stack,
    p_user_id,
    p_competition_id,
    p_reservation_id,
    p_session_id,
    p_transaction_hash,
    p_env_context,
    p_request_body,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_log_id;
  
  RETURN v_log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to service role
GRANT EXECUTE ON FUNCTION public.log_confirmation_incident TO service_role;
GRANT EXECUTE ON FUNCTION public.log_confirmation_incident TO authenticated;

COMMENT ON FUNCTION public.log_confirmation_incident IS 
  'Logs ticket confirmation incidents to the confirmation_incident_log table. Used by both Netlify and Supabase functions for consistent error tracking.';
