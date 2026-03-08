import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
);

console.log("\n🔍 Checking webhook event structure for blockchain hashes:\n");

// Get a recent confirmed webhook with blockchain hash
const { data: confirmedWebhook } = await supabase
  .from("payment_webhook_events")
  .select("*")
  .eq("event_type", "charge:confirmed")
  .order("created_at", { ascending: false })
  .limit(1)
  .single();

if (confirmedWebhook) {
  console.log("Recent confirmed webhook:");
  console.log("ID:", confirmedWebhook.id);
  console.log("Event ID:", confirmedWebhook.event_id);
  console.log("Order ID:", confirmedWebhook.order_id);
  console.log("Transaction ID:", confirmedWebhook.transaction_id);
  console.log("Created:", confirmedWebhook.created_at);

  console.log("\n📦 Full payload structure:");
  console.log(JSON.stringify(confirmedWebhook.payload, null, 2));

  // Extract blockchain hash
  const payloadStr = JSON.stringify(confirmedWebhook.payload);
  const txMatches = payloadStr.match(/0x[a-fA-F0-9]{64}/g);

  if (txMatches) {
    console.log("\n🎯 Blockchain TX hashes found:");
    txMatches.forEach((tx) => console.log(`   ${tx}`));

    // Now check if this webhook's order_id or transaction_id matches a topup
    if (confirmedWebhook.order_id || confirmedWebhook.transaction_id) {
      const searchId =
        confirmedWebhook.order_id || confirmedWebhook.transaction_id;

      const { data: relatedTx } = await supabase
        .from("user_transactions")
        .select("*")
        .or(`id.eq.${searchId},tx_id.eq.${searchId},order_id.eq.${searchId}`)
        .single();

      if (relatedTx) {
        console.log("\n✅ Found related transaction:");
        console.log("   User:", relatedTx.canonical_user_id);
        console.log("   Type:", relatedTx.type);
        console.log("   Amount: $", relatedTx.amount);
        console.log("   Current tx_id:", relatedTx.tx_id);
        console.log("   Should update to:", txMatches[0]);
      }
    }
  }
}

console.log("\n\n✅ Complete");
