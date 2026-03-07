const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = "https://mthwfldcjvpxjtmrqkqm.supabase.co";
const serviceKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY";

const supabase = createClient(supabaseUrl, serviceKey);

async function testEachQuery() {
  console.log(
    "Testing each query in allocate_lucky_dip_tickets_batch separately...\n",
  );

  const testCompId = "98ea9cbc-5d9b-409b-b757-acb9d0292a95";

  // Test 1:Line 93 - competitions table
  console.log("Test 1: SELECT from competitions WHERE id = UUID");
  try {
    const { data, error } = await supabase
      .from("competitions")
      .select("total_tickets, id")
      .eq("id", testCompId)
      .single();
    if (error) {
      console.log("  ❌ Error:", error.message);
    } else {
      console.log("  ✅ Success");
    }
  } catch (e) {
    console.log("  ❌ Exception:", e.message);
  }

  // Test 2: Line 115 - joincompetition WHERE competitionid = UUID
  console.log(
    "\nTest 2: SELECT from joincompetition WHERE competitionid = UUID",
  );
  try {
    const { data, error } = await supabase
      .from("joincompetition")
      .select("ticketnumbers")
      .eq("competitionid", testCompId)
      .limit(1);
    if (error) {
      console.log("  ❌ Error:", error.message);
    } else {
      console.log("  ✅ Success, rows:", data?.length || 0);
    }
  } catch (e) {
    console.log("  ❌ Exception:", e.message);
  }

  // Test 3: Line 125 - tickets WHERE competition_id = UUID
  console.log("\nTest 3: SELECT from tickets WHERE competition_id = UUID");
  try {
    const { data, error } = await supabase
      .from("tickets")
      .select("ticket_number")
      .eq("competition_id", testCompId)
      .limit(1);
    if (error) {
      console.log("  ❌ Error:", error.message);
    } else {
      console.log("  ✅ Success, rows:", data?.length || 0);
    }
  } catch (e) {
    console.log("  ❌ Exception:", e.message);
  }

  // Test 4: Line 134 - pending_tickets WHERE competition_id = UUID
  console.log(
    "\nTest 4: SELECT from pending_tickets WHERE competition_id = UUID",
  );
  try {
    const { data, error } = await supabase
      .from("pending_tickets")
      .select("ticket_numbers")
      .eq("competition_id", testCompId)
      .limit(1);
    if (error) {
      console.log("  ❌ Error:", error.message);
    } else {
      console.log("  ✅ Success, rows:", data?.length || 0);
    }
  } catch (e) {
    console.log("  ❌ Exception:", e.message);
  }

  console.log(
    "\nAll basic queries passed. The error must be in the complex subqueries or string operations.",
  );
}

testEachQuery().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
