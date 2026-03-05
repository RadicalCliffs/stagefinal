-- ============================================================================
-- FIX: Add username field to get_competition_entries RPC
-- ============================================================================
-- Competition entries are showing "jerry" for all usernames because the
-- RPC function doesn't return username field - frontend falls back to
-- fetching usernames separately but that might be caching incorrectly.
-- 
-- FIX: Add username from canonical_users table via JOIN
-- ============================================================================

DROP FUNCTION IF EXISTS get_competition_entries_bypass_rls(TEXT) CASCADE;
DROP FUNCTION IF EXISTS get_competition_entries(TEXT) CASCADE;

CREATE OR REPLACE FUNCTION public.get_competition_entries_bypass_rls(competition_identifier TEXT)
RETURNS TABLE (
  uid TEXT,
  competitionid TEXT,
  userid TEXT,
  privy_user_id TEXT,
  numberoftickets INTEGER,
  ticketnumbers TEXT,
  amountspent NUMERIC,
  walletaddress TEXT,
  username TEXT,  -- ADDED: username from canonical_users
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
  comp_uuid UUID;
  comp_uid_text TEXT;
BEGIN
  -- Try to parse as UUID
  BEGIN
    comp_uuid := competition_identifier::UUID;
  EXCEPTION
    WHEN others THEN
      comp_uuid := NULL;
  END;

  -- Also try to look up by uid
  IF comp_uuid IS NULL THEN
    SELECT id, uid INTO comp_uuid, comp_uid_text
    FROM competitions
    WHERE uid = competition_identifier
    LIMIT 1;
  ELSE
    SELECT uid INTO comp_uid_text
    FROM competitions
    WHERE id = comp_uuid
    LIMIT 1;
  END IF;

  RETURN QUERY
  -- Source 1: joincompetition table with username JOIN
  SELECT
    jc.uid::TEXT,
    jc.competitionid::TEXT,
    COALESCE(jc.canonical_user_id, jc.userid, jc.user_id, '')::TEXT AS userid,
    COALESCE(jc.privy_user_id, jc.canonical_user_id, '')::TEXT AS privy_user_id,
    jc.numberoftickets::INTEGER,
    jc.ticketnumbers::TEXT,
    jc.amountspent::NUMERIC,
    COALESCE(
      jc.wallet_address::TEXT,
      CASE WHEN jc.canonical_user_id LIKE 'prize:pid:0x%' 
           THEN SUBSTRING(jc.canonical_user_id FROM 11)
           ELSE jc.userid::TEXT
      END,
      ''
    ) AS walletaddress,
    COALESCE(cu.username, '')::TEXT AS username,  -- ADDED: Get username from canonical_users
    COALESCE(jc.chain, 'Base')::TEXT AS chain,
    COALESCE(jc.transactionhash, '')::TEXT AS transactionhash,
    COALESCE(jc.purchasedate, jc.created_at, NOW())::TIMESTAMPTZ AS purchasedate,
    COALESCE(jc.created_at, NOW())::TIMESTAMPTZ AS created_at
  FROM joincompetition jc
  LEFT JOIN canonical_users cu ON cu.canonical_user_id = jc.canonical_user_id  -- JOIN to get username
  WHERE
    (jc.competitionid = competition_identifier)
    OR (comp_uuid IS NOT NULL AND jc.competitionid = comp_uuid::TEXT)
    OR (comp_uid_text IS NOT NULL AND comp_uid_text != '' AND jc.competitionid = comp_uid_text)

  UNION ALL

  -- Source 2: tickets table with username JOIN
  SELECT
    ('tickets-' || COALESCE(t.canonical_user_id, t.user_id, 'unknown') || '-' || t.competition_id::TEXT)::TEXT AS uid,
    t.competition_id::TEXT AS competitionid,
    COALESCE(t.canonical_user_id, t.user_id, '')::TEXT AS userid,
    COALESCE(t.user_id, '')::TEXT AS privy_user_id,
    COUNT(*)::INTEGER AS numberoftickets,
    string_agg(t.ticket_number::TEXT, ',' ORDER BY t.ticket_number)::TEXT AS ticketnumbers,
    COALESCE(SUM(t.purchase_price), 0)::NUMERIC AS amountspent,
    COALESCE(
      NULLIF(MAX(t.wallet_address), ''),
      CASE WHEN MAX(t.canonical_user_id) LIKE 'prize:pid:0x%' 
           THEN SUBSTRING(MAX(t.canonical_user_id) FROM 11)
           ELSE NULLIF(MAX(t.user_id), '')
      END,
      ''
    )::TEXT AS walletaddress,
    COALESCE(MAX(cu.username), '')::TEXT AS username,  -- ADDED: Get username from canonical_users
    'USDC'::TEXT AS chain,
    COALESCE(MAX(t.transaction_hash), '')::TEXT AS transactionhash,
    MIN(t.created_at)::TIMESTAMPTZ AS purchasedate,
    MIN(t.created_at)::TIMESTAMPTZ AS created_at
  FROM tickets t
  LEFT JOIN canonical_users cu ON cu.canonical_user_id = t.canonical_user_id  -- JOIN to get username
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

-- Create wrapper function
CREATE OR REPLACE FUNCTION public.get_competition_entries(competition_identifier TEXT)
RETURNS TABLE (
  uid TEXT,
  competitionid TEXT,
  userid TEXT,
  privy_user_id TEXT,
  numberoftickets INTEGER,
  ticketnumbers TEXT,
  amountspent NUMERIC,
  walletaddress TEXT,
  username TEXT,  -- ADDED
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

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.get_competition_entries_bypass_rls(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_competition_entries_bypass_rls(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_competition_entries_bypass_rls(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_competition_entries(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_competition_entries(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_competition_entries(TEXT) TO service_role;

-- Test: This should now show actual usernames, not all "jerry"
-- Replace with an actual competition ID
-- SELECT uid, walletaddress, username, ticketnumbers 
-- FROM get_competition_entries('your-competition-id-here') 
-- LIMIT 10;
