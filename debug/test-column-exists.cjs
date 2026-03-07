const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY",
);

async function testDirectQuery() {
  console.log(
    "Testing if the schema actually allows querying joincompetition with competitionid...\n",
  );

  // Try to query using the OLD column name
  const { data: oldCol, error: oldErr } = await supabase
    .from("joincompetition")
    .select("competitionid")
    .limit(1);

  console.log("Query with competitionid column:");
  if (oldErr) {
    console.log("  ❌ ERROR (expected):", oldErr.message);
  } else {
    console.log("  ✅ SUCCESS (unexpected!) - Column still exists?");
    console.log("  Data:", oldCol);
  }

  // Try with the NEW column name
  const { data: newCol, error: newErr } = await supabase
    .from("joincompetition")
    .select("competition_id")
    .limit(1);

  console.log("\nQuery with competition_id column:");
  if (newErr) {
    console.log("  ❌ ERROR:", newErr.message);
  } else {
    console.log("  ✅ SUCCESS");
    console.log("  Data:", newCol);
  }
}

testDirectQuery();
