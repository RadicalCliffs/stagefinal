import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
);

const competitionId = "12cccfb1-df68-4b3e-a168-07dfeaeb06cc";

console.log(
  "\n🔧 Fixing ticket transaction hashes to link to topup charges:\n",
);

// User 1: Most tickets - link to Coinbase topup
const user1 = "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363";
const user1Hash = "48d09850-8462-43e8-91e7-6eeee1bedc35";

console.log(`Updating ${user1}...`);
const { data: update1, error: error1 } = await supabase
  .from("tickets")
  .update({
    tx_id: user1Hash,
    transaction_hash: user1Hash,
  })
  .eq("competition_id", competitionId)
  .eq("canonical_user_id", user1);

if (error1) {
  console.error("❌ Error updating user 1:", error1);
} else {
  console.log(`✅ Updated user 1 tickets`);
}

// User 2: Fewer tickets - link to Coinbase topup
const user2 = "prize:pid:0x543e8fb59312a2578f70152c79eae169e4f8fe9e";
const user2Hash = "0df3c4ce-f09c-46b9-9df9-c43980250a25";

console.log(`\nUpdating ${user2}...`);
const { data: update2, error: error2 } = await supabase
  .from("tickets")
  .update({
    tx_id: user2Hash,
    transaction_hash: user2Hash,
  })
  .eq("competition_id", competitionId)
  .eq("canonical_user_id", user2);

if (error2) {
  console.error("❌ Error updating user 2:", error2);
} else {
  console.log(`✅ Updated user 2 tickets`);
}

// Verify the changes
console.log("\n\n🔍 Verifying updates:\n");

const { data: verifyTickets, error: verifyError } = await supabase
  .from("tickets")
  .select("ticket_number, canonical_user_id, tx_id, transaction_hash")
  .eq("competition_id", competitionId)
  .in("ticket_number", [5, 34, 47])
  .order("ticket_number");

if (verifyError) {
  console.error("Verify error:", verifyError);
} else {
  verifyTickets.forEach((t) => {
    console.log(`Ticket #${t.ticket_number}: ${t.tx_id}`);
  });
}

console.log(
  "\n✅ Fix complete! Tickets now link to Coinbase Commerce charge IDs",
);
