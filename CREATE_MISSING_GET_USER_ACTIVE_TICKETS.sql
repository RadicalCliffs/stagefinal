-- ============================================================================
-- CREATE MISSING: get_user_active_tickets
-- ============================================================================
-- This RPC is called by AuthContext but was never created in the database.
-- It returns active competition entries for a user, grouped by competition.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_user_active_tickets(p_user_identifier TEXT)
RETURNS TABLE(
  competitionid UUID,
  ticketnumbers INTEGER[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_canonical_id TEXT;
  v_wallet_normalized TEXT;
BEGIN
  -- Convert input to canonical format
  v_canonical_id := p_user_identifier;
  
  -- Also support wallet address matching (case-insensitive)
  v_wallet_normalized := LOWER(p_user_identifier);
  
  -- Return grouped tickets for active competitions only
  -- Active means: status = 'active' and end_date hasn't passed
  RETURN QUERY
  SELECT 
    t.competition_id::UUID as competitionid,
    array_agg(t.ticket_number ORDER BY t.ticket_number)::INTEGER[] as ticketnumbers
  FROM tickets t
  INNER JOIN competitions c ON c.id = t.competition_id
  WHERE 
    -- Match user by various identifiers
    (
      t.user_id = v_canonical_id 
      OR t.canonical_user_id = v_canonical_id
      OR t.privy_user_id = v_canonical_id
      OR LOWER(t.wallet_address) = v_wallet_normalized
    )
    -- Only include active competitions
    AND c.status = 'active'
    AND c.deleted = false
    AND (c.end_date IS NULL OR c.end_date > NOW())
  GROUP BY t.competition_id
  ORDER BY MAX(t.created_at) DESC;
  
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.get_user_active_tickets(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_active_tickets(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_user_active_tickets(TEXT) TO anon;

-- Add helpful comment
COMMENT ON FUNCTION public.get_user_active_tickets(TEXT) IS 
'Returns active competition entries for a user, grouped by competition.
Returns ONE ROW per competition entered (regardless of number of tickets).
The row count = number of active entries (competitions user has entered).
Only includes competitions that are still active (not completed/drawn/cancelled).
Used by the dashboard to show the active entries count in the user dropdown.';

-- Verification
DO $$
BEGIN
  RAISE NOTICE '========================================================';
  RAISE NOTICE 'Created: get_user_active_tickets RPC function';
  RAISE NOTICE 'Returns: Active competition tickets grouped by competition';
  RAISE NOTICE 'Used by: AuthContext to show active entries count';
  RAISE NOTICE '========================================================';
END $$;
