/*
  # Add Username to Competition Winners View

  ## Problem:
  The competition_winners view only includes wallet_address for identifying winners.
  Since we now store usernames directly in the winners table, we should include it
  in the view so the frontend can display proper usernames without additional lookups.

  ## Solution:
  1. Recreate the competition_winners view to include the username column from winners table
  2. Update the get_recent_winners RPC to also return username
*/

-- ============================================================================
-- Recreate the competition_winners view with username
-- ============================================================================

-- Drop VIEW first (in case it exists as view)
DROP VIEW IF EXISTS competition_winners CASCADE;

-- Create competition_winners as a VIEW that always shows current data
-- Now includes username from winners table for direct display
CREATE VIEW competition_winners AS
SELECT
  w.id,
  -- Get prize value from competition - it's stored as text like "$5000 BTC"
  COALESCE(c.prize_value::text, '0') AS competitionprize,
  -- Winner wallet address (used as identifier for lookups)
  COALESCE(w.wallet_address, '') AS "Winner",
  -- Username from winners table (for direct display without additional lookup)
  w.username AS winner_username,
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
Columns: competitionprize, Winner, winner_username, crDate, competitionname, imageurl, competitionid, txhash.
Used by the landing page winners carousel.';

-- ============================================================================
-- Update the get_recent_winners RPC to include username
-- ============================================================================

CREATE OR REPLACE FUNCTION get_recent_winners(
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  id uuid,
  competitionprize text,
  winner_wallet text,
  winner_username text,
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
    w.username::text,
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
Now includes winner_username for direct display without additional canonical_users lookup.
Filters out entries without wallet addresses and orders by draw date descending.';

-- ============================================================================
-- Completion Notice
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '============================================================';
  RAISE NOTICE 'Competition Winners View Updated';
  RAISE NOTICE '============================================================';
  RAISE NOTICE 'Changes:';
  RAISE NOTICE '  - Added winner_username column to competition_winners view';
  RAISE NOTICE '  - Updated get_recent_winners RPC to return winner_username';
  RAISE NOTICE '============================================================';
END $$;
