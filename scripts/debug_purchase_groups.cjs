require("dotenv/config");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY",
);

const COMP_ID = "e2de6135-405d-452e-a74c-35dc2e7c8ec6";
const JERRY = "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363";

async function debug() {
  console.log("=== DEBUGGING PURCHASE_GROUPS ===\n");

  // Check if it's a table or view
  const { data: tableType } = await supabase.rpc("exec_sql", {
    sql_query: `
      SELECT table_type, table_name
      FROM information_schema.tables 
      WHERE table_name = 'purchase_groups' AND table_schema = 'public'
    `,
  });
  console.log("1. purchase_groups type:", tableType);

  // If it's a view, get the definition
  const { data: viewDef } = await supabase.rpc("exec_sql", {
    sql_query: `
      SELECT pg_get_viewdef('purchase_groups'::regclass, true) as definition
    `,
  });
  console.log("\n2. View definition:", viewDef);

  // Check Session #10's events array
  const { data: session10 } = await supabase
    .from("purchase_groups")
    .select("*")
    .eq("user_id", JERRY)
    .eq("competition_id", COMP_ID)
    .eq("purchase_group_number", 10)
    .single();

  console.log("\n3. Session #10 full data:");
  console.log(JSON.stringify(session10, null, 2));

  // Check what events are in this session
  if (session10?.events) {
    console.log("\n4. Events in Session #10:");
    session10.events.forEach((e, i) => {
      console.log(`  Event ${i + 1}:`, {
        amount: e.amount,
        tickets: e.tickets?.length || e.tickets_count,
      });
    });
  }
}

debug().catch(console.error);
