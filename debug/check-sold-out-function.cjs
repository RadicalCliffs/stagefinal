const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = "https://mthwfldcjvpxjtmrqkqm.supabase.co";
const serviceKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY";

const supabase = createClient(supabaseUrl, serviceKey);

async function checkFunction() {
  console.log(
    "Checking check_and_mark_competition_sold_out function in production...\n",
  );

  // Create temp function to query
  const createQuery = `
    CREATE OR REPLACE FUNCTION temp_check_sold_out_func()
    RETURNS TABLE(
      func_name text,
      args text,
      return_type text,
      func_body text
    )
    LANGUAGE sql
    AS $$
      SELECT 
        p.proname::text,
        pg_get_function_arguments(p.oid)::text,
        pg_get_function_result(p.oid)::text,
        pg_get_functiondef(p.oid)::text
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public'
        AND p.proname = 'check_and_mark_competition_sold_out'
      ORDER BY p.oid;
    $$;
  `;

  const { error: createError } = await supabase.rpc("exec_sql", {
    sql_query: createQuery,
  });

  if (createError) {
    console.error(
      "Failed to create helper:",
      JSON.stringify(createError, null, 2),
    );
    console.log("\nRun this SQL in Supabase dashboard:\n");
    console.log(
      "SELECT proname, pg_get_function_arguments(oid), pg_get_function_result(oid) FROM pg_proc WHERE proname = 'check_and_mark_competition_sold_out';",
    );
    return;
  }

  const { data, error } = await supabase.rpc("temp_check_sold_out_func");

  if (error) {
    console.error("Query error:", JSON.stringify(error, null, 2));
    return;
  }

  if (!data || data.length === 0) {
    console.log("❌ Function does NOT exist in production database!");
    console.log("\nNeed to create it or fix references to it.");
    return;
  }

  console.log(`Found ${data.length} version(s):\n`);
  data.forEach((row, i) => {
    console.log(`[${i + 1}] ${row.func_name}(${row.args})`);
    console.log(`    Returns: ${row.return_type}`);
    console.log("");
  });
}

checkFunction().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
