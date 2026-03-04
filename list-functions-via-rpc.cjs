const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY",
);

async function listLuckyFunctions() {
  try {
    // Test if allocate function exists and what it does
    const { data, error } = await supabase.rpc(
      "allocate_lucky_dip_tickets_batch",
      {
        p_user_id: "test",
        p_competition_id: "00000000-0000-0000-0000-000000000000",
        p_count: 1,
        p_ticket_price: 0.5,
        p_hold_minutes: 15,
        p_session_id: null,
        p_excluded_tickets: null,
      },
    );

    console.log("\n=== TEST CALL TO allocate_lucky_dip_tickets_batch ===");
    if (error) {
      console.log("ERROR:", error.message);
      console.log("Code:", error.code);
      console.log("Details:", error.details);
      console.log("Hint:", error.hint);
    } else {
      console.log("SUCCESS:", JSON.stringify(data, null, 2));
    }

    // Try to list all functions via a raw SQL call (if we have a function that can execute it)
    console.log("\n=== Attempting to query functions directly ===");

    // Use PostgREST's ability to query system tables if exposed
    const { data: functions, error: funcError } = await supabase
      .from("pg_proc")
      .select("proname")
      .ilike("proname", "%lucky%");

    if (funcError) {
      console.log("Cannot query pg_proc directly:", funcError.message);
    } else {
      console.log("Functions found:", functions);
    }
  } catch (err) {
    console.error("Exception:", err.message);
  }
}

listLuckyFunctions();
