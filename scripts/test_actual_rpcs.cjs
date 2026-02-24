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
  console.log("=== TESTING ACTUAL FUNCTION SIGNATURES ===\n");

  // 1. get_user_competition_entries - takes ONLY p_user_identifier
  console.log("1. get_user_competition_entries (one param: p_user_identifier)");
  let r = await supabase.rpc("get_user_competition_entries", {
    p_user_identifier: JERRY,
  });
  if (r.error) {
    console.log("   ERROR:", r.error.message);
  } else {
    console.log("   SUCCESS:", r.data?.length, "entries");
    const btc = r.data?.find((e) => e.competition_id === COMP_ID);
    if (btc) {
      console.log("   Bitcoin Bonanza:", btc.tickets_count, "tickets");
    }
  }

  // 2. get_comprehensive_user_dashboard_entries - takes p_user_identifier
  console.log(
    "\n2. get_comprehensive_user_dashboard_entries (p_user_identifier)",
  );
  r = await supabase.rpc("get_comprehensive_user_dashboard_entries", {
    p_user_identifier: JERRY,
  });
  if (r.error) {
    console.log("   ERROR:", r.error.message);
  } else {
    console.log("   SUCCESS:", r.data?.length, "entries");
  }

  // 3. get_unavailable_tickets - takes p_competition_id TEXT
  console.log("\n3. get_unavailable_tickets (p_competition_id TEXT)");
  r = await supabase.rpc("get_unavailable_tickets", {
    p_competition_id: COMP_ID,
  });
  if (r.error) {
    console.log("   ERROR:", r.error.message);
  } else {
    console.log("   SUCCESS:", r.data?.length, "unavailable tickets");
  }

  // 4. Direct tickets query as baseline
  console.log("\n4. Direct tickets table query (baseline)");
  const { data: tickets, count } = await supabase
    .from("tickets")
    .select("ticket_number", { count: "exact" })
    .eq("competition_id", COMP_ID)
    .eq("canonical_user_id", JERRY);
  console.log("   Jerry's tickets in Bitcoin Bonanza:", count);

  console.log("\n=== DONE ===");
}

test().catch(console.error);
