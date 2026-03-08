import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
);

const KNOWN_REAL_HASHES = [
  "0x7542cd73a56e95732724291fb336549231fc596f47531fec67b746abe8d76854",
  "0x271a504c9639c98e520bdd181a03370609313993e830d4f547ae1a68c61b768b",
  "0xaadebf880a647478484a63ab05226787f8ec6eafc627daf897b17e4b3c2aebfb",
];

async function fixTicketsByTime() {
  console.log("🔍 Re-mapping tickets to correct topup by purchase time...\n");

  // Get all tickets with 0x hashes from Feb-Mar
  let allTickets = [];
  let page = 0;
  const pageSize = 1000;

  while (true) {
    const { data: tickets } = await supabase
      .from("tickets")
      .select("ticket_number, canonical_user_id, tx_id, created_at")
      .gte("created_at", "2026-02-20T00:00:00")
      .lte("created_at", "2026-03-08T23:59:59")
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (!tickets || tickets.length === 0) break;

    const with0x = tickets.filter(
      (t) => t.tx_id && t.tx_id.startsWith("0x") && t.tx_id.length === 66,
    );

    allTickets.push(...with0x);
    if (tickets.length < pageSize) break;
    page++;
  }

  console.log(`📋 Found ${allTickets.length} balance-paid tickets\n`);

  // Group by user AND by the topup hash they currently have
  const groups = {};
  allTickets.forEach((ticket) => {
    const key = `${ticket.canonical_user_id}|${ticket.tx_id}`;
    if (!groups[key]) {
      groups[key] = {
        userId: ticket.canonical_user_id,
        currentHash: ticket.tx_id,
        tickets: [],
      };
    }
    groups[key].tickets.push(ticket);
  });

  console.log(`👥 ${Object.keys(groups).length} user+hash combinations\n`);

  let groupsChecked = 0;
  let ticketsNeedingUpdate = 0;
  let ticketsUpdated = 0;

  // For each group, check if all tickets should really have the same hash
  for (const group of Object.values(groups)) {
    groupsChecked++;

    if (groupsChecked % 5 === 0) {
      console.log(
        `[${groupsChecked}/${Object.keys(groups).length}] Checking...`,
      );
    }

    // For each ticket in this group, find what hash it SHOULD have based on purchase time
    const correctMappings = {}; // ticketNumber -> correctHash

    for (const ticket of group.tickets) {
      // Get user's topups before this ticket's purchase time
      const { data: topups } = await supabase
        .from("user_transactions")
        .select("tx_id, created_at")
        .eq("canonical_user_id", ticket.canonical_user_id)
        .eq("type", "topup")
        .lte("created_at", ticket.created_at)
        .not("tx_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(1);

      if (!topups || topups.length === 0) continue;

      const topupChargeId = topups[0].tx_id;
      if (
        !topupChargeId ||
        topupChargeId.startsWith("0x") ||
        topupChargeId.startsWith("BAL_")
      )
        continue;

      // Find blockchain hash for this topup
      const { data: webhooks } = await supabase
        .from("payment_webhook_events")
        .select("payload")
        .gte("created_at", "2026-02-15")
        .lte("created_at", "2026-03-10")
        .limit(2000);

      if (!webhooks) continue;

      const matchingWebhook = webhooks.find((w) =>
        JSON.stringify(w.payload).includes(topupChargeId),
      );

      if (!matchingWebhook) continue;

      // Extract blockchain hash
      const payload = matchingWebhook.payload;
      const paths = [
        () => payload?.payments?.[0]?.transaction_id,
        () => payload?.event?.data?.payments?.[0]?.transaction_id,
        () => payload?.data?.payments?.[0]?.transaction_id,
        () => payload?.event?.data?.web3_data?.success_events?.[0]?.tx_hsh,
        () => payload?.data?.web3_data?.success_events?.[0]?.tx_hsh,
      ];

      let blockchainHash = null;
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

      if (blockchainHash) {
        correctMappings[ticket.ticket_number] = blockchainHash;
      }
    }

    // Check if any tickets need updating
    const needsUpdate = [];
    for (const ticket of group.tickets) {
      const correctHash = correctMappings[ticket.ticket_number];
      if (correctHash && correctHash !== ticket.tx_id) {
        needsUpdate.push({ ticket_number: ticket.ticket_number, correctHash });
      }
    }

    if (needsUpdate.length > 0) {
      console.log(
        `\n📝 User ${group.userId.substring(0, 20)}...: ${needsUpdate.length} tickets need correction`,
      );
      console.log(
        `   Currently have: ${group.currentHash.substring(0, 20)}...`,
      );
      console.log(
        `   Should have: ${needsUpdate[0].correctHash.substring(0, 20)}...`,
      );

      ticketsNeedingUpdate += needsUpdate.length;

      // Update in batches
      const batchSize = 100;
      for (let i = 0; i < needsUpdate.length; i += batchSize) {
        const batch = needsUpdate.slice(i, i + batchSize);

        for (const item of batch) {
          const { error } = await supabase
            .from("tickets")
            .update({ tx_id: item.correctHash })
            .eq("ticket_number", item.ticket_number);

          if (!error) ticketsUpdated++;
        }
      }

      console.log(`   ✅ Updated ${needsUpdate.length} tickets`);
    }
  }

  console.log("\n✅ Final Results:");
  console.log(`   Groups checked: ${groupsChecked}`);
  console.log(`   Tickets needing correction: ${ticketsNeedingUpdate}`);
  console.log(`   Tickets updated: ${ticketsUpdated}`);
}

fixTicketsByTime().catch(console.error);
