-- Migration: Create get_user_active_tickets RPC for ticket highlighting
-- This RPC provides a single, robust function to fetch user's active tickets
-- across all competitions, handling any user identifier (wallet, privy, or canonical)
-- and returning backward-compatible shape for UI highlighting.

CREATE OR REPLACE FUNCTION get_user_active_tickets(p_user_identifier TEXT)
RETURNS TABLE(
  competitionid UUID,
  ticketnumbers TEXT[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_canonical_user_id TEXT;
BEGIN
  -- Resolve user identifier to canonical_user_id
  -- Supports wallet address, privy_user_id, or canonical_user_id
  SELECT cu.canonical_user_id INTO v_canonical_user_id
  FROM canonical_users cu
  WHERE cu.canonical_user_id = p_user_identifier
     OR cu.uid = p_user_identifier
     OR cu.wallet_address = p_user_identifier
     OR cu.privy_user_id = p_user_identifier
  LIMIT 1;

  -- If user not found, return empty result
  IF v_canonical_user_id IS NULL THEN
    RETURN;
  END IF;

  -- Return active tickets grouped by competition
  -- Uses tickets table as authoritative source
  -- Returns backward-compatible shape with legacy column names
  RETURN QUERY
  SELECT
    t.competition_id AS competitionid,
    array_agg(t.ticket_number::TEXT ORDER BY t.ticket_number)::TEXT[] AS ticketnumbers
  FROM tickets t
  WHERE t.canonical_user_id = v_canonical_user_id
    AND t.status IN ('sold', 'active')
  GROUP BY t.competition_id;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_user_active_tickets(TEXT) TO authenticated;

-- Add helpful comment
COMMENT ON FUNCTION get_user_active_tickets(TEXT) IS 
'Returns user active tickets across all competitions. Accepts any user identifier (wallet, privy_user_id, canonical_user_id). Returns legacy-compatible shape: {competitionid, ticketnumbers}.';
