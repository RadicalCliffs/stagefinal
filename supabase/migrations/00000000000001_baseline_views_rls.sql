-- ============================================================================
-- FRONTEND-FIRST BASELINE MIGRATION - PART 2: VIEWS & RLS
-- ============================================================================
-- This migration creates database views and Row Level Security policies
-- 
-- Created: 2026-02-08
-- Purpose: Views and security policies required by frontend
-- 
-- Includes:
-- - Critical views (v_joincompetition_active, v_competition_ticket_stats, user_overview)
-- - RLS policies for all tables
-- - Grants for anon, authenticated, service_role
-- ============================================================================

BEGIN;

-- ============================================================================
-- SECTION 1: CRITICAL VIEWS
-- ============================================================================

-- v_joincompetition_active: Active competition entries
-- This is the MOST CRITICAL view - heavily used by frontend (50+ references)
CREATE OR REPLACE VIEW v_joincompetition_active AS
SELECT
  jc.id,
  jc.userid,
  jc.competitionid,
  jc.wallet_address,
  jc.ticketnumbers,
  jc.purchasedate,
  jc.joinedat,
  jc.created_at,
  COALESCE(jc.is_active, true) AS is_active,
  
  -- Competition details (joined from competitions table)
  c.title AS competition_title,
  c.status AS competition_status,
  c.end_date AS competition_end_date,
  c.image_url AS competition_image_url,
  c.prize_value AS competition_prize_value,
  c.is_instant_win AS competition_is_instant_win
  
FROM joincompetition jc
LEFT JOIN competitions c ON c.id = jc.competitionid OR c.uid = jc.competitionid
WHERE COALESCE(jc.is_active, true) = true;

-- Grant access
GRANT SELECT ON v_joincompetition_active TO authenticated;
GRANT SELECT ON v_joincompetition_active TO anon;
GRANT SELECT ON v_joincompetition_active TO service_role;

COMMENT ON VIEW v_joincompetition_active IS 'Active competition entries - filters out inactive entries. Used extensively by frontend for user dashboard and competition tracking.';

-- v_competition_ticket_stats: Real-time ticket availability statistics
CREATE OR REPLACE VIEW v_competition_ticket_stats AS
SELECT
  c.id AS competition_id,
  c.total_tickets AS total,
  COUNT(DISTINCT t.id) FILTER (WHERE t.status IN ('sold', 'purchased')) AS sold,
  COUNT(DISTINCT pti.id) AS held,
  c.total_tickets - COUNT(DISTINCT t.id) FILTER (WHERE t.status IN ('sold', 'purchased')) - COUNT(DISTINCT pti.id) AS available
FROM competitions c
LEFT JOIN tickets t ON t.competition_id = c.id
LEFT JOIN pending_ticket_items pti ON pti.competition_id = c.id AND pti.status = 'reserved'
GROUP BY c.id, c.total_tickets;

-- Grant access
GRANT SELECT ON v_competition_ticket_stats TO authenticated;
GRANT SELECT ON v_competition_ticket_stats TO anon;
GRANT SELECT ON v_competition_ticket_stats TO service_role;

COMMENT ON VIEW v_competition_ticket_stats IS 'Real-time competition ticket statistics. Shows sold, held (reserved), and available ticket counts.';

-- user_overview: Comprehensive user dashboard data
-- Returns one row per canonical user with all related data as JSON aggregates
CREATE OR REPLACE VIEW user_overview AS
SELECT
  cu.id AS canonical_user_uuid,
  cu.canonical_user_id,
  
  -- Aggregate entries data as JSON array
  COALESCE(
    json_agg(DISTINCT jsonb_build_object(
      'entry_id', ce.id,
      'competition_id', ce.competition_id,
      'competition_title', ce.competition_title,
      'amount_paid', ce.amount_paid,
      'tickets_count', ce.ticket_count,
      'ticket_numbers_csv', array_to_string(ce.ticket_numbers, ','),
      'created_at', ce.created_at,
      'is_winner', ce.is_winner
    )) FILTER (WHERE ce.id IS NOT NULL),
    '[]'::json
  ) AS entries_json,
  
  -- Aggregate tickets data as JSON array
  COALESCE(
    json_agg(DISTINCT jsonb_build_object(
      'ticket_id', t.id,
      'competition_id', t.competition_id,
      'ticket_number', t.ticket_number,
      'is_winner', t.is_winner,
      'created_at', COALESCE(t.purchased_at, t.created_at)
    )) FILTER (WHERE t.id IS NOT NULL),
    '[]'::json
  ) AS tickets_json,
  
  -- Aggregate transactions data as JSON array
  COALESCE(
    json_agg(DISTINCT jsonb_build_object(
      'transaction_id', ut.id,
      'type', ut.transaction_type,
      'amount', ut.amount,
      'currency', ut.currency,
      'status', ut.status,
      'created_at', ut.created_at
    )) FILTER (WHERE ut.id IS NOT NULL),
    '[]'::json
  ) AS transactions_json,
  
  -- Aggregate balances as JSON object (currency -> {available, pending})
  COALESCE(
    jsonb_object_agg(
      wb.currency,
      jsonb_build_object(
        'available', COALESCE(wb.available_balance, 0),
        'pending', COALESCE(wb.pending_balance, 0)
      )
    ) FILTER (WHERE wb.currency IS NOT NULL),
    '{}'::jsonb
  ) AS balances_json,
  
  -- Aggregate ledger data as JSON array
  COALESCE(
    json_agg(DISTINCT jsonb_build_object(
      'ledger_id', wl.id,
      'reference_id', wl.reference_id,
      'transaction_type', wl.transaction_type,
      'amount', wl.amount,
      'currency', wl.currency,
      'balance_before', wl.balance_before,
      'balance_after', wl.balance_after,
      'description', wl.description,
      'created_at', wl.created_at
    )) FILTER (WHERE wl.id IS NOT NULL),
    '[]'::json
  ) AS ledger_json,
  
  -- Counts
  COUNT(DISTINCT ce.id) AS entries_count,
  COUNT(DISTINCT t.id) AS tickets_count,
  COUNT(DISTINCT ut.id) AS transactions_count,
  COUNT(DISTINCT wl.id) AS ledger_count,
  
  -- Totals from ledger
  COALESCE(SUM(wl.amount) FILTER (WHERE wl.amount > 0), 0) AS total_credits,
  COALESCE(ABS(SUM(wl.amount)) FILTER (WHERE wl.amount < 0), 0) AS total_debits

FROM canonical_users cu

-- Join competition_entries using canonical_user_id (text)
LEFT JOIN competition_entries ce 
  ON ce.canonical_user_id = cu.canonical_user_id
  AND ce.entry_status != 'cancelled'

-- Join tickets using canonical_user_id (text)
LEFT JOIN tickets t 
  ON t.canonical_user_id = cu.canonical_user_id
  AND t.status IN ('sold', 'purchased', 'reserved')

-- Join user_transactions using canonical_user_id (text)
LEFT JOIN user_transactions ut 
  ON ut.canonical_user_id = cu.canonical_user_id

-- Join wallet_balances using canonical_user_id (text)
LEFT JOIN wallet_balances wb 
  ON wb.canonical_user_id = cu.canonical_user_id

-- Join wallet_ledger using canonical_user_id (text)
LEFT JOIN wallet_ledger wl 
  ON wl.canonical_user_id = cu.canonical_user_id

GROUP BY cu.id, cu.canonical_user_id;

-- Grant access
GRANT SELECT ON user_overview TO authenticated;
GRANT SELECT ON user_overview TO anon;
GRANT SELECT ON user_overview TO service_role;

COMMENT ON VIEW user_overview IS 'Aggregated user data view - returns one row per canonical user with all related data as JSON. Use canonical_user_id (text) to filter for a specific user.';

-- ============================================================================
-- SECTION 2: ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE canonical_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE sub_account_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE balance_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE bonus_award_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_topups ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE competition_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets_sold ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_ticket_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE joincompetition ENABLE ROW LEVEL SECURITY;
ALTER TABLE winners ENABLE ROW LEVEL SECURITY;
ALTER TABLE competition_winners ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Prize_Instantprizes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE custody_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE faqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE hero_competitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE testimonials ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE confirmation_incident_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE _entries_progress ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- Public read access for competitions and CMS content
-- ============================================================================

CREATE POLICY "Public read access" ON competitions FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public read access" ON competition_entries FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public read access" ON tickets FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public read access" ON winners FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public read access" ON "Prize_Instantprizes" FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public read access" ON orders FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public read access" ON order_tickets FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public read access" ON user_transactions FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public read access" ON joincompetition FOR SELECT TO anon, authenticated USING (true);

-- CMS content public read
CREATE POLICY "Public read access" ON faqs FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public read access" ON hero_competitions FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public read access" ON partners FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public read access" ON testimonials FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public read access" ON site_stats FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public read access" ON site_metadata FOR SELECT TO anon, authenticated USING (true);

-- ============================================================================
-- User data policies - users can view/update their own data
-- ============================================================================

CREATE POLICY "Users can view own data" ON canonical_users FOR SELECT TO authenticated 
  USING (canonical_user_id = current_setting('request.jwt.claims', true)::json->>'sub' OR uid = auth.uid()::text);

CREATE POLICY "Users can update own data" ON canonical_users FOR UPDATE TO authenticated 
  USING (canonical_user_id = current_setting('request.jwt.claims', true)::json->>'sub' OR uid = auth.uid()::text);

CREATE POLICY "Users can insert own data" ON canonical_users FOR INSERT TO authenticated 
  WITH CHECK (canonical_user_id = current_setting('request.jwt.claims', true)::json->>'sub' OR uid = auth.uid()::text);

-- ============================================================================
-- Authenticated users can create orders, tickets, transactions
-- ============================================================================

CREATE POLICY "Authenticated users can create orders" ON orders FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can create tickets" ON tickets FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can create user_transactions" ON user_transactions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can create entries" ON competition_entries FOR INSERT TO authenticated WITH CHECK (true);

-- ============================================================================
-- Service role has full access to all tables
-- ============================================================================

CREATE POLICY "Service role full access" ON canonical_users TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON users TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON profiles TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON sub_account_balances TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON wallet_balances TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON wallet_ledger TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON balance_ledger TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON user_transactions TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON competitions TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON competition_entries TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON tickets TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON tickets_sold TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON pending_tickets TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON pending_ticket_items TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON winners TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON "Prize_Instantprizes" TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON orders TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON order_tickets TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON payment_idempotency TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON payment_webhook_events TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON payments_jobs TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON custody_transactions TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON internal_transfers TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON purchase_requests TO service_role USING (true) WITH CHECK (true);

-- ============================================================================
-- SECTION 3: GRANTS
-- ============================================================================

-- Grant table access
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

-- Grant sequence access
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

COMMIT;
