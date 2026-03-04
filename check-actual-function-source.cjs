const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY",
);

async function checkFunctionSource() {
  const { Pool } = require("pg");
  const pool = new Pool({
    host: "aws-0-us-west-1.pooler.supabase.com",
    port: 6543,
    database: "postgres",
    user: "postgres.mthwfldcjvpxjtmrqkqm",
    password: "iamclaudeandiamafuckingretard",
    ssl: { rejectUnauthorized: false },
  });

  try {
    const result = await pool.query(`
      SELECT pg_get_functiondef(oid) as source
      FROM pg_proc 
      WHERE proname = 'allocate_lucky_dip_tickets_batch'
      LIMIT 1;
    `);

    console.log("=== ACTUAL FUNCTION SOURCE IN POSTGRES ===\n");
    console.log(result.rows[0]?.source || "NOT FOUND");
  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    await pool.end();
  }
}

checkFunctionSource();
