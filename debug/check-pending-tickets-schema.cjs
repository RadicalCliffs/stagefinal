const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = "https://mthwfldcjvpxjtmrqkqm.supabase.co";
const serviceKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY";

const supabase = createClient(supabaseUrl, serviceKey);

async function checkPendingTicketsSchema() {
  console.log("Checking pending_tickets table structure...\n");

  const { data: sample, error } = await supabase
    .from("pending_tickets")
    .select("*")
    .limit(1);

  if (error) {
    console.error("Error:", JSON.stringify(error, null, 2));
    return;
  }

  if (sample && sample.length > 0) {
    console.log("Columns in pending_tickets table:");
    Object.keys(sample[0]).forEach((col) => {
      const val = sample[0][col];
      const valStr = JSON.stringify(val);
      console.log(
        `  - ${col}: ${typeof val} (sample: ${valStr.substring(0, 60)}${valStr.length > 60 ? "..." : ""})`,
      );
    });
  } else {
    console.log(
      "No rows found in pending_tickets, checking tickets table instead...",
    );

    const { data: sample2, error: err2 } = await supabase
      .from("tickets")
      .select("*")
      .limit(1);

    if (sample2 && sample2.length > 0) {
      console.log("\nColumns in tickets table:");
      Object.keys(sample2[0]).forEach((col) => {
        const val = sample2[0][col];
        const valStr = JSON.stringify(val);
        console.log(
          `  - ${col}: ${typeof val} (sample: ${valStr.substring(0, 60)}${valStr.length > 60 ? "..." : ""})`,
        );
      });
    }
  }
}

checkPendingTicketsSchema().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
