const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = "https://mthwfldcjvpxjtmrqkqm.supabase.co";
const serviceKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY";

const supabase = createClient(supabaseUrl, serviceKey);

async function checkActualTypes() {
  console.log("Querying information_schema for ACTUAL column types...\n");

  const { data, error } = await supabase.rpc("check_competition_column_types");

  if (error) {
    console.error("Error calling RPC:", JSON.stringify(error, null, 2));
    return;
  }

  console.log("Results:");
  data.forEach((row) => {
    console.log(`  ${row.table_name}.${row.column_name} = ${row.data_type}`);
  });

  // Now check joincompetition specifically
  console.log("\n\nNow checking joincompetition.competitionid specifically...");
  console.log(
    "(Note: Supabase JS returns UUIDs as strings, but we need the DB type)\n",
  );

  const { data: sample } = await supabase
    .from("joincompetition")
    .select("competitionid, competition_id")
    .limit(1);

  if (sample && sample.length > 0) {
    console.log("Sample row:");
    console.log(
      `  competitionid: ${sample[0].competitionid} (JS type: ${typeof sample[0].competitionid})`,
    );
    console.log(
      `  competition_id: ${sample[0].competition_id} (JS type: ${typeof sample[0].competition_id})`,
    );
  }
}

checkActualTypes().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
