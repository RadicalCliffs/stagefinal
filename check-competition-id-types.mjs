import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://mthwfldcjvpxjtmrqkqm.supabase.co";
const supabaseKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY";

const supabase = createClient(supabaseUrl, supabaseKey);

const query = `
SELECT 
  table_name,
  column_name,
  data_type,
  udt_name
FROM information_schema.columns
WHERE table_name IN ('joincompetition', 'tickets', 'pending_tickets', 'competitions')
  AND column_name LIKE '%competition%'
ORDER BY table_name, ordinal_position;
`;

console.log("Checking competition_id column types...\n");

const { data, error } = await supabase
  .rpc("execute_sql", { query_text: query })
  .single();

if (error) {
  // Try direct query instead
  const { data: queryData, error: queryError } = await supabase
    .from("information_schema.columns")
    .select("*");
  console.log("Query error, trying alternative...");
}

// Alternative: just check the schema directly
const queries = [
  `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'joincompetition' AND column_name LIKE '%competition%'`,
  `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'tickets' AND column_name LIKE '%competition%'`,
  `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'pending_tickets' AND column_name LIKE '%competition%'`,
  `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'competitions' AND column_name LIKE '%competition%'`,
];

for (const q of queries) {
  const result = await supabase.rpc("run_sql", { sql: q });
  console.log("Query:", q);
  console.log("Result:", result);
  console.log("---");
}
