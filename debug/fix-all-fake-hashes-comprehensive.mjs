import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
);

// Known real hashes to exclude
const KNOWN_REAL_HASHES = [
  "0x7542cd73a56e95732724291fb336549231fc596f47531fec67b746abe8d76854",
  "0x271a504c9639c98e520bdd181a03370609313993e830d4f547ae1a68c61b768b",
  "0xaadebf880a647478484a63ab05226787f8ec6eafc627daf897b17e4b3c2aebfb",
];

async function updateAllFakeHashesComprehensive() {
  console.log("🔍 Finding ALL tickets with fake hashes...\n");

  // Get all tickets from Feb-Mar with 0x hashes
  let allFakeTickets = [];
  const startDate = "2026-02-20";
  const endDate = "2026-03-08";

  console.log(`📅 Scanning ${startDate} to ${endDate}...\n`);

  let page = 0;
  const pageSize = 1000;

  while (true) {
    const { data: tickets, error } = await supabase
      .from("tickets")
      .select("ticket_number, canonical_user_id, tx_id, created_at")
      .gte("created_at", `${startDate}T00:00:00`)
      .lte("created_at", `${endDate}T23:59:59`)
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) {
      console.error("❌ Error:", error);
      return;
    }

    if (!tickets || tickets.length === 0) break;

    // Filter for fake 0x hashes
    const fakeHashes = tickets.filter(
      (t) =>
        t.tx_id &&
        t.tx_id.startsWith("0x") &&
        t.tx_id.length === 66 &&
        !KNOWN_REAL_HASHES.includes(t.tx_id),
    );

    allFakeTickets.push(...fakeHashes);

    if (fakeHashes.length > 0) {
      console.log(
        `📄 Page ${page + 1}: ${fakeHashes.length} fake hash tickets`,
      );
    }

    if (tickets.length < pageSize) break;
    page++;
  }

  console.log(
    `\n📋 Total tickets with fake hashes: ${allFakeTickets.length}\n`,
  );

  // Group by user
  const ticketsByUser = {};
  allFakeTickets.forEach((ticket) => {
    if (!ticketsByUser[ticket.canonical_user_id]) {
      ticketsByUser[ticket.canonical_user_id] = [];
    }
    ticketsByUser[ticket.canonical_user_id].push(ticket);
  });

  console.log(
    `👥 ${Object.keys(ticketsByUser).length} users have tickets with fake hashes\n`,
  );

  let usersProcessed = 0;
  let usersUpdated = 0;
  let ticketsUpdated = 0;

  // Process each user
  for (const [userId, userTickets] of Object.entries(ticketsByUser)) {
    usersProcessed++;

    if (usersProcessed % 20 === 0 || usersProcessed === 1) {
      console.log(
        `\n[${usersProcessed}/${Object.keys(ticketsByUser).length}] Processing...`,
      );
    }

    // Get user's topup transactions
    const { data: topups, error: topupsError } = await supabase
      .from("user_transactions")
      .select("tx_id, amount, created_at")
      .eq("canonical_user_id", userId)
      .eq("type", "topup")
      .gte("created_at", "2026-02-01")
      .lte("created_at", "2026-03-10")
      .order("created_at", { ascending: false });

    if (topupsError || !topups || topups.length === 0) continue;

    // Find a topup with blockchain hash
    let blockchainHash = null;

    for (const topup of topups) {
      const chargeId = topup.tx_id;
      if (
        !chargeId ||
        chargeId.startsWith("0x") ||
        chargeId.startsWith("BAL_") ||
        chargeId === "null"
      )
        continue;

      // Search webhooks
      const { data: webhooks } = await supabase
        .from("payment_webhook_events")
        .select("id, payload")
        .gte("created_at", "2026-02-01")
        .lte("created_at", "2026-03-10")
        .limit(2000);

      if (!webhooks) continue;

      const matchingWebhooks = webhooks.filter((w) =>
        JSON.stringify(w.payload).includes(chargeId),
      );

      if (matchingWebhooks.length === 0) continue;

      // Extract hash
      for (const webhook of matchingWebhooks) {
        const payload = webhook.payload;
        const paths = [
          () => payload?.payments?.[0]?.transaction_id,
          () => payload?.event?.data?.payments?.[0]?.transaction_id,
          () => payload?.data?.payments?.[0]?.transaction_id,
          () => payload?.event?.data?.web3_data?.success_events?.[0]?.tx_hsh,
          () => payload?.data?.web3_data?.success_events?.[0]?.tx_hsh,
          () => payload?.timeline?.[0]?.payment?.transaction_id,
          () => payload?.event?.data?.timeline?.[0]?.payment?.transaction_id,
        ];

        for (const pathFn of paths) {
          try {
            const hash = pathFn();
            if (
              hash &&
              typeof hash === "string" &&
              hash.startsWith("0x") &&
              hash.length === 66
            ) {
              blockchainHash = hash;
              break;
            }
          } catch (e) {}
        }

        if (blockchainHash) break;
      }

      if (blockchainHash) break;
    }

    if (!blockchainHash) continue;

    // Update tickets in batches
    const ticketNumbers = userTickets.map((t) => t.ticket_number);
    const batchSize = 100;

    for (let i = 0; i < ticketNumbers.length; i += batchSize) {
      const batch = ticketNumbers.slice(i, i + batchSize);

      const { error } = await supabase
        .from("tickets")
        .update({ tx_id: blockchainHash })
        .in("ticket_number", batch);

      if (!error) {
        ticketsUpdated += batch.length;
      }
    }

    usersUpdated++;

    if (usersUpdated % 20 === 0) {
      console.log(
        `   ✅ ${usersUpdated} users updated, ${ticketsUpdated} tickets fixed`,
      );
    }
  }

  console.log("\n✅ Final Results:");
  console.log(`   Users processed: ${usersProcessed}`);
  console.log(`   Users updated: ${usersUpdated}`);
  console.log(`   Tickets updated: ${ticketsUpdated}`);
  console.log(
    `   Users not updated: ${usersProcessed - usersUpdated} (couldn't find blockchain hash)`,
  );
}

updateAllFakeHashesComprehensive().catch(console.error);
