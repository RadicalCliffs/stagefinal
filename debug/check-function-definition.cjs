const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = "https://mthwfldcjvpxjtmrqkqm.supabase.co";
const serviceKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY";

const supabase = createClient(supabaseUrl, serviceKey);

async function checkFunction() {
  console.log(
    "Checking allocate_lucky_dip_tickets_batch function definition...\n",
  );

  // Query pg_proc to get the actual function source
  const { data, error } = await supabase.rpc("execute_sql", {
    query: `
      SELECT 
        p.proname as function_name,
        pg_get_functiondef(p.oid) as definition
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public' 
        AND p.proname = 'allocate_lucky_dip_tickets_batch'
      ORDER BY p.oid DESC
      LIMIT 1;
    `,
  });

  if (error) {
    console.error("Error:", JSON.stringify(error, null, 2));
    return;
  }

  if (data && data.length > 0) {
    console.log("Function definition:");
    console.log(data[0].definition);
  } else {
    console.log("Function not found!");
  }
}

checkFunction().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
