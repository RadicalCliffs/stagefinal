import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
);

const competitionId = "12cccfb1-df68-4b3e-a168-07dfeaeb06cc";

console.log("\n🔍 Checking ticket #5 columns:\n");

const { data, error } = await supabase
  .from("tickets")
  .select("*")
  .eq("competition_id", competitionId)
  .eq("ticket_number", 5)
  .single();

if (error) {
  console.error("Error:", error);
} else {
  console.log("All columns for ticket #5:");
  console.log(JSON.stringify(data, null, 2));

  console.log("\n\nTransaction-related fields:");
  console.log("  transaction_hash:", data.transaction_hash || "NULL");
  console.log("  payment_tx_hash:", data.payment_tx_hash || "NULL");
  console.log("  tx_id:", data.tx_id || "NULL");
}
