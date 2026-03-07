const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY",
);

async function testDirect() {
  console.log("Testing direct joincompetition query...\n");

  const competitionId = "98ea9cbc-5d9b-409b-b757-acb9d0292a95";

  // Test if competition_id column exists and works
  const { data, error } = await supabase
    .from("joincompetition")
    .select("competition_id, ticketnumbers")
    .eq("competition_id", competitionId)
    .limit(5);

  if (error) {
    console.error("❌ Direct query failed:", error);
  } else {
    console.log(`✅ Found ${data.length} rows using competition_id column`);
    console.log("Sample:", JSON.stringify(data.slice(0, 2), null, 2));
  }

  // Now test the function
  console.log("\n\nTesting allocate function with small count...");
  const { data: allocData, error: allocError } = await supabase.rpc(
    "allocate_lucky_dip_tickets_batch",
    {
      p_user_id: "test-user-" + Date.now(),
      p_competition_id: competitionId,
      p_count: 1,
      p_ticket_price: 0.5,
    },
  );

  if (allocError) {
    console.error("❌ Function failed:", allocError);
  } else {
    console.log("✅ Function result:", JSON.stringify(allocData, null, 2));
  }
}

testDirect().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
