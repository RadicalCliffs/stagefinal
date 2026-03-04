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
console.log("FIXING COMPETITIONS WITHOUT VRF SEED");
console.log("========================================================\n");

try {
  await client.connect();
  console.log("✅ Connected to production database\n");

  const sql = readFileSync("./FIX_COMPETITIONS_NO_VRF_SEED.sql", "utf-8");

  console.log("📄 Generating VRF seeds and selecting winners...\n");

  const result = await client.query(sql);

  console.log("\n✅ SQL EXECUTED SUCCESSFULLY!\n");

  console.log("========================================================");
  console.log("✅ COMPETITIONS FIXED!");
  console.log("VRF seeds generated and winners selected for:");
  console.log("  - $1000 and any other competitions without VRF seed");
  console.log("Updated:");
  console.log("  - competitions table (status = completed, VRF seed added)");
  console.log("  - winners table (frontend will see it)");
  console.log("  - competition_winners table (historical record)");
  console.log("  - joincompetition (is_winner = true)");
  console.log("========================================================\n");
} catch (error) {
  console.error("\n❌ ERROR:", error.message);
  console.error("Error details:", error);
  process.exit(1);
} finally {
  await client.end();
  console.log("Connection closed.");
}
