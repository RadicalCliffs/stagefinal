const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = "https://mthwfldcjvpxjtmrqkqm.supabase.co";
const serviceKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY";

const supabase = createClient(supabaseUrl, serviceKey);

async function checkFunctionVersions() {
  console.log("Checking all versions of allocate_lucky_dip_tickets_batch...\n");

  // Use the check_competition_column_types RPC as a template - we know this one works
  const { data, error } = await supabase.rpc("check_competition_column_types");

  if (error) {
    console.error("Error:", JSON.stringify(error, null, 2));
  } else {
    console.log("Schema check result:");
    console.log(JSON.stringify(data, null, 2));
  }

  // Now let's try to see what functions exist
  console.log("\n\nLet me check the Supabase dashboard SQL editor instead...");
  console.log("Run this query in the SQL Editor:\n");
  console.log(`
SELECT 
  p.proname as function_name,
  pg_catalog.pg_get_function_arguments(p.oid) as arguments,
  pg_catalog.pg_get_functiondef(p.oid) as full_definition
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' 
  AND p.proname LIKE '%allocate_lucky_dip%'
ORDER BY p.proname, p.oid;
  `);
}

checkFunctionVersions().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
