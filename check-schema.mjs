import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTcyNjU3MTM0NCwiZXhwIjoyMDQyMTQ3MzQ0fQ.iNRXMbPgw8FU5u3SBV_8vLzm2PqDGFyFhZCaLeXydDM",
);

console.log("Checking pending_tickets.competition_id column type...\n");

const { data, error } = await supabase.rpc("exec_sql", {
  query: `
    SELECT 
      column_name,
      data_type,
      udt_name
    FROM information_schema.columns
    WHERE table_name = 'pending_tickets'
      AND column_name = 'competition_id';
  `,
});

if (error) {
  console.error("Error:", error);

  // Try direct query
  console.log("\nTrying alternative query...");
  const { data: data2, error: error2 } = await supabase
    .from("pending_tickets")
    .select("competition_id")
    .limit(1);

  console.log("Data:", data2);
  console.log("Error:", error2);
} else {
  console.log("Column info:", data);
}
