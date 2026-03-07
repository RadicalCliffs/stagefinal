const { Pool } = require("pg");

const pool = new Pool({
  connectionString:
    "postgresql://postgres.mthwfldcjvpxjtmrqkqm:iamclaudeandiamafuckingretard@aws-0-us-west-1.pooler.supabase.com:6543/postgres",
  ssl: { rejectUnauthorized: false },
});

async function checkAllFunctions() {
  const client = await pool.connect();

  try {
    console.log("Querying ALL allocate_lucky_dip_tickets_batch functions...\n");

    const result = await client.query(`
      SELECT 
        n.nspname AS schema_name,
        p.proname AS function_name,
        pg_get_function_arguments(p.oid) AS arguments,
        pg_get_functiondef(p.oid) AS definition
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE p.proname = 'allocate_lucky_dip_tickets_batch'
      ORDER BY n.nspname, p.oid;
    `);

    console.log(`Found ${result.rows.length} function(s):\n`);

    result.rows.forEach((row, idx) => {
      console.log(`========== Function ${idx + 1} ==========`);
      console.log(`Schema: ${row.schema_name}`);
      console.log(`Arguments: ${row.arguments}`);

      // Check if definition contains competitionid
      if (row.definition.includes("competitionid")) {
        console.log("⚠️  CONTAINS OLD REFERENCE: competitionid");
        const lines = row.definition.split("\n");
        lines.forEach((line, lineIdx) => {
          if (line.includes("competitionid")) {
            console.log(`  Line ${lineIdx + 1}: ${line.trim()}`);
          }
        });
      } else {
        console.log("✅ Uses competition_id (correct)");
      }
      console.log("\n");
    });
  } finally {
    client.release();
    await pool.end();
  }
}

checkAllFunctions().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
