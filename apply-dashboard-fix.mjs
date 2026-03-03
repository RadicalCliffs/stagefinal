import { readFileSync } from "fs";
import pg from "pg";
const { Client } = pg;

const SQL_FILE =
  "c:\\Users\\maxmi\\GitHub\\theprize.io\\supabase\\FIX_DASHBOARD_AND_TX_HASH.sql";

// Use pooler connection which handles DNS better
const client = new Client({
  host: "aws-0-eu-central-1.pooler.supabase.com",
  port: 6543,
  database: "postgres",
  user: "postgres.mthwfldcjvpxjtmrqkqm",
  password: "Shefali143@",
});

try {
  console.log("Connecting to database...");
  await client.connect();

  console.log("Reading SQL file...");
  const sql = readFileSync(SQL_FILE, "utf-8");

  console.log("Executing SQL...\n");
  const result = await client.query(sql);

  console.log("\n✅ SQL executed successfully!");
} catch (error) {
  console.error("❌ Error:", error.message);
  if (error.stack) {
    console.error("Stack:", error.stack);
  }
} finally {
  await client.end();
  process.exit(0);
}
