import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
);

const competitionId = "12cccfb1-df68-4b3e-a168-07dfeaeb06cc";

console.log("\n🔍 Mapping tickets to topup transaction hashes:\n");

// Get all tickets for this competition
const { data: tickets, error: ticketError } = await supabase
  .from("tickets")
  .select(
    "ticket_number, canonical_user_id, wallet_address, tx_id, transaction_hash, purchase_date, created_at",
  )
  .eq("competition_id", competitionId)
  .order("ticket_number");

if (ticketError) {
  console.error("Ticket Error:", ticketError);
  process.exit(1);
}

console.log(`Found ${tickets.length} tickets\n`);

// Group tickets by user
const ticketsByUser = {};
tickets.forEach((t) => {
  const user = t.canonical_user_id || t.wallet_address;
  if (!ticketsByUser[user]) ticketsByUser[user] = [];
  ticketsByUser[user].push(t);
});

console.log(`Users with tickets: ${Object.keys(ticketsByUser).length}\n`);

// For each user, find their topup transactions
for (const [user, userTickets] of Object.entries(ticketsByUser)) {
  console.log(`\n📍 User: ${user}`);
  console.log(
    `   Tickets: ${userTickets.length} (${userTickets.map((t) => t.ticket_number).join(", ")})`,
  );
  console.log(
    `   First purchase: ${userTickets[0].purchase_date || userTickets[0].created_at}`,
  );

  // Find topup transactions for this user (before their purchases)
  const purchaseDate = new Date(
    userTickets[0].purchase_date || userTickets[0].created_at,
  );

  const { data: topups, error: topupError } = await supabase
    .from("user_transactions")
    .select("*")
    .eq("type", "topup")
    .or(
      `canonical_user_id.eq.${user},wallet_address.eq.${user.replace("prize:pid:", "")}`,
    )
    .not("tx_id", "is", null)
    .lte("created_at", purchaseDate.toISOString())
    .order("created_at", { ascending: false })
    .limit(5);

  if (topupError) {
    console.error(`   Topup Error:`, topupError);
  } else if (topups && topups.length > 0) {
    console.log(`\n   ✅ Found ${topups.length} topup(s) before purchase:`);
    topups.forEach((topup) => {
      console.log(`\n      Hash: ${topup.tx_id}`);
      console.log(`      Amount: $${topup.amount}`);
      console.log(`      Date: ${topup.created_at}`);
      console.log(`      Provider: ${topup.payment_provider}`);
    });

    const correctHash = topups[0].tx_id; // Most recent topup before purchase
    const currentHash = userTickets[0].tx_id;

    if (currentHash !== correctHash) {
      console.log(`\n   ⚠️  MISMATCH!`);
      console.log(`      Current: ${currentHash}`);
      console.log(`      Should be: ${correctHash}`);
      console.log(`\n      UPDATE command:`);
      console.log(
        `      UPDATE tickets SET tx_id = '${correctHash}', transaction_hash = '${correctHash}'`,
      );
      console.log(
        `      WHERE competition_id = '${competitionId}' AND canonical_user_id = '${user}';`,
      );
    } else {
      console.log(`\n   ✅ Hash already correct!`);
    }
  } else {
    console.log(`\n   ❌ No topup transactions found before purchase`);
    console.log(`      Searching for ANY topup with tx_id...`);

    const { data: anyTopups } = await supabase
      .from("user_transactions")
      .select("*")
      .eq("type", "topup")
      .or(
        `canonical_user_id.eq.${user},wallet_address.eq.${user.replace("prize:pid:", "")}`,
      )
      .not("tx_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(5);

    if (anyTopups && anyTopups.length > 0) {
      console.log(`\n   Found ${anyTopups.length} topup(s) at any time:`);
      anyTopups.forEach((topup) => {
        console.log(`\n      Hash: ${topup.tx_id}`);
        console.log(`      Amount: $${topup.amount}`);
        console.log(
          `      Date: ${topup.created_at} ${topup.created_at > purchaseDate.toISOString() ? "(AFTER purchase!)" : ""}`,
        );
      });
    }
  }
}

console.log("\n\n✅ Analysis complete");
