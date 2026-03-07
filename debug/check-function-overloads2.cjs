const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY",
);

async function checkOverloads() {
  console.log("Checking for allocate_lucky_dip_tickets_batch overloads...\n");

  const { data, error } = await supabase.rpc("exec_sql_query", {
    sql_query: `
      SELECT 
        p.oid,
        p.proname AS function_name,
        pg_catalog.pg_get_function_arguments(p.oid) AS arguments,
        pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_args
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public'
        AND p.proname = 'allocate_lucky_dip_tickets_batch'
      ORDER BY p.oid;
    `,
  });

  if (error) {
    console.error("Error:", error);
  } else {
    console.log("Found versions:", JSON.stringify(data, null, 2));
    console.log(`\nTotal versions: ${data ? data.length : 0}`);
  }
}

checkOverloads();
