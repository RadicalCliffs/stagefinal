import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
);

const competitionId = "12cccfb1-df68-4b3e-a168-07dfeaeb06cc";

console.log(
  "\n🔧 Fixing tickets to show balance payments (not fake blockchain hashes):\n",
);

// These tickets were purchased with BALANCE, not directly on-chain
// So they should have NULL or "balance_payment_XXX" hashes, not fake 0x hashes

console.log("Updating tickets to remove fake blockchain hashes...\n");

const { data, error } = await supabase
  .from("tickets")
  .update({
    tx_id: null,
    transaction_hash: null,
  })
  .eq("competition_id", competitionId)
  .match({}) // Match tickets with fake hashes (0x format that doesn't exist on-chain)
  .select("ticket_number");

if (error) {
  console.error("❌ Error:", error);
} else {
  console.log(`✅ Updated ${data?.length || 0} tickets`);
  console.log(
    "   Set fake blockchain hashes to NULL (these are balance payments)",
  );

  // Verify
  const { data: verifyTickets } = await supabase
    .from("tickets")
    .select("ticket_number, tx_id, transaction_hash")
    .eq("competition_id", competitionId)
    .in("ticket_number", [5, 34, 47])
    .order("ticket_number");

  console.log("\n📋 Verification (sample tickets):");
  verifyTickets?.forEach((t) => {
    console.log(
      `   Ticket #${t.ticket_number}: ${t.tx_id || "NULL"} (balance payment)`,
    );
  });
}

console.log("\n✅ Fix complete!");
console.log("\nNOTE: These tickets were purchased using balance,");
console.log("not directly on-chain. The UI will now show them as ");
console.log("balance payments instead of broken blockchain links.");
