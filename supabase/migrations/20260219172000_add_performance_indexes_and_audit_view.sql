-- Migration: Add Performance Indexes and Competition Inventory Audit View
-- Created: 2026-02-19
-- Purpose: Improve query performance and add monitoring capabilities for competition inventory

-- =============================================================================
-- PERFORMANCE INDEXES
-- =============================================================================

-- Index for filtering tickets by competition and status
-- Supports queries like: WHERE competition_id = ? AND status = ?
-- Used extensively in ticket availability checks and allocation queries
CREATE INDEX IF NOT EXISTS idx_tickets_competition_status 
ON tickets(competition_id, status);

-- Index for filtering tickets by competition and ticket number
-- Supports queries like: WHERE competition_id = ? AND ticket_number = ?
-- Used in ticket lookup and validation operations
CREATE INDEX IF NOT EXISTS idx_tickets_competition_number 
ON tickets(competition_id, ticket_number);

-- =============================================================================
-- AUDIT VIEW
-- =============================================================================

-- Competition Inventory Audit View
-- Purpose: Monitor inventory consistency and detect drift between expected and actual states
-- 
-- Usage:
--   SELECT * FROM competition_inventory_audit WHERE id = '<competition_id>';
--
-- Columns:
--   - id: Competition UUID
--   - total_tickets: Expected total tickets from competitions table
--   - ticket_rows: Actual count of ticket rows
--   - available_rows: Count of tickets with status 'available'
--   - sold_rows: Count of tickets with status 'sold'
--   - pending_qty: Sum of pending tickets not yet expired
--
-- Use Cases:
--   1. Detect inventory drift (ticket_rows != total_tickets)
--   2. Monitor ticket allocation (available + sold + pending vs total)
--   3. Identify stuck pending tickets
--   4. Audit competition state consistency
CREATE OR REPLACE VIEW competition_inventory_audit AS
SELECT
  c.id,
  c.total_tickets,
  (SELECT COUNT(*) FROM tickets t WHERE t.competition_id = c.id) AS ticket_rows,
  (SELECT COUNT(*) FROM tickets t WHERE t.competition_id = c.id AND t.status = 'available') AS available_rows,
  (SELECT COUNT(*) FROM tickets t WHERE t.competition_id = c.id AND t.status = 'sold') AS sold_rows,
  COALESCE(
    (SELECT SUM(pt.ticket_count) 
     FROM pending_tickets pt 
     WHERE pt.competition_id = c.id 
       AND pt.status = 'pending' 
       AND pt.expires_at > now()
    ), 0
  ) AS pending_qty
FROM competitions c;

-- Grant permissions to authenticated users to query the audit view
GRANT SELECT ON competition_inventory_audit TO authenticated;

-- Add comment to document the view
COMMENT ON VIEW competition_inventory_audit IS 
'Audit view for monitoring competition inventory consistency. Shows ticket counts by status and pending reservations for each competition.';
