import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

async function verify() {
  console.log("🔍 Verifying per-user hash fixes...\n");

  // Get all tickets with balance payment
  const { data: tickets } = await supabase
    .from("tickets")
    .select("canonical_user_id, tx_id, created_at, payment_provider")
    .eq("payment_provider", "balance")
    .order("created_at", { ascending: false })
    .limit(10000);

  console.log(`Found ${tickets.length} balance-paid tickets\n`);

  // Group by user
  const userMap = {};
  for (const ticket of tickets) {
    const userId = ticket.canonical_user_id;
    if (!userMap[userId]) {
      userMap[userId] = { tickets: [], unique_hashes: new Set() };
    }
    userMap[userId].tickets.push(ticket);
    if (
      ticket.tx_id &&
      ticket.tx_id.startsWith("0x") &&
      ticket.tx_id.length === 66
    ) {
      userMap[userId].unique_hashes.add(ticket.tx_id);
    }
  }

  const users = Object.keys(userMap);
  console.log(`${users.length} unique users\n`);

  for (const userId of users) {
    const { tickets: userTickets, unique_hashes } = userMap[userId];
    const shortId = userId.substring(0, 40) + "...";

    console.log(`User: ${shortId}`);
    console.log(`  Tickets: ${userTickets.length}`);
    console.log(`  Unique blockchain hashes: ${unique_hashes.size}`);

    if (unique_hashes.size > 0) {
      console.log(`  Hashes:`);
      for (const hash of unique_hashes) {
        const count = userTickets.filter((t) => t.tx_id === hash).length;
        console.log(`    ${hash.substring(0, 20)}... (${count} tickets)`);
      }
    }
    console.log("");
  }

  console.log("\n✅ Verification complete");
}

verify().catch(console.error);
