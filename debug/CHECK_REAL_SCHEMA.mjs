import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://mthwfldcjvpxjtmrqkqm.supabase.co";
const supabaseKey = "sb_publishable_w8xd4Fu4rqp0fnPpKPoR0Q_W9ykSBrx";

const supabase = createClient(supabaseUrl, supabaseKey);

console.log("=== CHECKING REAL DATABASE SCHEMA ===\n");

// Check pending_tickets table schema
const { data: pt_data, error: pt_error } = await supabase
  .from("pending_tickets")
  .select("*")
  .limit(1);

if (pt_error) {
  console.error("pending_tickets error:", pt_error);
} else {
  console.log("✓ pending_tickets accessible");
  if (pt_data && pt_data.length > 0) {
    console.log("Sample row:", pt_data[0]);
    console.log(
      "\nColumn with UUID type: competition_id =",
      pt_data[0].competition_id,
    );
    console.log("Type:", typeof pt_data[0].competition_id);
  }
}

// Try to query the information_schema using a raw SQL query via RPC
console.log("\n=== Attempting to get column types ===");

const { data: schema_data, error: schema_error } =
  await supabase.rpc("get_schema_info");

if (schema_error) {
  console.log("\nSchema RPC not available (expected)");
  console.log("\nPaste this in Supabase SQL Editor instead:");
  console.log("─".repeat(60));
  console.log(
    `
SELECT 
  table_name,
  column_name,
  data_type,
  udt_name AS pg_type
FROM information_schema.columns
WHERE table_name IN ('pending_tickets', 'tickets', 'competitions', 'joincompetition')
  AND column_name IN ('competition_id', 'competitionid', 'id')
ORDER BY table_name, column_name;
  `.trim(),
  );
  console.log("─".repeat(60));
} else {
  console.table(schema_data);
}
