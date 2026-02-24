require("dotenv/config");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.PUBLIC_SUPABASE_URL || "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY",
);

const sql = `
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

  -- Try to parse as UUID (only if it looks like a UUID)
  IF competition_identifier ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    comp_uuid := competition_identifier::UUID;
    comp_uid_text := competition_identifier;
  ELSE
    -- Not a UUID, try to find by uid
    SELECT c.id, c.uid INTO comp_uuid, comp_uid_text
    FROM competitions c
    WHERE c.uid = competition_identifier
    LIMIT 1;
  END IF;

  -- If we have a UUID, get the uid as well
  IF comp_uuid IS NOT NULL AND (comp_uid_text IS NULL OR comp_uid_text = competition_identifier::TEXT) THEN
    SELECT c.uid INTO comp_uid_text
    FROM competitions c
    WHERE c.id = comp_uuid
    LIMIT 1;
  END IF;

  -- Return empty if we couldn't resolve the competition
  IF comp_uuid IS NULL THEN
    RETURN;
  END IF;

  -- Return results
  RETURN QUERY
  -- Source 1: joincompetition table 
  SELECT
    COALESCE(jc.uid::TEXT, jc.id::TEXT, gen_random_uuid()::TEXT) AS uid,
    COALESCE(jc.competitionid, '')::TEXT AS competitionid,
    COALESCE(jc.userid::TEXT, '')::TEXT AS userid,
    COALESCE(jc.privy_user_id, jc.wallet_address, '')::TEXT AS privy_user_id,
    COALESCE(jc.numberoftickets, 1)::INTEGER AS numberoftickets,
    COALESCE(jc.ticketnumbers, '')::TEXT AS ticketnumbers,
    COALESCE(jc.amountspent, 0)::NUMERIC AS amountspent,
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
  WHERE jc.competitionid = comp_uuid::TEXT
     OR jc.competition_id = comp_uuid

  UNION ALL

  -- Source 2: tickets table 
  SELECT
    ('tickets-' || COALESCE(t.canonical_user_id, t.user_id, 'unknown') || '-' || t.competition_id::TEXT)::TEXT AS uid,
    t.competition_id::TEXT AS competitionid,
    COALESCE(t.user_id, '')::TEXT AS userid,
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
    'USDC'::TEXT AS chain,
    COALESCE(MAX(t.transaction_hash), '')::TEXT AS transactionhash,
    MIN(t.created_at)::TIMESTAMPTZ AS purchasedate,
    MIN(t.created_at)::TIMESTAMPTZ AS created_at
  FROM tickets t
  WHERE t.competition_id = comp_uuid
    AND NOT EXISTS (
      SELECT 1 FROM joincompetition jc2
      WHERE (jc2.competitionid = comp_uuid::TEXT OR jc2.competition_id = comp_uuid)
        AND (
          jc2.canonical_user_id = t.canonical_user_id
          OR LOWER(jc2.wallet_address) = LOWER(t.wallet_address)
        )
    )
  GROUP BY t.competition_id, t.canonical_user_id, t.user_id

  ORDER BY purchasedate DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_competition_entries_bypass_rls(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_competition_entries_bypass_rls(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_competition_entries_bypass_rls(TEXT) TO service_role;

-- Wrapper
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
`;

async function fix() {
  console.log("Applying fixed get_competition_entries SQL...");

  const { error } = await supabase.rpc("exec_sql", { sql_query: sql });

  if (error) {
    console.log("Error:", error.message);
    return;
  }

  console.log("Success!");

  // Test
  console.log("\nTesting get_competition_entries...");
  const { data, error: testErr } = await supabase.rpc(
    "get_competition_entries",
    {
      competition_identifier: "e2de6135-405d-452e-a74c-35dc2e7c8ec6",
    },
  );

  if (testErr) {
    console.log("Test error:", testErr.message);
  } else {
    console.log("Test success! Got", data?.length, "entries");
    if (data?.[0]) {
      console.log("Sample entry:", {
        tickets: data[0].numberoftickets,
        wallet: data[0].walletaddress?.substring(0, 15) + "...",
      });
    }
  }
}

fix().catch(console.error);
