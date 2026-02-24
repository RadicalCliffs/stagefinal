require("dotenv/config");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY",
);

async function check() {
  console.log("=== Checking function signatures ===\n");

  const { data, error } = await supabase.rpc("exec_sql", {
    sql_query: `
      SELECT p.proname as name, 
             pg_get_function_arguments(p.oid) as args
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public'
      AND (p.proname LIKE '%competition%' OR p.proname LIKE '%dashboard%' OR p.proname LIKE '%unavailable%')
      ORDER BY p.proname;
    `,
  });

  if (error) {
    console.log("Error:", error.message);
    return;
  }

  console.log("Raw result:", JSON.stringify(data, null, 2));
}

check().catch(console.error);
