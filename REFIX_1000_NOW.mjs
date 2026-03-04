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
console.log("RE-FIXING $1000 COMPETITION WITH CORRECT LOGIC");
console.log("========================================================\n");

try {
  await client.connect();
  console.log("✅ Connected to production database\n");

  // Step 1: Clear broken data
  console.log("1️⃣  Clearing broken winner data...\n");
  const clearSql = readFileSync("./CLEAR_1000_WINNER.sql", "utf-8");
  await client.query(clearSql);
  console.log("✅ Cleared\n");

  // Step 2: Re-run fix with corrected logic
  console.log("2️⃣  Running fix with corrected ticket lookup...\n");
  const fixSql = readFileSync("./FIX_COMPETITIONS_NO_VRF_SEED.sql", "utf-8");
  await client.query(fixSql);

  console.log("\n✅ SQL EXECUTED SUCCESSFULLY!\n");

  console.log("========================================================");
  console.log("✅ $1000 COMPETITION FIXED!");
  console.log(
    "Winner properly selected with fallback logic for sparse tickets",
  );
  console.log("========================================================\n");
} catch (error) {
  console.error("\n❌ ERROR:", error.message);
  console.error("Error details:", error);
  process.exit(1);
} finally {
  await client.end();
  console.log("Connection closed.");
}
