require("dotenv/config");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY",
);

const sql = `
-- Drop and recreate all RPCs with correct signatures

-- 1. get_unavailable_tickets (takes UUID)
DROP FUNCTION IF EXISTS get_unavailable_tickets(UUID);
DROP FUNCTION IF EXISTS get_unavailable_tickets(TEXT);

CREATE OR REPLACE FUNCTION get_unavailable_tickets(p_competition_id UUID)
RETURNS TABLE(ticket_number INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.ticket_number FROM tickets t WHERE t.competition_id = p_competition_id
  UNION
  SELECT pt.ticket_number FROM pending_tickets pt WHERE pt.competition_id = p_competition_id AND pt.expires_at > NOW();
$$;

GRANT EXECUTE ON FUNCTION get_unavailable_tickets(UUID) TO authenticated, anon, service_role;

-- 2. get_user_competition_entries (takes TEXT user, UUID competition)
DROP FUNCTION IF EXISTS get_user_competition_entries(TEXT, UUID);
DROP FUNCTION IF EXISTS get_user_competition_entries(TEXT, TEXT);

CREATE OR REPLACE FUNCTION get_user_competition_entries(
  p_user_identifier TEXT,
  p_competition_identifier UUID
)
RETURNS TABLE(
  ticket_number INTEGER,
  created_at TIMESTAMPTZ,
  transaction_hash TEXT,
  purchase_group_id UUID
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.ticket_number, t.created_at, t.transaction_hash, t.purchase_group_id
  FROM tickets t
  WHERE t.competition_id = p_competition_identifier
    AND (
      t.canonical_user_id = p_user_identifier
      OR LOWER(t.wallet_address) = LOWER(CASE WHEN p_user_identifier LIKE 'prize:pid:0x%' THEN SUBSTRING(p_user_identifier FROM 11) ELSE p_user_identifier END)
      OR t.user_id = p_user_identifier
    )
  ORDER BY t.ticket_number;
$$;

GRANT EXECUTE ON FUNCTION get_user_competition_entries(TEXT, UUID) TO authenticated, anon, service_role;

-- 3. get_comprehensive_user_dashboard_entries
DROP FUNCTION IF EXISTS get_comprehensive_user_dashboard_entries(TEXT);

CREATE OR REPLACE FUNCTION get_comprehensive_user_dashboard_entries(p_canonical_user_id TEXT)
RETURNS TABLE(
  competition_id UUID,
  competition_title TEXT,
  number_of_tickets BIGINT,
  ticket_numbers TEXT,
  created_at TIMESTAMPTZ,
  status TEXT,
  image_url TEXT,
  draw_date TIMESTAMPTZ,
  total_tickets INTEGER,
  tickets_sold INTEGER
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    t.competition_id,
    c.title AS competition_title,
    COUNT(*)::BIGINT AS number_of_tickets,
    string_agg(t.ticket_number::TEXT, ',' ORDER BY t.ticket_number) AS ticket_numbers,
    MIN(t.created_at) AS created_at,
    c.status,
    c.image_url,
    c.draw_date,
    c.total_tickets,
    c.tickets_sold
  FROM tickets t
  JOIN competitions c ON c.id = t.competition_id
  WHERE t.canonical_user_id = p_canonical_user_id
     OR LOWER(t.wallet_address) = LOWER(CASE WHEN p_canonical_user_id LIKE 'prize:pid:0x%' THEN SUBSTRING(p_canonical_user_id FROM 11) ELSE p_canonical_user_id END)
  GROUP BY t.competition_id, c.title, c.status, c.image_url, c.draw_date, c.total_tickets, c.tickets_sold
  ORDER BY MIN(t.created_at) DESC;
$$;

GRANT EXECUTE ON FUNCTION get_comprehensive_user_dashboard_entries(TEXT) TO authenticated, anon, service_role;

-- 4. Fix joincompetition counts to match tickets table
UPDATE joincompetition jc
SET numberoftickets = (
  SELECT COUNT(*) FROM tickets t 
  WHERE t.competition_id = COALESCE(jc.competition_id, jc.competitionid::UUID)
    AND t.canonical_user_id = jc.canonical_user_id
)
WHERE EXISTS (
  SELECT 1 FROM tickets t 
  WHERE t.competition_id = COALESCE(jc.competition_id, jc.competitionid::UUID)
    AND t.canonical_user_id = jc.canonical_user_id
);

-- 5. Notify schema reload
NOTIFY pgrst, 'reload schema';
`;

async function fix() {
  console.log("=== FIXING ALL RPCs ===\n");

  const { error } = await supabase.rpc("exec_sql", { sql_query: sql });

  if (error) {
    console.log("exec_sql error:", error.message);
    console.log("\nPlease run this SQL manually in the Supabase SQL Editor:");
    console.log(sql);
    return;
  }

  console.log("✅ All RPCs recreated!\n");

  // Test them
  const COMP_ID = "e2de6135-405d-452e-a74c-35dc2e7c8ec6";
  const JERRY = "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363";

  console.log("Testing RPCs...\n");

  // Test 1
  const { data: d1, error: e1 } = await supabase.rpc(
    "get_unavailable_tickets",
    {
      p_competition_id: COMP_ID,
    },
  );
  console.log(
    "get_unavailable_tickets:",
    e1 ? "❌ " + e1.message : `✅ ${d1?.length} tickets`,
  );

  // Test 2
  const { data: d2, error: e2 } = await supabase.rpc(
    "get_user_competition_entries",
    {
      p_user_identifier: JERRY,
      p_competition_identifier: COMP_ID,
    },
  );
  console.log(
    "get_user_competition_entries:",
    e2 ? "❌ " + e2.message : `✅ ${d2?.length} entries`,
  );

  // Test 3
  const { data: d3, error: e3 } = await supabase.rpc(
    "get_comprehensive_user_dashboard_entries",
    {
      p_canonical_user_id: JERRY,
    },
  );
  console.log(
    "get_comprehensive_user_dashboard_entries:",
    e3 ? "❌ " + e3.message : `✅ ${d3?.length} entries`,
  );

  if (d3?.length) {
    const btc = d3.find((e) => e.competition_id === COMP_ID);
    if (btc) {
      console.log("\n  Bitcoin Bonanza entry:");
      console.log("    tickets:", btc.number_of_tickets);
    }
  }

  // Check joincompetition fix
  const { data: jc } = await supabase
    .from("joincompetition")
    .select("canonical_user_id, numberoftickets")
    .or(`competitionid.eq.${COMP_ID},competition_id.eq.${COMP_ID}`);

  console.log("\nJoincompetition after fix:");
  jc?.forEach((e) =>
    console.log(
      `  ${e.canonical_user_id?.substring(0, 30)}...: ${e.numberoftickets}`,
    ),
  );

  console.log("\n=== DONE ===");
}

fix().catch(console.error);
