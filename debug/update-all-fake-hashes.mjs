import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
);

async function updateAllFakeHashes() {
  console.log("🔍 Finding ALL tickets with fake hashes from March 4...\n");

  // Get all tickets from March 4 (when the fake hashes were created)
  let allTickets = [];
  let page = 0;
  const pageSize = 1000;

  while (true) {
    const { data: tickets, error } = await supabase
      .from("tickets")
      .select(
        "ticket_number, competition_id, canonical_user_id, tx_id, created_at",
      )
      .gte("created_at", "2026-03-04T00:00:00")
      .lte("created_at", "2026-03-04T23:59:59")
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) {
      console.error("❌ Error fetching tickets:", error);
      return;
    }

    if (!tickets || tickets.length === 0) break;

    // Filter for 0x hashes only (exclude BAL_ or charge IDs)
    const fakeHashTickets = tickets.filter(
      (t) => t.tx_id && t.tx_id.startsWith("0x") && t.tx_id.length === 66,
    );

    allTickets.push(...fakeHashTickets);
    console.log(
      `📄 Page ${page + 1}: ${fakeHashTickets.length} tickets with fake hashes`,
    );

    if (tickets.length < pageSize) break;
    page++;
  }

  console.log(`\n📋 Total tickets to update: ${allTickets.length}\n`);

  // Group tickets by user
  const ticketsByUser = {};
  allTickets.forEach((ticket) => {
    if (!ticketsByUser[ticket.canonical_user_id]) {
      ticketsByUser[ticket.canonical_user_id] = [];
    }
    ticketsByUser[ticket.canonical_user_id].push(ticket);
  });

  console.log(`👥 ${Object.keys(ticketsByUser).length} unique users\n`);

  let usersProcessed = 0;
  let usersUpdated = 0;
  let ticketsUpdated = 0;

  // For each user, find their topup transaction and update their tickets
  for (const [userId, userTickets] of Object.entries(ticketsByUser)) {
    usersProcessed++;

    if (usersProcessed % 10 === 0) {
      console.log(
        `\n[${usersProcessed}/${Object.keys(ticketsByUser).length}] Processing users...`,
      );
    }

    // Get user's topup transactions from late Feb / early March
    const { data: topups, error: topupsError } = await supabase
      .from("user_transactions")
      .select("tx_id, amount, created_at")
      .eq("canonical_user_id", userId)
      .eq("type", "topup")
      .gte("created_at", "2026-02-15")
      .lte("created_at", "2026-03-04")
      .order("created_at", { ascending: false });

    if (topupsError || !topups || topups.length === 0) {
      continue;
    }

    // Try to find a webhook with blockchain hash for any of their topups
    let blockchainHash = null;

    for (const topup of topups) {
      const chargeId = topup.tx_id;
      if (!chargeId || chargeId.startsWith("0x") || chargeId.startsWith("BAL_"))
        continue;

      // Search for webhooks with this charge ID
      const { data: allWebhooks } = await supabase
        .from("payment_webhook_events")
        .select("id, payload, event_type, created_at")
        .gte("created_at", "2026-02-15")
        .lte("created_at", "2026-03-04")
        .limit(1000);

      if (!allWebhooks) continue;

      // Filter for webhooks with this charge and blockchain hash
      const webhooks = allWebhooks.filter((w) => {
        const payloadStr = JSON.stringify(w.payload);
        return (
          payloadStr.includes(chargeId) &&
          (payloadStr.includes("transaction_id") ||
            payloadStr.includes("tx_hsh"))
        );
      });

      if (webhooks.length === 0) continue;

      // Try to extract blockchain hash
      for (const webhook of webhooks) {
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

    if (!blockchainHash) {
      continue;
    }

    // Update all tickets for this user
    const ticketNumbers = userTickets.map((t) => t.ticket_number);

    const { error: updateError } = await supabase
      .from("tickets")
      .update({ tx_id: blockchainHash })
      .in("ticket_number", ticketNumbers);

    if (!updateError) {
      usersUpdated++;
      ticketsUpdated += ticketNumbers.length;
    }
  }

  console.log("\n✅ Done!");
  console.log(`📊 Users processed: ${usersProcessed}`);
  console.log(`✅ Users updated: ${usersUpdated}`);
  console.log(`🎫 Tickets updated: ${ticketsUpdated}`);
}

updateAllFakeHashes().catch(console.error);
