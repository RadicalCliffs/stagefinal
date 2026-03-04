import pg from "pg";
import { readFileSync } from "fs";
const { Client } = pg;

const client = new Client({
  host: "aws-1-ap-south-1.pooler.supabase.com",
  port: 5432,
  database: "postgres",
  user: "postgres.mthwfldcjvpxjtmrqkqm",
  password: "iamclaudeandiamafuckingretard",
  ssl: { rejectUnauthorized: false },
});

console.log("========================================================");
console.log("DEPLOYING 50% BONUS + RESETTING ALL USERS");
console.log("========================================================\n");

try {
  await client.connect();
  console.log("✅ Connected to production database\n");

  // Step 1: Deploy the 50% bonus function
  console.log("📄 Step 1: Deploying 50% bonus function...\n");
  const bonusSql = readFileSync("./DEPLOY_50_PERCENT_BONUS_NOW.sql", "utf-8");
  await client.query(bonusSql);
  console.log("✅ 50% bonus function deployed!\n");

  // Step 2: Reset all users to receive bonus
  console.log("📄 Step 2: Resetting all users for bonus eligibility...\n");
  const resetSql = readFileSync("./RESET_ALL_USERS_FOR_BONUS.sql", "utf-8");
  await client.query(resetSql);
  console.log("✅ All users reset!\n");

  console.log("========================================================");
  console.log("✅ COMPLETE!");
  console.log("- 50% bonus function is LIVE");
  console.log("- ALL users will get 50% on their NEXT topup");
  console.log("- 5 second success message already deployed");
  console.log("========================================================\n");
} catch (error) {
  console.error("\n❌ ERROR:", error.message);
  console.error("Error details:", error);
  process.exit(1);
} finally {
  await client.end();
  console.log("Connection closed.");
}
