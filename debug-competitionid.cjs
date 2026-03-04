const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = "https://mthwfldcjvpxjtmrqkqm.supabase.co";
const serviceKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY";

const supabase = createClient(supabaseUrl, serviceKey);

async function debug() {
  console.log("Checking joincompetition.competitionid values...\n");

  const { data, error } = await supabase
    .from("joincompetition")
    .select("competitionid")
    .limit(5);

  if (error) {
    console.error("Error:", JSON.stringify(error, null, 2));
    return;
  }

  console.log("Sample values:");
  data.forEach((row, i) => {
    console.log(
      `  ${i + 1}. ${row.competitionid} (type: ${typeof row.competitionid})`,
    );
  });

  console.log("\nQuerying competitions to compare...");
  const { data: comp } = await supabase
    .from("competitions")
    .select("id")
    .limit(3);

  console.log("\nCompetition IDs:");
  comp.forEach((row, i) => {
    console.log(`  ${i + 1}. ${row.id} (type: ${typeof row.id})`);
  });
}

debug().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
