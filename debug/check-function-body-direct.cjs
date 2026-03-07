const { Pool } = require("pg");

async function checkFunctionBody() {
  const pool = new Pool({
    host: "aws-0-us-west-1.pooler.supabase.com",
    port: 6543,
    database: "postgres",
    user: "postgres",
    password: "iamclaudeandiamafuckingretard",
    ssl: false,
  });

  try {
    const result = await pool.query(`
      SELECT 
        p.proname AS function_name,
        pg_get_functiondef(p.oid) AS full_definition,
        SUBSTRING(pg_get_functiondef(p.oid) FROM 'competitionid' FOR 50) AS competitionid_check
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public'
        AND p.proname = 'allocate_lucky_dip_tickets_batch'
      ORDER BY p.oid DESC
      LIMIT 1;
    `);

    console.log(`\n====== ACTUAL FUNCTION IN PRODUCTION ======\n`);
    if (result.rows.length === 0) {
      console.log("Function NOT FOUND in database!");
    } else {
      const row = result.rows[0];
      console.log(`Function: ${row.function_name}`);
      console.log(
        `\nContains "competitionid"? ${row.competitionid_check ? "YES - OLD CODE!" : "NO - looks good"}`,
      );
      console.log(
        `\nFirst 500 chars of function:\n${row.full_definition.substring(0, 500)}`,
      );
    }
    await pool.end();
  } catch (err) {
    console.error("Error:", err.message);
  }
}

checkFunctionBody();
