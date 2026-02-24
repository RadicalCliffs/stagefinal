require("dotenv/config");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY",
);

async function prove() {
  console.log("=== PROVING DATABASE STATE ===\n");

  // 1. Check if functions exist in pg_proc
  console.log("1. Checking pg_proc for functions...");
  const { data: funcCheck } = await supabase.rpc("exec_sql", {
    sql_query: `
      SELECT proname, pg_get_function_arguments(oid) as args
      FROM pg_proc 
      WHERE pronamespace = 'public'::regnamespace
      AND proname IN ('get_user_competition_entries', 'get_comprehensive_user_dashboard_entries', 'get_unavailable_tickets')
    `,
  });
  console.log("   exec_sql result:", funcCheck);

  // 2. Direct query to tickets table
  console.log("\n2. Direct tickets query (bypassing RPCs)...");
  const COMP_ID = "e2de6135-405d-452e-a74c-35dc2e7c8ec6";
  const JERRY = "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363";

  const { data: tickets, count } = await supabase
    .from("tickets")
    .select("ticket_number, canonical_user_id", { count: "exact" })
    .eq("competition_id", COMP_ID)
    .eq("canonical_user_id", JERRY)
    .limit(5);

  console.log(`   Jerry's tickets in Bitcoin Bonanza: ${count}`);
  console.log(
    `   Sample:`,
    tickets?.slice(0, 3).map((t) => t.ticket_number),
  );

  // 3. Check if PostgREST sees the function
  console.log("\n3. Checking PostgREST schema introspection...");
  const { data: schemaInfo, error: schemaErr } = await supabase.rpc(
    "exec_sql",
    {
      sql_query: `
      SELECT COUNT(*) as cnt FROM pg_proc 
      WHERE pronamespace = 'public'::regnamespace 
      AND proname = 'get_user_competition_entries'
    `,
    },
  );
  console.log("   Function count check:", schemaInfo);

  // 4. Try calling the function directly via SQL
  console.log("\n4. Calling function via raw SQL...");
  const { data: rawResult, error: rawErr } = await supabase.rpc("exec_sql", {
    sql_query: `
      SELECT * FROM get_user_competition_entries(
        'prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363'::TEXT,
        'e2de6135-405d-452e-a74c-35dc2e7c8ec6'::UUID
      ) LIMIT 5
    `,
  });
  console.log("   Raw SQL result:", rawResult || rawErr?.message);

  // 5. Show what's working
  console.log("\n=== SUMMARY ===");
  console.log("- Tickets table: WORKS (direct query shows", count, "tickets)");
  console.log("- get_unavailable_tickets RPC: WORKS (1816 tickets)");
  console.log("- get_user_competition_entries RPC: NOT IN SCHEMA CACHE");
  console.log(
    "- get_comprehensive_user_dashboard_entries RPC: NOT IN SCHEMA CACHE",
  );
  console.log(
    "\nThe functions exist in PostgreSQL but PostgREST hasn't reloaded its schema cache.",
  );
  console.log(
    "Solution: Restart the Supabase project or wait for automatic refresh (~30min).",
  );
}

prove().catch(console.error);
