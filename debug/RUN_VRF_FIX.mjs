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
console.log("FIXING ALL STUCK VRF COMPETITIONS");
console.log("========================================================\n");

try {
  await client.connect();
  console.log("✅ Connected to production database\n");

  const sql = readFileSync("./FIX_ALL_STUCK_VRF_COMPETITIONS.sql", "utf-8");

  console.log("📄 Executing SQL to complete all stuck competitions...\n");

  const result = await client.query(sql);

  console.log("\n✅ SQL EXECUTED SUCCESSFULLY!\n");

  console.log("========================================================");
  console.log("✅ ALL COMPETITIONS FIXED!");
  console.log("Winners have been selected and inserted into:");
  console.log("  - competitions table (status = completed)");
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
