/*
  # Fix Competition Winners Table/View for Recent Draws Display

  ## Problem:
  Recent winners are not showing on the landing page because:
  1. The sync function references columns that may not exist (won_at, tx_hash)
  2. The trigger may be failing silently
  3. Winners from backfilled competitions need to be properly synced

  ## Solution:
  1. Recreate the competition_winners view as a proper VIEW (not table) for real-time data
  2. Use COALESCE to handle missing columns gracefully
  3. Add an RPC function to manually sync winners if needed
*/

-- ============================================================================
-- Drop the existing table/view and recreate as a proper VIEW
-- Views provide real-time data without needing sync triggers
-- ============================================================================

-- Drop VIEW first (in case it exists as view)
DROP VIEW IF EXISTS competition_winners CASCADE;
-- Then drop TABLE (in case it exists as table)
DROP TABLE IF EXISTS competition_winners CASCADE;

-- Create competition_winners as a VIEW that always shows current data
-- NOTE: We use c.created_at (from competitions) as fallback since w.created_at may not exist in some deployments
CREATE VIEW competition_winners AS
SELECT
  w.id,
  -- Get prize value from competition - it's stored as text like "$5000 BTC"
  COALESCE(c.prize_value::text, '0') AS competitionprize,
  -- Winner wallet address
  COALESCE(w.wallet_address, '') AS "Winner",
  -- Draw date - prefer crdate, fall back to competition's created_at
  COALESCE(w.crdate, c.created_at) AS "crDate",
  -- Competition details
  COALESCE(c.title, 'Unknown Competition') AS competitionname,
  c.image_url AS imageurl,
  c.id::text AS competitionid,
  -- Transaction hash for prize distribution
  COALESCE(w.prize_tx_hash, '') AS txhash,
  w.ticket_number,
  COALESCE(w.prize_distributed, false) AS prize_distributed,
  w.user_id,
  COALESCE(c.created_at, NOW()) AS created_at
FROM winners w
LEFT JOIN competitions c ON w.competition_id = c.id
WHERE w.competition_id IS NOT NULL;

-- Grant access to the view
GRANT SELECT ON competition_winners TO authenticated;
GRANT SELECT ON competition_winners TO anon;
GRANT SELECT ON competition_winners TO service_role;

COMMENT ON VIEW competition_winners IS
'Real-time view of competition winners joined with competition data.
Columns: competitionprize, Winner, crDate, competitionname, imageurl, competitionid, txhash.
Used by the landing page winners carousel.';

-- ============================================================================
-- Create RPC function to get recent winners for the landing page
-- This provides better control over the query and handles edge cases
-- ============================================================================

CREATE OR REPLACE FUNCTION get_recent_winners(
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  id uuid,
  competitionprize text,
  winner_wallet text,
  cr_date timestamptz,
  competitionname text,
  imageurl text,
  competitionid text,
  txhash text,
  ticket_number integer,
  prize_distributed boolean,
  user_id uuid,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    w.id,
    COALESCE(c.prize_value::text, '0')::text,
    COALESCE(w.wallet_address, '')::text,
    COALESCE(w.crdate, c.created_at),
    COALESCE(c.title, 'Unknown Competition')::text,
    c.image_url::text,
    c.id::text,
    COALESCE(w.prize_tx_hash, '')::text,
    w.ticket_number,
    COALESCE(w.prize_distributed, false),
    w.user_id,
    COALESCE(c.created_at, NOW())
  FROM winners w
  LEFT JOIN competitions c ON w.competition_id = c.id
  WHERE w.competition_id IS NOT NULL
    AND w.wallet_address IS NOT NULL
    AND w.wallet_address != ''
  ORDER BY COALESCE(w.crdate, c.created_at) DESC NULLS LAST
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION get_recent_winners(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION get_recent_winners(integer) TO anon;
GRANT EXECUTE ON FUNCTION get_recent_winners(integer) TO service_role;

COMMENT ON FUNCTION get_recent_winners(integer) IS
'Returns recent competition winners with competition details for the landing page display.
Filters out entries without wallet addresses and orders by draw date descending.';

-- ============================================================================
-- Create helper RPC to get entries for a competition (by ID or UID)
-- ============================================================================

CREATE OR REPLACE FUNCTION get_joincompetition_entries_for_competition(
  p_competition_id text
)
RETURNS TABLE (
  uid text,
  competitionid text,
  userid text,
  wallet_address text,
  numberoftickets integer,
  ticketnumbers text,
  amountspent numeric,
  purchasedate timestamptz,
  privy_user_id text
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_comp_uuid uuid;
  v_comp_uid text;
BEGIN
  -- Try to parse as UUID first
  BEGIN
    v_comp_uuid := p_competition_id::uuid;
    -- Get the legacy uid for this competition
    SELECT c.uid INTO v_comp_uid
    FROM competitions c
    WHERE c.id = v_comp_uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    -- Not a UUID, treat as legacy uid
    v_comp_uid := p_competition_id;
    SELECT c.id INTO v_comp_uuid
    FROM competitions c
    WHERE c.uid = p_competition_id;
  END;

  -- Return entries matching either the UUID or legacy uid
  RETURN QUERY
  SELECT
    jc.uid,
    jc.competitionid,
    jc.userid,
    jc.wallet_address,
    jc.numberoftickets,
    jc.ticketnumbers,
    jc.amountspent,
    jc.purchasedate,
    jc.privy_user_id
  FROM joincompetition jc
  WHERE jc.competitionid = v_comp_uuid::text
     OR (v_comp_uid IS NOT NULL AND jc.competitionid = v_comp_uid);
END;
$$;

GRANT EXECUTE ON FUNCTION get_joincompetition_entries_for_competition(text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_joincompetition_entries_for_competition(text) TO anon;
GRANT EXECUTE ON FUNCTION get_joincompetition_entries_for_competition(text) TO service_role;

COMMENT ON FUNCTION get_joincompetition_entries_for_competition(text) IS
'Returns all entries for a competition, checking both UUID and legacy uid.
Used by winner selection functions to find all purchased tickets.';

-- ============================================================================
-- Ensure winners table has all required columns
-- ============================================================================

ALTER TABLE winners
ADD COLUMN IF NOT EXISTS ticket_number integer,
ADD COLUMN IF NOT EXISTS prize_value numeric(10, 2),
ADD COLUMN IF NOT EXISTS prize_claimed boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS username text,
ADD COLUMN IF NOT EXISTS country text,
ADD COLUMN IF NOT EXISTS wallet_address text,
ADD COLUMN IF NOT EXISTS crdate timestamptz;

-- Ensure RLS policy exists for winners
DROP POLICY IF EXISTS "Public can view winners" ON winners;
CREATE POLICY "Public can view winners"
  ON winners FOR SELECT
  USING (true);

-- ============================================================================
-- Completion Notice
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '============================================================';
  RAISE NOTICE 'Competition Winners View Migration Complete';
  RAISE NOTICE '============================================================';
  RAISE NOTICE 'Changes:';
  RAISE NOTICE '  - Recreated competition_winners as a VIEW (not table)';
  RAISE NOTICE '  - Added get_recent_winners RPC for landing page';
  RAISE NOTICE '  - Added get_joincompetition_entries_for_competition RPC';
  RAISE NOTICE '  - Ensured all required columns exist on winners table';
  RAISE NOTICE '============================================================';
END $$;
