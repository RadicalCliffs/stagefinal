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
console.log("APPLYING 50% FIRST TOPUP BONUS");
console.log("========================================================\n");

try {
  await client.connect();
  console.log("✅ Connected to production database\n");

  const sql = readFileSync("./APPLY_50_BONUS_ONCE.sql", "utf-8");

  console.log("📄 Executing APPLY_50_BONUS_ONCE.sql...\n");

  const result = await client.query(sql);

  console.log("\n✅ SQL EXECUTED SUCCESSFULLY!\n");
  console.log("Rows affected:", result.rowCount);

  if (result.rows && result.rows.length > 0) {
    console.log("Result data:", result.rows);
  }

  console.log("\n========================================================");
  console.log("✅ 50% BONUS APPLIED TO FIRST TOPUP!");
  console.log("User will never get this bonus again");
  console.log("========================================================\n");
} catch (error) {
  console.error("\n❌ ERROR:", error.message);
  console.error("Error details:", error);
  process.exit(1);
} finally {
  await client.end();
  console.log("Connection closed.");
}
