import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "sb_publishable_w8xd4Fu4rqp0fnPpKPoR0Q_W9ykSBrx",
);

console.log("=== Checking tickets table columns in Supabase ===\n");

// Query the information_schema to get actual column names
const { data, error } = await supabase.rpc("exec_sql", {
  sql_query: `
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' 
    AND table_name = 'tickets'
    ORDER BY ordinal_position;
  `,
});

if (error) {
  console.log("Trying alternative method...\n");

  // Try selecting from tickets with limit 0 to see columns
  const { data: ticketData, error: ticketError } = await supabase
    .from("tickets")
    .select("*")
    .limit(1);

  if (ticketError) {
    console.error("❌ Error:", ticketError);
  } else if (ticketData && ticketData.length > 0) {
    console.log("✅ Tickets table columns (from actual data):");
    console.log(Object.keys(ticketData[0]).sort().join("\n"));
  }
} else {
  console.log("✅ Tickets table schema:");
  console.log(data);
}
