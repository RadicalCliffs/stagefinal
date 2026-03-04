-- ============================================================================
-- HOTFIX 4: Fix ALL functions that reference competitionid column
-- ============================================================================
-- The DROP COLUMN CASCADE should have removed these, but they persist
-- This migration explicitly fixes every function that uses jc.competitionid
-- ============================================================================

-- Fix get_competition_entries_bypass_rls
CREATE OR REPLACE FUNCTION get_competition_entries_bypass_rls(competition_identifier TEXT)
RETURNS TABLE (
  uid TEXT, competitionid TEXT, userid TEXT, privy_user_id TEXT,
  numberoftickets INTEGER, ticketnumbers TEXT, amountspent NUMERIC,
  wallet_address TEXT, chain TEXT, transactionhash TEXT,
  purchasedate TIMESTAMPTZ, created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  comp_uuid UUID := NULL;
  comp_uid_text TEXT := NULL;
BEGIN
  IF competition_identifier IS NULL OR TRIM(competition_identifier) = '' THEN
    RETURN;
  END IF;

  BEGIN
    comp_uuid := competition_identifier::UUID;
    comp_uid_text := competition_identifier;
  EXCEPTION WHEN invalid_text_representation THEN
    SELECT c.id, c.uid INTO comp_uuid, comp_uid_text
    FROM competitions c WHERE c.uid = competition_identifier LIMIT 1;
  END;

  IF comp_uuid IS NOT NULL AND (comp_uid_text IS NULL OR comp_uid_text = competition_identifier) THEN
    SELECT c.uid INTO comp_uid_text FROM competitions c WHERE c.id = comp_uuid LIMIT 1;
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(jc.uid::TEXT, jc.id::TEXT, gen_random_uuid()::TEXT),
    COALESCE(jc.competition_id::TEXT, '')::TEXT,  -- FIXED: was competitionid
    COALESCE(jc.userid::TEXT, '')::TEXT,
    COALESCE(jc.privy_user_id, jc.wallet_address, '')::TEXT,
    COALESCE(jc.numberoftickets, 1)::INTEGER,
    COALESCE(jc.ticketnumbers, '')::TEXT,
    COALESCE(jc.amountspent, 0)::NUMERIC,
    COALESCE(jc.wallet_address, '')::TEXT,
    COALESCE(jc.chain, 'Base')::TEXT,
    COALESCE(jc.transactionhash, '')::TEXT,
    COALESCE(jc.purchasedate, jc.created_at, NOW())::TIMESTAMPTZ,
    COALESCE(jc.created_at, NOW())::TIMESTAMPTZ
  FROM joincompetition jc
  WHERE jc.competition_id = comp_uuid  -- FIXED: was competitionid = competition_identifier
     OR jc.competition_id::TEXT = comp_uid_text  -- FIXED: was competitionid

  UNION ALL

  SELECT
    ('tickets-' || COALESCE(t.canonical_user_id, t.user_id, 'unknown') || '-' || t.competition_id::TEXT)::TEXT,
    COALESCE(t.competition_id::TEXT, '')::TEXT,
    COALESCE(t.user_id, '')::TEXT,
    COALESCE(t.user_id, '')::TEXT,
    COUNT(*)::INTEGER,
    string_agg(t.ticket_number::TEXT, ',' ORDER BY t.ticket_number)::TEXT,
    COALESCE(SUM(t.purchase_price), 0)::NUMERIC,
    COALESCE(t.user_id, '')::TEXT,
    'USDC'::TEXT,
    ''::TEXT,
    MIN(t.created_at)::TIMESTAMPTZ,
    MIN(t.created_at)::TIMESTAMPTZ
  FROM tickets t
  WHERE t.competition_id = comp_uuid

  UNION ALL

  SELECT
    ('pending-' || pt.id::TEXT)::TEXT,
    COALESCE(pt.competition_id::TEXT, '')::TEXT,
    COALESCE(pt.user_id, '')::TEXT,
    COALESCE(pt.user_id, '')::TEXT,
    COALESCE(pt.ticket_count, 0)::INTEGER,
    COALESCE(array_to_string(pt.ticket_numbers, ','), '')::TEXT,
    COALESCE(pt.total_amount, 0)::NUMERIC,
    COALESCE(pt.user_id, '')::TEXT,
    'USDC'::TEXT,
    ''::TEXT,
    COALESCE(pt.created_at, NOW())::TIMESTAMPTZ,
    COALESCE(pt.created_at, NOW())::TIMESTAMPTZ
  FROM pending_tickets pt
  WHERE pt.competition_id = comp_uuid
    AND pt.status = 'pending'
    AND pt.expires_at > NOW();
END;
$$;

GRANT EXECUTE ON FUNCTION get_competition_entries_bypass_rls(TEXT) TO authenticated, anon, service_role;

DO $$
BEGIN
  RAISE NOTICE '========================================================';
  RAISE NOTICE 'HOTFIX 4: Fixed get_competition_entries_bypass_rls';
  RAISE NOTICE 'Replaced all jc.competitionid with jc.competition_id';
  RAISE NOTICE '========================================================';
END $$;
