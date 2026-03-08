import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
);

const competitionId = "12cccfb1-df68-4b3e-a168-07dfeaeb06cc";
const userWallet = "0x0ff51ec0ecc9ae1e5e6048976ba307c849781363";

console.log(
  "\n🔍 Checking joincompetition table for transaction hash mapping:\n",
);

const { data, error } = await supabase
  .from("join competition")
  .select("*")
  .eq("competitionid", competitionId)
  .order("purchasedate", { ascending: false });

if (error) {
  console.error("Error:", error);
  console.log("\nTrying alternate query...");

  const { data: data2, error: error2 } = await supabase
    .from("joincompetition")
    .select("*")
    .eq("competition_id", competitionId)
    .order("purchase_date", { ascending: false });

  if (error2) {
    console.error("Error 2:", error2);
  } else {
    console.log(`Found ${data2?.length || 0} entries in joincompetition`);
    data2?.forEach((entry) => {
      console.log(`\n  User: ${entry.user_id || entry.canonical_user_id}`);
      console.log(`  Tickets: ${entry.ticket_numbers}`);
      console.log(`  Amount: $${entry.amount_spent}`);
      console.log(`  TX Hash: ${entry.transaction_hash || "NONE"}`);
      console.log(`  Chain: ${entry.chain}`);
      console.log(`  Date: ${entry.purchase_date}`);
    });
  }
}

console.log("\n✅ Check complete");
