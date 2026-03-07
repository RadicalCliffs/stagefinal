const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = "https://mthwfldcjvpxjtmrqkqm.supabase.co";
const serviceKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY";

const supabase = createClient(supabaseUrl, serviceKey);

async function listOverloads() {
  console.log("Creating temporary function to query pg_proc...\n");

  // First create the query function
  const createFunc = `
CREATE OR REPLACE FUNCTION temp_list_overloads()
RETURNS TABLE(
  func_name text,
  args text,
  result_type text
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT 
    p.proname::text,
    pg_get_function_arguments(p.oid)::text,
    pg_get_function_result(p.oid)::text
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.proname IN ('reserve_lucky_dip', 'allocate_lucky_dip_tickets_batch')
  ORDER BY p.proname, p.oid;
$$;

GRANT EXECUTE ON FUNCTION temp_list_overloads() TO service_role;
  `;

  const { data: createData, error: createError } = await supabase.rpc(
    "exec_sql",
    {
      sql_query: createFunc,
    },
  );

  if (createError) {
    console.error(
      "Failed to create function:",
      JSON.stringify(createError, null, 2),
    );
    console.log("\nTrying direct approach...");

    // Just print the SQL to run manually
    console.log("\nRun this in Supabase SQL Editor:");
    console.log("=".repeat(60));
    console.log(`
SELECT 
  p.proname as function_name,
  COUNT(*) OVER (PARTITION BY p.proname) as version_count,
  pg_get_function_arguments(p.oid) as arguments,
  format('DROP FUNCTION IF EXISTS %I.%I(%s);', 
    n.nspname, 
    p.proname, 
    pg_get_function_identity_arguments(p.oid)) as drop_statement
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname IN ('reserve_lucky_dip', 'allocate_lucky_dip_tickets_batch')
ORDER BY p.proname, p.oid;
    `);
    console.log("=".repeat(60));
    return;
  }

  console.log("Created temp function, now calling it...");

  const { data, error } = await supabase.rpc("temp_list_overloads");

  if (error) {
    console.error("Error calling function:", JSON.stringify(error, null, 2));
    return;
  }

  console.log("\nFunction overloads found in production:\n");

  const grouped = {};
  data.forEach((row) => {
    if (!grouped[row.func_name]) {
      grouped[row.func_name] = [];
    }
    grouped[row.func_name].push(row);
  });

  Object.keys(grouped).forEach((fname) => {
    console.log(`${fname}: ${grouped[fname].length} version(s)`);
    grouped[fname].forEach((row, i) => {
      console.log(`  [${i + 1}] Arguments: ${row.args}`);
      console.log(`      Returns: ${row.result_type}`);
    });
    console.log("");
  });

  // Now generate DROP statements
  if (Object.keys(grouped).some((k) => grouped[k].length > 1)) {
    console.log("\n=== MIGRATION TO FIX OVERLOADS ===\n");
    console.log(
      "-- Drop all versions and let next migration recreate the correct one\n",
    );
    Object.keys(grouped).forEach((fname) => {
      if (grouped[fname].length > 1) {
        console.log(`-- ${fname} has ${grouped[fname].length} versions`);
        console.log(
          `DROP FUNCTION IF EXISTS public.${fname}(TEXT, TEXT, UUID, INTEGER, INTEGER);`,
        );
        console.log(
          `DROP FUNCTION IF EXISTS public.${fname}(UUID, TEXT, TEXT, INTEGER, INTEGER);`,
        );
        console.log(
          `DROP FUNCTION IF EXISTS public.${fname}(TEXT, UUID, INTEGER, NUMERIC, INTEGER, TEXT, INTEGER[]);`,
        );
        console.log("");
      }
    });
  }
}

listOverloads().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
