import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
);

console.log("\n🔍 Finding blockchain transaction hashes in webhook events:\n");

// Get recent webhook events
const { data: webhooks, error } = await supabase
  .from("payment_webhook_events")
  .select("*")
  .order("created_at", { ascending: false })
  .limit(10);

if (error) {
  console.error("Error:", error);
} else {
  console.log(`Found ${webhooks.length} recent webhook events\n`);

  webhooks.forEach((w, i) => {
    console.log(`\n[${i + 1}] Event:`);
    console.log(`  ID: ${w.id}`);
    console.log(`  Type: ${w.event_type}`);
    console.log(`  Status: ${w.status}`);
    console.log(`  Created: ${w.created_at}`);

    // Show all columns
    console.log(`  All columns:`, Object.keys(w));

    // Look for blockchain hashes
    const dataStr = JSON.stringify(w);
    const txMatches = dataStr.match(/0x[a-fA-F0-9]{64}/g);

    if (txMatches) {
      console.log(`  🎯 BLOCKCHAIN TX HASH FOUND:`, [...new Set(txMatches)]);
    }

    // Check event_data structure
    if (w.event_data) {
      if (w.event_data.payments) {
        console.log(`  Payments:`, w.event_data.payments);
      }
      if (w.event_data.data?.payments) {
        console.log(`  Data.Payments:`, w.event_data.data.payments);
      }
    }
  });
}

console.log("\n\n✅ Complete");
