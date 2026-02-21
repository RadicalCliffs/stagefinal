-- HOTFIX: Fix get_competition_entries_bypass_rls to return correct wallet addresses
-- The "tickets" table fallback was returning user_id instead of wallet_address
-- Run this in Supabase SQL Editor

DROP FUNCTION IF EXISTS get_competition_entries_bypass_rls(TEXT) CASCADE;
DROP FUNCTION IF EXISTS get_competition_entries(TEXT) CASCADE;

CREATE OR REPLACE FUNCTION get_competition_entries_bypass_rls(competition_identifier TEXT)
RETURNS TABLE (
  uid TEXT,
  competitionid TEXT,
  userid TEXT,
  privy_user_id TEXT,
  numberoftickets INTEGER,
  ticketnumbers TEXT,
  amountspent NUMERIC,
  walletaddress TEXT,
  chain TEXT,
  transactionhash TEXT,
  purchasedate TIMESTAMPTZ,
  created_at TIMESTAMPTZ
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
  -- Handle NULL or empty input
  IF competition_identifier IS NULL OR TRIM(competition_identifier) = '' THEN
    RETURN;
  END IF;

  -- Try to parse as UUID
  BEGIN
    comp_uuid := competition_identifier::UUID;
    comp_uid_text := competition_identifier;
  EXCEPTION WHEN invalid_text_representation THEN
    -- Not a UUID, try to find by uid
    SELECT c.id, c.uid INTO comp_uuid, comp_uid_text
    FROM competitions c
    WHERE c.uid = competition_identifier
    LIMIT 1;
  END;

  -- If we have a UUID, get the uid as well
  IF comp_uuid IS NOT NULL AND (comp_uid_text IS NULL OR comp_uid_text = competition_identifier) THEN
    SELECT c.uid INTO comp_uid_text
    FROM competitions c
    WHERE c.id = comp_uuid
    LIMIT 1;
  END IF;

  -- Return results
  RETURN QUERY
  -- Source 1: joincompetition table (primary source)
  SELECT
    COALESCE(jc.uid::TEXT, jc.id::TEXT, gen_random_uuid()::TEXT) AS uid,
    COALESCE(jc.competitionid, '')::TEXT AS competitionid,
    COALESCE(jc.userid::TEXT, '')::TEXT AS userid,
    COALESCE(jc.privy_user_id, jc.wallet_address, '')::TEXT AS privy_user_id,
    COALESCE(jc.numberoftickets, 1)::INTEGER AS numberoftickets,
    COALESCE(jc.ticketnumbers, '')::TEXT AS ticketnumbers,
    COALESCE(jc.amountspent, 0)::NUMERIC AS amountspent,
    -- Extract wallet from canonical_user_id or wallet_address
    COALESCE(
      NULLIF(jc.wallet_address, ''),
      CASE WHEN jc.canonical_user_id LIKE 'prize:pid:0x%' 
           THEN SUBSTRING(jc.canonical_user_id FROM 11) 
           ELSE NULL 
      END,
      ''
    )::TEXT AS walletaddress,
    COALESCE(jc.chain, 'Base')::TEXT AS chain,
    COALESCE(jc.transactionhash, '')::TEXT AS transactionhash,
    COALESCE(jc.purchasedate, jc.created_at, NOW())::TIMESTAMPTZ AS purchasedate,
    COALESCE(jc.created_at, NOW())::TIMESTAMPTZ AS created_at
  FROM joincompetition jc
  WHERE
    jc.competitionid = competition_identifier
    OR (comp_uuid IS NOT NULL AND jc.competitionid = comp_uuid::TEXT)
    OR (comp_uid_text IS NOT NULL AND comp_uid_text != '' AND jc.competitionid = comp_uid_text)

  UNION ALL

  -- Source 2: tickets table (fallback)
  -- FIX: Use actual wallet_address column and extract from canonical_user_id
  SELECT
    ('tickets-' || COALESCE(t.canonical_user_id, t.user_id, 'unknown') || '-' || t.competition_id::TEXT)::TEXT AS uid,
    COALESCE(t.competition_id::TEXT, '')::TEXT AS competitionid,
    COALESCE(t.user_id, '')::TEXT AS userid,
    COALESCE(t.user_id, '')::TEXT AS privy_user_id,
    COUNT(*)::INTEGER AS numberoftickets,
    string_agg(t.ticket_number::TEXT, ',' ORDER BY t.ticket_number)::TEXT AS ticketnumbers,
    COALESCE(SUM(t.purchase_price), 0)::NUMERIC AS amountspent,
    -- FIX: Extract wallet from wallet_address OR canonical_user_id
    COALESCE(
      NULLIF(MAX(t.wallet_address), ''),
      CASE WHEN MAX(t.canonical_user_id) LIKE 'prize:pid:0x%' 
           THEN SUBSTRING(MAX(t.canonical_user_id) FROM 11) 
           ELSE NULLIF(MAX(t.user_id), '')
      END,
      ''
    )::TEXT AS walletaddress,
    'USDC'::TEXT AS chain,
    COALESCE(MAX(t.transaction_hash), '')::TEXT AS transactionhash,
    MIN(t.created_at)::TIMESTAMPTZ AS purchasedate,
    MIN(t.created_at)::TIMESTAMPTZ AS created_at
  FROM tickets t
  WHERE
    comp_uuid IS NOT NULL
    AND t.competition_id = comp_uuid
    -- Only include tickets that don't have a corresponding joincompetition entry
    AND NOT EXISTS (
      SELECT 1 FROM joincompetition jc2
      WHERE (
        jc2.competitionid = competition_identifier
        OR (comp_uuid IS NOT NULL AND jc2.competitionid = comp_uuid::TEXT)
        OR (comp_uid_text IS NOT NULL AND comp_uid_text != '' AND jc2.competitionid = comp_uid_text)
      )
      AND (
        jc2.canonical_user_id = t.canonical_user_id
        OR LOWER(jc2.wallet_address) = LOWER(t.user_id)
        OR jc2.userid::TEXT = t.user_id
      )
    )
  GROUP BY t.competition_id, t.canonical_user_id, t.user_id

  ORDER BY purchasedate DESC;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_competition_entries_bypass_rls(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_competition_entries_bypass_rls(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_competition_entries_bypass_rls(TEXT) TO service_role;

-- Create wrapper function
CREATE OR REPLACE FUNCTION get_competition_entries(competition_identifier TEXT)
RETURNS TABLE (
  uid TEXT,
  competitionid TEXT,
  userid TEXT,
  privy_user_id TEXT,
  numberoftickets INTEGER,
  ticketnumbers TEXT,
  amountspent NUMERIC,
  walletaddress TEXT,
  chain TEXT,
  transactionhash TEXT,
  purchasedate TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN QUERY SELECT * FROM get_competition_entries_bypass_rls(competition_identifier);
END;
$$;

GRANT EXECUTE ON FUNCTION get_competition_entries(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_competition_entries(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_competition_entries(TEXT) TO service_role;

-- Test query (replace with actual competition ID)
-- SELECT * FROM get_competition_entries_bypass_rls('your-competition-id-here');
