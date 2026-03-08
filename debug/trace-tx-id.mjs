import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
);

const txId = "48d09850-8462-43e8-91e7-6eeee1bedc35";

console.log("\n🔍 Tracing transaction ID through tables:\n");
console.log(`TX ID: ${txId}\n`);

// Check user_transactions
console.log("1️⃣ user_transactions:");
const { data: ut } = await supabase
  .from("user_transactions")
  .select("*")
  .eq("tx_id", txId)
  .single();

if (ut) {
  console.log("   Found!");
  console.log("   All fields:", Object.keys(ut));
  console.log("   Type:", ut.type);
  console.log("   Amount: $", ut.amount);
  console.log("   Provider:", ut.payment_provider);
  console.log("   Created:", ut.created_at);
  console.log("   Order ID:", ut.order_id);
  console.log("   Transaction ID (different):", ut.transaction_id);
  console.log("   Metadata:", ut.metadata);
  console.log("   Payment ID:", ut.payment_id);
  console.log("   Charge ID:", ut.charge_id);
}

// Check if it's an order_id
if (ut?.order_id) {
  console.log("\n2️⃣ Checking orders table with order_id:", ut.order_id);
  const { data: order } = await supabase
    .from("orders")
    .select("*")
    .eq("id", ut.order_id)
    .single();

  if (order) {
    console.log("   Found order!");
    console.log("   All fields:", Object.keys(order));
    if (order.blockchain_tx_hash || order.transaction_hash || order.tx_hash) {
      console.log(
        "   🎯 BLOCKCHAIN HASH:",
        order.blockchain_tx_hash || order.transaction_hash || order.tx_hash,
      );
    }
  }
}

// Search all webhook events for this UUID
console.log("\n3️⃣ Searching webhook events...");
const { data: webhooks } = await supabase
  .from("payment_webhook_events")
  .select("*")
  .or(`event_id.eq.${txId},order_id.eq.${txId},transaction_id.eq.${txId}`)
  .order("created_at", { ascending: false });

if (webhooks && webhooks.length > 0) {
  console.log(`   Found ${webhooks.length} webhook(s)`);
  webhooks.forEach((w) => {
    console.log(`\n   Event: ${w.event_type}`);
    console.log(`   Created: ${w.created_at}`);

    const payloadStr = JSON.stringify(w.payload);
    const txMatches = payloadStr.match(/0x[a-fA-F0-9]{64}/g);
    if (txMatches) {
      console.log(`   🎯 BLOCKCHAIN TX: ${txMatches[0]}`);
    }
  });
} else {
  console.log("   No webhooks found");
}

console.log("\n✅ Trace complete");
