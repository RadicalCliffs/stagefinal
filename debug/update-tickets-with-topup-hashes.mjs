import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
);

const COMPETITION_ID = "12cccfb1-df68-4b3e-a168-07dfeaeb06cc";

async function updateTicketsWithTopupHashes() {
  console.log("🔍 Finding topup transactions for competition tickets...\n");

  // Get all tickets for this competition
  const { data: tickets, error: ticketsError } = await supabase
    .from("tickets")
    .select("ticket_number, canonical_user_id, tx_id, transaction_hash")
    .eq("competition_id", COMPETITION_ID)
    .order("ticket_number");

  if (ticketsError) {
    console.error("❌ Error fetching tickets:", ticketsError);
    return;
  }

  console.log(`📋 Found ${tickets.length} tickets\n`);

  // Group tickets by user
  const ticketsByUser = {};
  tickets.forEach((ticket) => {
    if (!ticketsByUser[ticket.canonical_user_id]) {
      ticketsByUser[ticket.canonical_user_id] = [];
    }
    ticketsByUser[ticket.canonical_user_id].push(ticket);
  });

  console.log(`👥 ${Object.keys(ticketsByUser).length} unique users\n`);

  // For each user, find their topup transaction
  for (const [userId, userTickets] of Object.entries(ticketsByUser)) {
    console.log(`\n👤 User: ${userId.substring(0, 50)}...`);
    console.log(`   ${userTickets.length} tickets`);

    // Get user's topup transactions around Feb 22
    const { data: topups, error: topupsError } = await supabase
      .from("user_transactions")
      .select("tx_id, amount, created_at")
      .eq("canonical_user_id", userId)
      .eq("type", "topup")
      .gte("created_at", "2026-02-20")
      .lte("created_at", "2026-02-24")
      .order("created_at", { ascending: false });

    if (topupsError || !topups || topups.length === 0) {
      console.log("   ⚠️ No topups found in Feb 20-24 range");
      continue;
    }

    console.log(`   💰 Found ${topups.length} topup(s):`);
    topups.forEach((t) =>
      console.log(`      ${t.tx_id} - $${t.amount} at ${t.created_at}`),
    );

    // Get webhooks for this user's topup transactions
    for (const topup of topups) {
      const chargeId = topup.tx_id;

      // Look for charge:confirmed events which contain blockchain hashes
      // Search in the date range and filter for confirmed events with this charge ID
      const { data: allWebhooks } = await supabase
        .from("payment_webhook_events")
        .select("id, payload, event_type, created_at")
        .gte("created_at", "2026-02-20")
        .lte("created_at", "2026-02-24")
        .limit(500);

      // Filter for confirmed events with blockchain hash
      let webhooks = null;
      if (allWebhooks) {
        webhooks = allWebhooks.filter((w) => {
          const payloadStr = JSON.stringify(w.payload);
          const hasChargeId = payloadStr.includes(chargeId);
          const isConfirmed =
            w.event_type === "charge:confirmed" ||
            payloadStr.includes('"confirmed"') ||
            payloadStr.includes("transaction_id") ||
            payloadStr.includes("tx_hsh");
          return hasChargeId && isConfirmed;
        });
      }

      if (!webhooks || webhooks.length === 0) {
        console.log(
          `   ⚠️ No confirmed webhook found for charge ${chargeId.substring(0, 20)}...`,
        );
        continue;
      }

      console.log(`   ✅ Found ${webhooks.length} webhook(s) for this charge`);

      // Try each webhook to find one with blockchain hash
      let blockchainHash = null;
      let webhookUsed = null;

      for (const webhook of webhooks) {
        const payload = webhook.payload;

        // Try different paths in payload for blockchain hash
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
              webhookUsed = webhook;
              break;
            }
          } catch (e) {
            // Path doesn't exist, continue
          }
        }

        if (blockchainHash) break;
      }

      if (!blockchainHash) {
        console.log(
          `   ❌ No blockchain hash found in any webhook for this charge`,
        );
        console.log(`   Checked ${webhooks.length} webhooks`);
        console.log("   First webhook event_type:", webhooks[0].event_type);
        console.log(
          "   Sample payload keys:",
          Object.keys(webhooks[0].payload || {}),
        );
        continue;
      }

      console.log(
        `   🔗 Found blockchain TX: ${blockchainHash} (webhook: ${webhookUsed.id})`,
      );

      console.log(`   🔗 Blockchain TX: ${blockchainHash}`);

      // Update all tickets for this user with the real blockchain hash
      const ticketNumbers = userTickets.map((t) => t.ticket_number);

      const { error: updateError } = await supabase
        .from("tickets")
        .update({
          tx_id: blockchainHash,
        })
        .eq("competition_id", COMPETITION_ID)
        .in("ticket_number", ticketNumbers);

      if (updateError) {
        console.log(`   ❌ Failed to update tickets:`, updateError);
      } else {
        console.log(
          `   ✅ Updated ${ticketNumbers.length} tickets with blockchain hash`,
        );
      }

      break; // Use first topup found
    }
  }

  console.log("\n✅ Done!");
}

updateTicketsWithTopupHashes().catch(console.error);
