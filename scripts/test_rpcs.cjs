require("dotenv/config");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY",
);

const COMP_ID = "e2de6135-405d-452e-a74c-35dc2e7c8ec6";
const JERRY = "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363";

async function test() {
  console.log("=== FULL RPC SCAN ===\n");

  // Force schema reload
  console.log("1. Forcing schema reload...");
  await supabase.rpc("exec_sql", {
    sql_query: "NOTIFY pgrst, 'reload schema';",
  });

  // Wait
  await new Promise((r) => setTimeout(r, 2000));
  console.log("   Done waiting\n");

  // Test all function variations
  console.log("2. Testing get_unavailable_tickets variations:");

  let r = await supabase.rpc("get_unavailable_tickets", {
    p_competition_id: COMP_ID,
  });
  console.log(
    "   p_competition_id:",
    r.error?.message || r.data?.length + " tickets",
  );

  r = await supabase.rpc("get_unavailable_tickets", {
    competition_id: COMP_ID,
  });
  console.log(
    "   competition_id:",
    r.error?.message || r.data?.length + " tickets",
  );

  console.log("\n3. Testing get_user_competition_entries variations:");

  r = await supabase.rpc("get_user_competition_entries", {
    p_user_identifier: JERRY,
    p_competition_identifier: COMP_ID,
  });
  console.log(
    "   p_user_identifier + p_competition_identifier:",
    r.error?.message || r.data?.length + " entries",
  );

  r = await supabase.rpc("get_user_competition_entries", {
    user_identifier: JERRY,
    competition_identifier: COMP_ID,
  });
  console.log(
    "   user_identifier + competition_identifier:",
    r.error?.message || r.data?.length + " entries",
  );

  console.log(
    "\n4. Testing get_comprehensive_user_dashboard_entries variations:",
  );

  r = await supabase.rpc("get_comprehensive_user_dashboard_entries", {
    p_canonical_user_id: JERRY,
  });
  console.log(
    "   p_canonical_user_id:",
    r.error?.message || r.data?.length + " entries",
  );

  r = await supabase.rpc("get_comprehensive_user_dashboard_entries", {
    canonical_user_id: JERRY,
  });
  console.log(
    "   canonical_user_id:",
    r.error?.message || r.data?.length + " entries",
  );

  // Also check what the frontend actually uses
  console.log("\n5. Checking frontend-used signatures...");

  // From database.ts - check what names it uses
  r = await supabase.rpc("get_competition_entries", {
    competition_identifier: COMP_ID,
  });
  console.log(
    "   get_competition_entries(competition_identifier):",
    r.error?.message || r.data?.length + " entries",
  );

  r = await supabase.rpc("get_competition_entries_bypass_rls", {
    competition_identifier: COMP_ID,
  });
  console.log(
    "   get_competition_entries_bypass_rls(competition_identifier):",
    r.error?.message || r.data?.length + " entries",
  );

  console.log("\n=== END SCAN ===");
}

test().catch(console.error);
