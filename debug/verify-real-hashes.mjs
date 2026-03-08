import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
);

async function verifyHashes() {
  console.log(
    "🔍 Verifying the most common hashes are real blockchain TXs...\n",
  );

  const hashesToCheck = [
    "0xac1dfe66d18919a043",
    "0x95e380db63e9f3e20b",
    "0x3f3ab67ec61f04ef5f",
  ];

  for (const hashPrefix of hashesToCheck) {
    // Get a ticket with this hash
    const { data: ticket } = await supabase
      .from("tickets")
      .select("tx_id")
      .ilike("tx_id", `${hashPrefix}%`)
      .limit(1)
      .single();

    if (ticket && ticket.tx_id) {
      console.log(`Hash: ${ticket.tx_id}`);
      console.log(`BaseScan: https://basescan.org/tx/${ticket.tx_id}`);
      console.log("");
    }
  }

  console.log(
    "✅ Verify these links work in your browser - they should show real on-chain transactions",
  );
}

verifyHashes().catch(console.error);
