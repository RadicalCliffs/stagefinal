import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY",
);

console.log("=== APPLYING CRITICAL FIX: ticket_numbers field ===\n");

const sql = readFileSync("supabase/HOTFIX_RPC_IS_PENDING.sql", "utf-8");

console.log("📄 SQL length:", sql.length, "characters");
console.log("🔄 Executing SQL via Supabase...\n");

try {
  // Execute raw SQL using Supabase postgREST
  const { data, error } = await supabase.rpc("exec_sql", {
    sql_query: sql,
  });

  if (error) {
    console.error("❌ Error executing SQL:", error);
    process.exit(1);
  }

  console.log("✅ SQL executed successfully!\n");

  console.log("=== TESTING RPC ===\n");

  const { data: entries, error: rpcError } = await supabase.rpc(
    "get_user_competition_entries",
    {
      p_user_identifier: "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363",
    },
  );

  if (rpcError) {
    console.error("❌ RPC still failing:", rpcError.message);
    process.exit(1);
  }

  console.log(`✅ RPC works! Found ${entries.length} entries\n`);

  if (entries.length > 0) {
    const ethEntry = entries.find((e) => e.competition_title?.includes("ETH"));
    if (ethEntry) {
      console.log("📊 Win 10 ETH Entry:");
      console.log("  Tickets:", ethEntry.tickets_count);
      console.log("  Amount Spent:", `$${ethEntry.amount_spent || 0}`);
      console.log(
        "  Ticket Numbers:",
        ethEntry.ticket_numbers?.split(",").slice(0, 5).join(", ") + "...",
      );
      console.log("  Status:", ethEntry.entry_status);
    }
  }

  console.log(
    "\n✅ DASHBOARD FIXED - Refresh https://stage.theprize.io/dashboard/entries",
  );
} catch (error) {
  console.error("❌ Error:", error.message);
  console.error(error);
  process.exit(1);
}
