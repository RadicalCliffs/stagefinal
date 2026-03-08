import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
);

const chargeIds = [
  "48d09850-8462-43e8-91e7-6eeee1bedc35", // User 1's topup from Feb 22
  "0df3c4ce-f09c-46b9-9df9-c43980250a25", // User 2's topup from Feb 22
];

console.log("\n🔍 Finding blockchain TX hashes for Coinbase charges:\n");

for (const chargeId of chargeIds) {
  console.log(`\n📍 Charge ID: ${chargeId}`);

  // Search in payload field
  const { data: webhooks, error } = await supabase
    .from("payment_webhook_events")
    .select("*")
    .contains("payload", { id: chargeId })
    .order("created_at", { ascending: false });

  if (error) {
    console.log(`   Trying text search...`);

    // Try text search
    const { data: webhooks2, error: error2 } = await supabase
      .from("payment_webhook_events")
      .select("*")
      .textSearch("payload", chargeId)
      .order("created_at", { ascending: false });

    if (error2) {
      console.log(`   Trying manual filter...`);

      // Get all webhooks from around that time period and filter manually
      const { data: allWebhooks, error: error3 } = await supabase
        .from("payment_webhook_events")
        .select("*")
        .gte("created_at", "2026-02-22T00:00:00")
        .lte("created_at", "2026-02-23T00:00:00")
        .order("created_at", { ascending: false });

      if (error3) {
        console.error(`   ❌ Error:`, error3);
      } else {
        console.log(
          `   Found ${allWebhooks?.length || 0} webhooks from Feb 22`,
        );

        const matching = allWebhooks?.filter((w) => {
          const payloadStr = JSON.stringify(w.payload || {});
          return payloadStr.includes(chargeId);
        });

        console.log(`   ${matching?.length || 0} match this charge ID`);

        matching?.forEach((w) => {
          console.log(`\n   Event Type: ${w.event_type}`);
          console.log(`   Created: ${w.created_at}`);

          // Extract blockchain hash from payload
          const payloadStr = JSON.stringify(w.payload);
          const txMatches = payloadStr.match(/0x[a-fA-F0-9]{64}/g);

          if (txMatches && txMatches.length > 0) {
            console.log(`   🎯 BLOCKCHAIN TX HASH: ${txMatches[0]}`);
            console.log(`\n   ✅ This is the REAL on-chain transaction hash!`);
            console.log(`   Verify: https://basescan.org/tx/${txMatches[0]}`);
          }

          // Show payment details if available
          if (w.payload?.data?.payments) {
            console.log(
              `\n   Payment details:`,
              JSON.stringify(w.payload.data.payments, null, 2),
            );
          }
        });
      }
    } else if (webhooks2 && webhooks2.length > 0) {
      console.log(`   Found ${webhooks2.length} matching webhook(s)`);
      webhooks2.forEach((w) => {
        const payloadStr = JSON.stringify(w.payload);
        const txMatches = payloadStr.match(/0x[a-fA-F0-9]{64}/g);
        if (txMatches) {
          console.log(`   🎯 TX: ${txMatches[0]}`);
        }
      });
    }
  } else if (webhooks && webhooks.length > 0) {
    console.log(`   ✅ Found ${webhooks.length} webhook event(s)`);

    webhooks.forEach((w) => {
      console.log(`\n   Event: ${w.event_type}`);
      const payloadStr = JSON.stringify(w.payload);
      const txMatches = payloadStr.match(/0x[a-fA-F0-9]{64}/g);

      if (txMatches && txMatches.length > 0) {
        console.log(`   🎯 BLOCKCHAIN TX: ${txMatches[0]}`);
      }
    });
  } else {
    console.log(`   ❌ No webhooks found with this charge ID`);
  }
}

console.log("\n\n✅ Search complete");
