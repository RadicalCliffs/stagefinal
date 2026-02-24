require("dotenv/config");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY",
);

const COMP_ID = "e2de6135-405d-452e-a74c-35dc2e7c8ec6";
const JERRY = "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363";

// Split into individual statements
const statements = [
  // 1. Create get_user_competition_entries
  `CREATE OR REPLACE FUNCTION get_user_competition_entries(
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
  AS $fn$
    SELECT t.ticket_number, t.created_at, t.transaction_hash, t.purchase_group_id
    FROM tickets t
    WHERE t.competition_id = p_competition_identifier
      AND (
        t.canonical_user_id = p_user_identifier
        OR LOWER(t.wallet_address) = LOWER(
          CASE WHEN p_user_identifier LIKE 'prize:pid:0x%' 
               THEN SUBSTRING(p_user_identifier FROM 11) 
               ELSE p_user_identifier 
          END
        )
        OR t.user_id = p_user_identifier
      )
    ORDER BY t.ticket_number;
  $fn$`,

  // 2. Grant on get_user_competition_entries
  `GRANT EXECUTE ON FUNCTION get_user_competition_entries(TEXT, UUID) TO authenticated, anon, service_role`,

  // 3. Create get_comprehensive_user_dashboard_entries
  `CREATE OR REPLACE FUNCTION get_comprehensive_user_dashboard_entries(p_canonical_user_id TEXT)
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
  AS $fn$
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
       OR LOWER(t.wallet_address) = LOWER(
         CASE WHEN p_canonical_user_id LIKE 'prize:pid:0x%' 
              THEN SUBSTRING(p_canonical_user_id FROM 11) 
              ELSE p_canonical_user_id 
         END
       )
    GROUP BY t.competition_id, c.title, c.status, c.image_url, c.draw_date, c.total_tickets, c.tickets_sold
    ORDER BY MIN(t.created_at) DESC;
  $fn$`,

  // 4. Grant on get_comprehensive_user_dashboard_entries
  `GRANT EXECUTE ON FUNCTION get_comprehensive_user_dashboard_entries(TEXT) TO authenticated, anon, service_role`,

  // 5. Schema reload
  `NOTIFY pgrst, 'reload schema'`,
];

async function fix() {
  console.log("=== CREATING MISSING RPCs ===\n");

  for (let i = 0; i < statements.length; i++) {
    const sql = statements[i];
    const shortName = sql.substring(0, 60).replace(/\s+/g, " ");
    console.log(`${i + 1}. ${shortName}...`);

    const { error } = await supabase.rpc("exec_sql", { sql_query: sql });
    if (error) {
      console.log(`   ERROR: ${error.message}`);
    } else {
      console.log(`   OK`);
    }
  }

  // Wait for schema to reload
  console.log("\nWaiting for schema reload...");
  await new Promise((r) => setTimeout(r, 3000));

  // Test
  console.log("\n=== TESTING ===\n");

  let r = await supabase.rpc("get_unavailable_tickets", {
    p_competition_id: COMP_ID,
  });
  console.log(
    "get_unavailable_tickets:",
    r.error?.message || `✅ ${r.data?.length} tickets`,
  );

  r = await supabase.rpc("get_user_competition_entries", {
    p_user_identifier: JERRY,
    p_competition_identifier: COMP_ID,
  });
  console.log(
    "get_user_competition_entries:",
    r.error?.message || `✅ ${r.data?.length} entries`,
  );

  r = await supabase.rpc("get_comprehensive_user_dashboard_entries", {
    p_canonical_user_id: JERRY,
  });
  console.log(
    "get_comprehensive_user_dashboard_entries:",
    r.error?.message || `✅ ${r.data?.length} entries`,
  );

  if (r.data?.length && !r.error) {
    const btc = r.data.find((e) => e.competition_id === COMP_ID);
    if (btc) {
      console.log(`\n  Bitcoin Bonanza: ${btc.number_of_tickets} tickets`);
    }
  }

  console.log("\n=== DONE ===");
}

fix().catch(console.error);
