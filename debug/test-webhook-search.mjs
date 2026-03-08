import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
);

async function testWebhookSearch() {
  const testChargeId = "759f380e-7c18-4724-9d97-1db43080b4ef"; // User 1's March 4 topup

  console.log(`🔍 Searching for charge ID: ${testChargeId}\n`);

  // Get webhooks around March 4
  const { data: webhooks } = await supabase
    .from("payment_webhook_events")
    .select("id, event_type, created_at, payload")
    .gte("created_at", "2026-03-02")
    .lte("created_at", "2026-03-06")
    .limit(50);

  console.log(`Found ${webhooks?.length || 0} webhooks in range\n`);

  if (webhooks) {
    for (const webhook of webhooks) {
      const payloadStr = JSON.stringify(webhook.payload);
      if (payloadStr.includes(testChargeId)) {
        console.log(`✅ FOUND in webhook ${webhook.id}`);
        console.log(`   Event: ${webhook.event_type}`);
        console.log(`   Date: ${webhook.created_at}`);

        // Extract blockchain hash
        const payload = webhook.payload;
        const hash =
          payload?.payments?.[0]?.transaction_id ||
          payload?.event?.data?.payments?.[0]?.transaction_id ||
          payload?.data?.payments?.[0]?.transaction_id ||
          payload?.event?.data?.web3_data?.success_events?.[0]?.tx_hsh;

        if (hash) {
          console.log(`   Blockchain hash: ${hash}`);
        } else {
          console.log(`   ⚠️ No blockchain hash in payload`);
          console.log(`   Payload keys:`, Object.keys(payload));
        }
        console.log("");
      }
    }
  }
}

testWebhookSearch().catch(console.error);
