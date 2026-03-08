import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
);

async function analyzeUsers() {
  console.log("🔍 Analyzing users with March 4 tickets...\n");

  // Get sample of tickets
  const { data: tickets } = await supabase
    .from("tickets")
    .select("ticket_number, canonical_user_id, tx_id, created_at")
    .gte("created_at", "2026-03-04T00:00:00")
    .lte("created_at", "2026-03-04T23:59:59")
    .limit(1000);

  // Group by user
  const ticketsByUser = {};
  tickets
    .filter((t) => t.tx_id?.startsWith("0x"))
    .forEach((ticket) => {
      if (!ticketsByUser[ticket.canonical_user_id]) {
        ticketsByUser[ticket.canonical_user_id] = [];
      }
      ticketsByUser[ticket.canonical_user_id].push(ticket);
    });

  console.log(`👥 Sample: ${Object.keys(ticketsByUser).length} users\n`);

  // For each user, check their purchase history
  for (const [userId, userTickets] of Object.entries(ticketsByUser)) {
    console.log(`\n👤 User: ${userId.substring(0, 50)}...`);
    console.log(`   ${userTickets.length} tickets with fake hashes`);
    console.log(`   Sample hash: ${userTickets[0].tx_id.substring(0, 20)}...`);

    // Check their ticket purchase transaction (the actual purchase, not topup)
    const { data: purchase } = await supabase
      .from("user_transactions")
      .select("*")
      .eq("canonical_user_id", userId)
      .eq("type", "ticket_purchase")
      .gte("created_at", "2026-03-03")
      .lte("created_at", "2026-03-05")
      .limit(5);

    if (purchase && purchase.length > 0) {
      console.log(`   💳 ${purchase.length} ticket purchases:`);
      purchase.forEach((p) => {
        console.log(
          `      tx_id: ${p.tx_id?.substring(0, 30) || "null"}, payment_provider: ${p.payment_provider}, amount: $${p.amount}`,
        );
      });
    }

    // Check topups
    const { data: topups } = await supabase
      .from("user_transactions")
      .select("tx_id, amount, created_at, payment_provider")
      .eq("canonical_user_id", userId)
      .eq("type", "topup")
      .gte("created_at", "2026-02-01")
      .lte("created_at", "2026-03-05")
      .order("created_at", { ascending: false })
      .limit(3);

    if (topups && topups.length > 0) {
      console.log(`   💰 Recent topups:`);
      topups.forEach((t) => {
        console.log(
          `      ${t.created_at.substring(0, 10)}: $${t.amount}, provider: ${t.payment_provider}, tx: ${t.tx_id?.substring(0, 30) || "null"}`,
        );
      });
    } else {
      console.log(`   ⚠️ No topups found`);
    }
  }
}

analyzeUsers().catch(console.error);
