import pg from "pg";
import { readFileSync } from "fs";
const { Client } = pg;

const client = new Client({
  host: "aws-1-ap-south-1.pooler.supabase.com",
  port: 5432,
  database: "postgres",
  user: "postgres.mthwfldcjvpxjtmrqkqm",
  password: "LetsF4ckenGo!",
  ssl: { rejectUnauthorized: false },
});

async function deployBonus() {
  console.log("========================================================");
  console.log("DEPLOYING 50% FIRST TOP-UP BONUS TO PRODUCTION");
  console.log("========================================================\n");

  try {
    await client.connect();
    console.log("✅ Connected to production database\n");

    const sql = readFileSync("./DEPLOY_50_PERCENT_BONUS_NOW.sql", "utf-8");

    console.log("Executing SQL...\n");
    const result = await client.query(sql);

    console.log("✅ SQL executed successfully!\n");

    // Verify the function exists
    const verify = await client.query(`
      SELECT 
        p.proname as function_name,
        pg_get_function_arguments(p.oid) as arguments
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public' 
        AND p.proname = 'credit_balance_with_first_deposit_bonus'
    `);

    if (verify.rows.length > 0) {
      console.log("✅ VERIFIED: Function exists in production");
      console.log(`   Function: ${verify.rows[0].function_name}`);
      console.log(`   Arguments: ${verify.rows[0].arguments}\n`);
    }

    console.log("========================================================");
    console.log("✅ 50% BONUS IS NOW LIVE IN PRODUCTION");
    console.log("All top-ups from this point forward will receive +50%");
    console.log("========================================================");
  } catch (error) {
    console.error("❌ ERROR:", error.message);
    throw error;
  } finally {
    await client.end();
  }
}

deployBonus().catch((err) => {
  console.error("DEPLOYMENT FAILED:", err);
  process.exit(1);
});
