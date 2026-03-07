import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";
const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Use pooler connection
const client = new Client({
  host: "aws-0-eu-central-1.pooler.supabase.com",
  port: 6543,
  database: "postgres",
  user: "postgres.mthwfldcjvpxjtmrqkqm",
  password: "Shefali143@",
});

async function applyHotfix() {
  console.log("============================================================");
  console.log("APPLYING RPC HOTFIX - Removing ce.is_pending reference");
  console.log("============================================================\n");

  try {
    console.log("Connecting to database...");
    await client.connect();

    const sqlFile = join(__dirname, "supabase", "HOTFIX_RPC_IS_PENDING.sql");
    const sql = readFileSync(sqlFile, "utf-8");

    console.log("📄 SQL file:", sqlFile);
    console.log("📝 SQL length:", sql.length, "characters\n");

    console.log("🔄 Executing SQL...\n");

    const result = await client.query(sql);

    console.log("✅ Hotfix applied successfully!");
    if (result.rows && result.rows.length > 0) {
      console.log("Result:", result.rows);
    }

    console.log(
      "\n============================================================",
    );
    console.log("TESTING RPC FUNCTION");
    console.log(
      "============================================================\n",
    );

    const testUserId = "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363";

    const { rows: entries } = await client.query(
      `SELECT * FROM get_user_competition_entries($1)`,
      [testUserId],
    );

    console.log("✅ RPC executing successfully!");
    console.log(`Found ${entries.length} entries\n`);

    if (entries.length > 0) {
      const winEthEntry = entries.find(
        (e) =>
          e.competition_title?.toLowerCase().includes("win") &&
          e.competition_title?.toLowerCase().includes("eth"),
      );

      if (winEthEntry) {
        console.log("📊 Win 10 ETH Entry:");
        console.log("  Competition ID:", winEthEntry.competition_id);
        console.log("  Tickets Count:", winEthEntry.tickets_count);
        console.log("  Amount Spent:", `$${winEthEntry.amount_spent || 0}`);
        console.log("  Entry Status:", winEthEntry.entry_status);
        console.log(
          "  Ticket Numbers (CSV):",
          winEthEntry.ticket_numbers_csv?.split(",").slice(0, 5).join(", ") +
            "...",
        );
      } else {
        console.log("First entry:", entries[0]);
      }
    }

    console.log(
      "\n============================================================",
    );
    console.log("✅ HOTFIX COMPLETE - Dashboard should now work!");
    console.log("Refresh https://stage.theprize.io/dashboard/entries");
    console.log("============================================================");
  } catch (error) {
    console.error("❌ Error:", error.message);
    if (error.stack) {
      console.error("Stack:", error.stack);
    }
  } finally {
    await client.end();
    process.exit(0);
  }
}

applyHotfix();
