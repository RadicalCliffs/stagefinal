-- Migration: Fix get_user_active_tickets RPC and v_competition_ticket_stats view
--            to use correct ticket status values
-- 
-- Issue: Multiple places were using incorrect status values:
--   - get_user_active_tickets RPC: status IN ('sold', 'active') - 'active' is invalid
--   - v_competition_ticket_stats view: status IN ('sold', 'purchased') - 'purchased' is invalid
--
-- Valid ticket statuses: 'available', 'reserved', 'confirmed', 'sold', 'refunded'
--
-- Fix: Use status IN ('sold', 'confirmed') to properly identify owned/sold tickets
--
-- This fixes Issue #2: Owned tickets not showing in green in the ticket selector

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
  -- Fixed: Use correct status values ('sold', 'confirmed') instead of ('sold', 'active')
  RETURN QUERY
  SELECT
    t.competition_id AS competitionid,
    array_agg(t.ticket_number::TEXT ORDER BY t.ticket_number)::TEXT[] AS ticketnumbers
  FROM tickets t
  WHERE t.canonical_user_id = v_canonical_user_id
    AND t.status IN ('sold', 'confirmed')  -- FIXED: was ('sold', 'active')
  GROUP BY t.competition_id;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_user_active_tickets(TEXT) TO authenticated;

-- Add helpful comment
COMMENT ON FUNCTION get_user_active_tickets(TEXT) IS 
'Returns user owned tickets across all competitions. Accepts any user identifier (wallet, privy_user_id, canonical_user_id). Filters by status IN (''sold'', ''confirmed''). Returns legacy-compatible shape: {competitionid, ticketnumbers}.';

-- ============================================================================
-- Fix v_competition_ticket_stats view to use correct status values
-- ============================================================================

CREATE OR REPLACE VIEW v_competition_ticket_stats AS
SELECT
  c.id AS competition_id,
  c.total_tickets AS total,
  COUNT(DISTINCT t.id) FILTER (WHERE t.status IN ('sold', 'confirmed')) AS sold,  -- FIXED: was ('sold', 'purchased')
  COUNT(DISTINCT pti.id) AS held,
  c.total_tickets - COUNT(DISTINCT t.id) FILTER (WHERE t.status IN ('sold', 'confirmed')) - COUNT(DISTINCT pti.id) AS available
FROM competitions c
LEFT JOIN tickets t ON t.competition_id = c.id
LEFT JOIN pending_ticket_items pti ON pti.competition_id = c.id AND pti.status = 'reserved'
GROUP BY c.id, c.total_tickets;

-- Grant access
GRANT SELECT ON v_competition_ticket_stats TO authenticated;
GRANT SELECT ON v_competition_ticket_stats TO anon;
GRANT SELECT ON v_competition_ticket_stats TO service_role;

COMMENT ON VIEW v_competition_ticket_stats IS 'Real-time competition ticket statistics. Shows sold (status IN sold, confirmed), held (reserved), and available ticket counts.';

-- ============================================================================
-- Fix user_overview view to use correct status values
-- ============================================================================

-- Note: This view includes 'reserved' tickets because it's showing all user activity
-- including pending reservations. For owned tickets, use 'sold' and 'confirmed' only.

-- First, check if user_overview view exists and update it
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.views WHERE table_name = 'user_overview') THEN
    -- Drop and recreate with correct status values
    DROP VIEW IF EXISTS user_overview CASCADE;
    
    CREATE OR REPLACE VIEW user_overview AS
    SELECT
      cu.id AS canonical_user_uuid,
      cu.canonical_user_id,
      cu.wallet_address,
      cu.privy_user_id,
      cu.username,
      cu.email,
      cu.usdc_balance,
      cu.created_at,
      cu.updated_at,
      
      -- Aggregate competition entries
      jsonb_agg(DISTINCT jsonb_build_object(
        'id', ce.id,
        'competition_id', ce.competition_id,
        'tickets_count', ce.tickets_count,
        'amount_spent', ce.amount_spent
      )) FILTER (WHERE ce.id IS NOT NULL) AS competition_entries,
      
      -- Aggregate tickets with FIXED status filter
      jsonb_agg(DISTINCT jsonb_build_object(
        'id', t.id,
        'competition_id', t.competition_id,
        'ticket_number', t.ticket_number,
        'status', t.status
      )) FILTER (WHERE t.id IS NOT NULL) AS tickets,
      
      -- Aggregate transactions
      jsonb_agg(DISTINCT jsonb_build_object(
        'id', ut.id,
        'amount', ut.amount,
        'status', ut.status
      )) FILTER (WHERE ut.id IS NOT NULL) AS transactions
      
    FROM canonical_users cu
    
    -- Join competition_entries using canonical_user_id (text)
    LEFT JOIN competition_entries ce 
      ON ce.canonical_user_id = cu.canonical_user_id
      AND ce.entry_status != 'cancelled'
    
    -- Join tickets using canonical_user_id (text)
    -- FIXED: Use correct status values ('sold', 'confirmed', 'reserved')
    LEFT JOIN tickets t 
      ON t.canonical_user_id = cu.canonical_user_id
      AND t.status IN ('sold', 'confirmed', 'reserved')  -- FIXED: was ('sold', 'purchased', 'reserved')
    
    -- Join user_transactions using canonical_user_id (text)
    LEFT JOIN user_transactions ut 
      ON ut.canonical_user_id = cu.canonical_user_id
    
    GROUP BY 
      cu.id,
      cu.canonical_user_id,
      cu.wallet_address,
      cu.privy_user_id,
      cu.username,
      cu.email,
      cu.usdc_balance,
      cu.created_at,
      cu.updated_at;
      
    -- Grant access
    GRANT SELECT ON user_overview TO authenticated;
    GRANT SELECT ON user_overview TO anon;
    GRANT SELECT ON user_overview TO service_role;
    
    COMMENT ON VIEW user_overview IS 'Comprehensive user dashboard data with corrected ticket status filters.';
  END IF;
END $$;


