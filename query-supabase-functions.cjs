const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY",
);

async function listAllLuckyFunctions() {
  console.log("Connecting to Supabase...");

  try {
    const { Pool } = require("pg");
    console.log("Creating pool...");

    const pool = new Pool({
      host: "aws-0-us-west-1.pooler.supabase.com",
      port: 6543,
      user: "postgres.mthwfldcjvpxjtmrqkqm",
      password: "iamclaudeandiamafuckingretard",
      database: "postgres",
      ssl: { rejectUnauthorized: false },
    });

    console.log("Executing query...");

    const result = await pool.query(`
      SELECT 
        p.proname AS function_name,
        pg_get_function_arguments(p.oid) AS arguments,
        pg_get_function_identity_arguments(p.oid) AS identity_args,
        p.oid
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public'
        AND p.proname ILIKE '%lucky%'
      ORDER BY p.proname, p.oid;
    `);

    console.log("\n=== LUCKY DIP FUNCTIONS IN PRODUCTION ===\n");
    result.rows.forEach((row, idx) => {
      console.log(`${idx + 1}. ${row.function_name}(${row.arguments})`);
      console.log(`   Identity: ${row.identity_args}`);
      console.log(`   OID: ${row.oid}\n`);
    });

    console.log(`Total functions found: ${result.rows.length}\n`);

    await pool.end();
    console.log("Done.");
  } catch (err) {
    console.error("Error:", err.message);
    console.error("Stack:", err.stack);
  }
}

listAllLuckyFunctions().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
