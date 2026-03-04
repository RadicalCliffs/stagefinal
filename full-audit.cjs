const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = "https://mthwfldcjvpxjtmrqkqm.supabase.co";
const serviceKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY";

const supabase = createClient(supabaseUrl, serviceKey);

async function fullAudit() {
  console.log("=== COMPLETE DATABASE AUDIT ===\n");

  // 1. All competition columns
  console.log("1. ALL COMPETITION-RELATED COLUMNS:");
  console.log("-".repeat(60));

  const { data: columns } = await supabase.rpc(
    "check_competition_column_types",
  );
  if (columns) {
    columns.forEach((row) => {
      console.log(
        `  ${row.table_name}.${row.column_name} = ${row.data_type.toUpperCase()}`,
      );
    });
  }

  // 2. All functions with competition parameters
  console.log("\n2. ALL FUNCTIONS TAKING COMPETITION PARAMETERS:");
  console.log("-".repeat(60));

  const createFunc = `
    CREATE OR REPLACE FUNCTION temp_audit_functions()
    RETURNS TABLE(
      func_name text,
      args text,
      return_type text
    )
    LANGUAGE sql
    AS $$
      SELECT 
        p.proname::text,
        pg_get_function_arguments(p.oid)::text,
        pg_get_function_result(p.oid)::text
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public'
        AND (
          pg_get_function_arguments(p.oid) LIKE '%competition%'
          OR p.proname LIKE '%competition%'
        )
      ORDER BY p.proname, p.oid;
    $$;
  `;

  await supabase.rpc("exec_sql", { sql_query: createFunc });
  const { data: functions } = await supabase.rpc("temp_audit_functions");

  if (functions) {
    functions.forEach((row) => {
      console.log(`  ${row.func_name}(${row.args})`);
      console.log(`    → ${row.return_type}`);
    });
  }

  // 3. Check joincompetition table specifically
  console.log("\n3. JOINCOMPETITION TABLE COLUMNS:");
  console.log("-".repeat(60));

  const { data: sample } = await supabase
    .from("joincompetition")
    .select("*")
    .limit(1);

  if (sample && sample.length > 0) {
    const cols = Object.keys(sample[0]);
    const competitionCols = cols.filter((c) =>
      c.toLowerCase().includes("competition"),
    );
    console.log(`  Total columns: ${cols.length}`);
    console.log(`  Competition-related: ${competitionCols.join(", ")}`);
  }

  console.log("\n" + "=".repeat(60));
  console.log("AUDIT COMPLETE");
  console.log("=".repeat(60));
}

fullAudit().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
