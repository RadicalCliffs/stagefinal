import pg from "pg";
const { Client } = pg;

const client = new Client({
  host: "aws-1-ap-south-1.pooler.supabase.com",
  port: 5432,
  database: "postgres",
  user: "postgres.mthwfldcjvpxjtmrqkqm",
  password: "LetsF4ckenGo!",
  ssl: { rejectUnauthorized: false },
});

async function checkFunction() {
  await client.connect();

  console.log(
    "=== CHECKING PRODUCTION credit_balance_with_first_deposit_bonus ===\n",
  );

  // Get the actual function source
  const result = await client.query(`
    SELECT 
      pg_get_functiondef(p.oid) as definition
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' 
      AND p.proname = 'credit_balance_with_first_deposit_bonus'
  `);

  if (result.rows.length > 0) {
    console.log("✅ Function exists in production\n");
    console.log("Current definition:");
    console.log("=".repeat(80));
    console.log(result.rows[0].definition);
    console.log("=".repeat(80));
  } else {
    console.log("❌ Function does NOT exist in production!");
  }

  await client.end();
}

checkFunction().catch(console.error);
