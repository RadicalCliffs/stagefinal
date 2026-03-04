const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = "https://mthwfldcjvpxjtmrqkqm.supabase.co";
const serviceKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY";

const supabase = createClient(supabaseUrl, serviceKey);

async function checkJoinCompetitionSchema() {
  console.log("Checking joincompetition table structure...\n");

  const { data, error } = await supabase.rpc("get_table_schema", {
    p_table_name: "joincompetition",
  });

  if (error) {
    console.error("Error:", JSON.stringify(error, null, 2));
    console.log("\nTrying alternative method...");

    // Try selecting from the table to see what columns exist
    const { data: sample, error: err2 } = await supabase
      .from("joincompetition")
      .select("*")
      .limit(1);

    if (err2) {
      console.error("Alternative also failed:", JSON.stringify(err2, null, 2));
      return;
    }

    if (sample && sample.length > 0) {
      console.log("Columns in joincompetition table:");
      Object.keys(sample[0]).forEach((col) => {
        const val = sample[0][col];
        console.log(
          `  - ${col}: ${typeof val} (sample: ${JSON.stringify(val).substring(0, 50)})`,
        );
      });
    }
    return;
  }

  console.log("Schema:", JSON.stringify(data, null, 2));
}

checkJoinCompetitionSchema().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
