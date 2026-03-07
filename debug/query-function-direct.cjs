const { Pool } = require("pg");

const pool = new Pool({
  connectionString:
    "postgresql://postgres.mthwfldcjvpxjtmrqkqm:iamclaudeandiamafuckingretard@aws-0-us-west-1.pooler.supabase.com:6543/postgres",
  ssl: { rejectUnauthorized: false },
});

async function checkFunctionBody() {
  const client = await pool.connect();

  try {
    console.log("Querying actual function definition from production...\n");

    // Get function source code
    const result = await client.query(`
      SELECT pg_get_functiondef(p.oid) AS definition
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public'
        AND p.proname = 'allocate_lucky_dip_tickets_batch'
      ORDER BY p.oid DESC
      LIMIT 1;
    `);

    if (result.rows.length === 0) {
      console.log("❌ Function not found in production!");
    } else {
      const funcDef = result.rows[0].definition;

      // Check for competitionid references
      if (funcDef.includes("competitionid")) {
        console.log("⚠️  FUNCTION STILL USES competitionid!\n");

        // Find all occurrences
        const lines = funcDef.split("\n");
        lines.forEach((line, idx) => {
          if (line.toLowerCase().includes("competitionid")) {
            console.log(`Line ${idx + 1}: ${line.trim()}`);
          }
        });
      } else {
        console.log("✅ Function uses competition_id (correct)");
      }

      // Save to file for inspection
      const fs = require("fs");
      fs.writeFileSync("allocate_function_ACTUAL.sql", funcDef);
      console.log("\nFull function saved to: allocate_function_ACTUAL.sql");
    }
  } finally {
    client.release();
    await pool.end();
  }
}

checkFunctionBody().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
