import { readFileSync } from "fs";
import pg from "pg";
const { Client } = pg;

const client = new Client({
  host: "aws-0-ap-south-1.pooler.supabase.com",
  port: 5432,
  database: "postgres",
  user: "postgres.mthwfldcjvpxjtmrqkqm",
  password: "Shefali143@",
});

console.log("=== APPLYING HOTFIX TO SUPABASE ===\n");

try {
  console.log("Connecting to database...");
  await client.connect();

  const sql = readFileSync("supabase/HOTFIX_RPC_IS_PENDING.sql", "utf-8");

  console.log("📄 SQL length:", sql.length, "characters");
  console.log("🔄 Executing SQL...\n");

  const result = await client.query(sql);

  console.log("✅ Hotfix applied successfully!\n");

  console.log("=== TESTING RPC ===\n");

  const { rows: entries } = await client.query(
    `SELECT * FROM get_user_competition_entries($1)`,
    ["prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363"],
  );

  console.log(`✅ RPC works! Found ${entries.length} entries`);

  if (entries.length > 0) {
    const ethEntry = entries.find((e) =>
      e.competition_title?.toLowerCase().includes("eth"),
    );

    if (ethEntry) {
      console.log("\n📊 Win 10 ETH Entry:");
      console.log("  Competition ID:", ethEntry.competition_id);
      console.log("  Tickets:", ethEntry.tickets_count);
      console.log("  Amount Spent:", `$${ethEntry.amount_spent || 0}`);
      console.log("  Entry Status:", ethEntry.entry_status);
    }
  }

  console.log("\n============================================================");
  console.log("✅ DASHBOARD FIXED!");
  console.log("Refresh: https://stage.theprize.io/dashboard/entries");
  console.log("============================================================");
} catch (error) {
  console.error("❌ Error:", error.message);
  console.error("\nFull error:", error);
} finally {
  await client.end();
}
