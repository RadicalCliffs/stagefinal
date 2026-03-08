import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
);

async function fixPerUserHashesNow() {
  console.log("🔥 FIXING: Each user gets THEIR OWN topup blockchain hash\n");

  // Get ALL users who have tickets from Feb-Mar
  const { data: allTickets } = await supabase
    .from("tickets")
    .select("ticket_number, canonical_user_id, tx_id, created_at")
    .gte("created_at", "2026-02-20")
    .lte("created_at", "2026-03-09")
    .not("tx_id", "is", null);

  if (!allTickets) {
    console.error("No tickets found");
    return;
  }

  console.log(`📋 Found ${allTickets.length} total tickets\n`);

  // Group by user
  const byUser = {};
  allTickets.forEach((t) => {
    if (!byUser[t.canonical_user_id]) {
      byUser[t.canonical_user_id] = [];
    }
    byUser[t.canonical_user_id].push(t);
  });

  const users = Object.keys(byUser);
  console.log(`👥 ${users.length} unique users\n`);

  let userIndex = 0;
  let totalFixed = 0;

  for (const userId of users) {
    userIndex++;
    const userTickets = byUser[userId];

    console.log(
      `\n[${userIndex}/${users.length}] User: ${userId.substring(0, 40)}...`,
    );
    console.log(`   Tickets: ${userTickets.length}`);

    // Get THIS USER's topup transactions
    const { data: userTopups } = await supabase
      .from("user_transactions")
      .select("tx_id, created_at, amount")
      .eq("canonical_user_id", userId)
      .eq("type", "topup")
      .not("tx_id", "is", null)
      .gte("created_at", "2026-02-15")
      .lte("created_at", "2026-03-09")
      .order("created_at", { ascending: true });

    if (!userTopups || userTopups.length === 0) {
      console.log(`   ⚠️ No topups found`);
      continue;
    }

    // Filter out NULL/empty tx_ids AFTER fetching
    const validTopups = userTopups.filter(
      (t) =>
        t.tx_id &&
        t.tx_id !== "" &&
        t.tx_id !== "null" &&
        !t.tx_id.startsWith("0x") &&
        !t.tx_id.startsWith("BAL_"),
    );

    if (validTopups.length === 0) {
      console.log(`   ⚠️ No valid topup charge IDs found`);
      continue;
    }

    console.log(`   💰 Found ${validTopups.length} topup(s) with charge IDs`);
    // Show first few
    validTopups.slice(0, 3).forEach((t) => {
      console.log(
        `      ${t.created_at.substring(0, 16)}: ${t.tx_id.substring(0, 25)}...`,
      );
    });

    // Map topups to their blockchain hashes
    const topupHashMap = {}; // chargeId -> blockchainHash

    for (const topup of validTopups) {
      const chargeId = topup.tx_id;

      // Find webhook for this charge - search within 2 days of topup
      const topupDate = new Date(topup.created_at);
      const startDate = new Date(topupDate.getTime() - 2 * 24 * 60 * 60 * 1000);
      const endDate = new Date(topupDate.getTime() + 2 * 24 * 60 * 60 * 1000);

      const { data: webhooks } = await supabase
        .from("payment_webhook_events")
        .select("payload, event_type")
        .gte("created_at", startDate.toISOString())
        .lte("created_at", endDate.toISOString())
        .limit(500);

      console.log(
        `      Topup ${topup.created_at.substring(0, 10)}: ${webhooks?.length || 0} webhooks in range`,
      );

      if (!webhooks || webhooks.length === 0) continue;

      // Find webhooks with this charge ID
      const matchingWebhooks = webhooks.filter((w) =>
        JSON.stringify(w.payload).includes(chargeId),
      );

      // Prioritize charge:confirmed or charge:pending (which have blockchain hashes)
      const matchingWebhook =
        matchingWebhooks.find(
          (w) =>
            w.event_type === "charge:confirmed" ||
            w.event_type === "charge:pending",
        ) || matchingWebhooks[matchingWebhooks.length - 1]; // Fallback to last event

      if (!matchingWebhook) {
        console.log(
          `         ✗ Charge ${chargeId.substring(0, 15)}... NOT found in webhooks`,
        );
        continue;
      }

      console.log(
        `         ✓ Found matching webhook! (${matchingWebhook.event_type})`,
      );

      // Extract blockchain hash
      const payload = matchingWebhook.payload;
      const paths = [
        () => payload?.payments?.[0]?.transaction_id,
        () => payload?.event?.data?.payments?.[0]?.transaction_id,
        () => payload?.data?.payments?.[0]?.transaction_id,
        () => payload?.event?.data?.web3_data?.success_events?.[0]?.tx_hsh,
        () => payload?.data?.web3_data?.success_events?.[0]?.tx_hsh,
        () => payload?.timeline?.[0]?.payment?.transaction_id,
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
            topupHashMap[chargeId] = hash;
            console.log(
              `      ${topup.created_at.substring(0, 10)}: $${topup.amount} → ${hash.substring(0, 20)}...`,
            );
            break;
          }
        } catch (e) {}
      }
    }

    const foundHashes = Object.values(topupHashMap);
    if (foundHashes.length === 0) {
      console.log(`   ❌ No blockchain hashes found in webhooks`);
      continue;
    }

    console.log(
      `   ✅ Found ${foundHashes.length} blockchain hash(es) for THIS user`,
    );

    // Now update THIS USER's tickets
    // Group tickets by time period to match to correct topup
    const updates = [];

    for (const ticket of userTickets) {
      // Find the correct topup for this ticket's purchase time
      let correctHash = null;
      let correctTopup = null;

      // Find the most recent topup BEFORE this ticket
      for (const topup of [...validTopups].reverse()) {
        // Check newest first
        // Check newest first
        if (new Date(topup.created_at) <= new Date(ticket.created_at)) {
          const chargeId = topup.tx_id;
          if (topupHashMap[chargeId]) {
            correctHash = topupHashMap[chargeId];
            correctTopup = topup;
            break;
          }
        }
      }

      // If no topup before ticket, use the first topup we found
      if (!correctHash && foundHashes.length > 0) {
        correctHash = foundHashes[0];
      }

      if (correctHash && correctHash !== ticket.tx_id) {
        updates.push({
          ticket_number: ticket.ticket_number,
          old_hash: ticket.tx_id?.substring(0, 20) + "...",
          new_hash: correctHash,
        });
      }
    }

    if (updates.length === 0) {
      console.log(`   ✓ All tickets already correct`);
      continue;
    }

    console.log(`   📝 Updating ${updates.length} tickets...`);

    // Update in batches
    const batchSize = 50;
    for (let i = 0; i < updates.length; i += batchSize) {
      const batch = updates.slice(i, i + batchSize);

      for (const update of batch) {
        await supabase
          .from("tickets")
          .update({ tx_id: update.new_hash })
          .eq("ticket_number", update.ticket_number);
      }
    }

    totalFixed += updates.length;
    console.log(
      `   ✅ Updated ${updates.length} tickets with THIS USER's hash`,
    );
  }

  console.log(
    `\n🎉 DONE! Fixed ${totalFixed} tickets across ${users.length} users`,
  );
  console.log("Each user now has THEIR OWN topup blockchain hash");
}

fixPerUserHashesNow().catch(console.error);
