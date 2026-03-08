import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
);

const chargeIds = [
  "48d09850-8462-43e8-91e7-6eeee1bedc35", // User 1's topup
  "0df3c4ce-f09c-46b9-9df9-c43980250a25", // User 2's topup
];

console.log("\n🔍 Checking Coinbase Commerce charges for blockchain hashes:\n");

for (const chargeId of chargeIds) {
  console.log(`\n📍 Charge ID: ${chargeId}`);

  // Check if this is in payment_webhook_events
  const { data: webhooks, error: webhookError } = await supabase
    .from("payment_webhook_events")
    .select("*")
    .or(`charge_code.eq.${chargeId},event_data->>id.eq.${chargeId}`)
    .order("created_at", { ascending: false })
    .limit(5);

  if (webhookError) {
    console.error("   Webhook error:", webhookError);
  } else if (webhooks && webhooks.length > 0) {
    console.log(`   ✅ Found ${webhooks.length} webhook event(s)`);
    webhooks.forEach((w) => {
      console.log(`\n   Event Type: ${w.event_type}`);
      console.log(`   Status: ${w.status}`);

      // Look for blockchain transaction hash in the webhook data
      if (w.event_data?.payments) {
        console.log(
          `   Payments:`,
          JSON.stringify(w.event_data.payments, null, 4),
        );
      }

      if (w.event_data?.data?.payments) {
        console.log(
          `   Data Payments:`,
          JSON.stringify(w.event_data.data.payments, null, 4),
        );
      }

      // Check for transaction hash anywhere in the data
      const dataStr = JSON.stringify(w.event_data);
      const txMatch = dataStr.match(/0x[a-fA-F0-9]{64}/g);
      if (txMatch) {
        console.log(`\n   🎯 FOUND BLOCKCHAIN TX HASH(ES):`, txMatch);
      }
    });
  } else {
    console.log(`   ❌ No webhook events found`);
  }

  // Also check user_transactions directly
  const { data: tx, error: txError } = await supabase
    .from("user_transactions")
    .select("*")
    .eq("tx_id", chargeId)
    .single();

  if (!txError && tx) {
    console.log(`\n   Transaction record details:`);
    console.log(`   Amount: $${tx.amount}`);
    console.log(`   Provider: ${tx.payment_provider}`);
    console.log(
      `   Metadata:`,
      tx.metadata ? JSON.stringify(tx.metadata, null, 2) : "none",
    );
  }
}

console.log("\n\n✅ Check complete");
