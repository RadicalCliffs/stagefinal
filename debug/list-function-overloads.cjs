const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = "https://mthwfldcjvpxjtmrqkqm.supabase.co";
const serviceKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY";

const supabase = createClient(supabaseUrl, serviceKey);

async function listFunctionOverloads() {
  console.log(
    "Querying production database for all function versions with overloading...\n",
  );

  // Create a temporary RPC to query pg_proc
  const createQuery = `
    CREATE OR REPLACE FUNCTION list_function_overloads()
    RETURNS TABLE(
      function_name text,
      argument_types text,
      return_type text,
      drop_statement text
    )
    LANGUAGE sql
    AS $$
      SELECT 
        p.proname::text as function_name,
        pg_get_function_arguments(p.oid)::text as argument_types,
        pg_get_function_result(p.oid)::text as return_type,
        format('DROP FUNCTION IF EXISTS %I.%I(%s);', 
          n.nspname, 
          p.proname, 
          pg_get_function_identity_arguments(p.oid))::text as drop_statement
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public'
        AND p.proname IN ('reserve_lucky_dip', 'allocate_lucky_dip_tickets_batch', 'get_unavailable_tickets', 'check_and_mark_competition_sold_out')
      ORDER BY p.proname, p.oid;
    $$;
  `;

  const { error: createError } = await supabase.rpc("exec_sql", {
    sql_query: createQuery,
  });

  if (createError) {
    console.error(
      "Failed to create helper function:",
      JSON.stringify(createError, null, 2),
    );
    return;
  }

  const { data, error } = await supabase.rpc("list_function_overloads");

  if (error) {
    console.error("Error:", JSON.stringify(error, null, 2));
    return;
  }

  console.log("Functions in production database:\n");

  const grouped = {};
  data.forEach((row) => {
    if (!grouped[row.function_name]) {
      grouped[row.function_name] = [];
    }
    grouped[row.function_name].push(row);
  });

  Object.keys(grouped).forEach((fname) => {
    console.log(`\n${fname}: ${grouped[fname].length} version(s)`);
    grouped[fname].forEach((row, i) => {
      console.log(`  [${i + 1}] ${row.argument_types}`);
      console.log(`      Returns: ${row.return_type}`);
      console.log(`      Drop: ${row.drop_statement}`);
    });
  });

  console.log("\n\n=== DROP STATEMENTS FOR DUPLICATES ===\n");
  Object.keys(grouped).forEach((fname) => {
    if (grouped[fname].length > 1) {
      console.log(
        `-- ${fname} has ${grouped[fname].length} versions - keep the last one, drop others:`,
      );
      for (let i = 0; i < grouped[fname].length - 1; i++) {
        console.log(grouped[fname][i].drop_statement);
      }
      console.log("");
    }
  });
}

listFunctionOverloads().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
