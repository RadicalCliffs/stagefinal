import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
);

console.log("🔍 FINAL SCHEMA VERIFICATION\n");

// 1. Check payment_webhook_events table
console.log("1️⃣ Checking payment_webhook_events table...");
const { data: webhooks, error: webhookError } = await supabase
  .from("payment_webhook_events")
  .select("*")
  .limit(1);

if (webhookError) {
  console.log("❌ ERROR:", webhookError.message);
} else {
  console.log("✅ Table exists");
  if (webhooks && webhooks.length > 0) {
    console.log("   Columns:", Object.keys(webhooks[0]).join(", "));
  }
}

// 2. Check actual payment_provider values
console.log("\n2️⃣ Checking actual payment_provider values in tickets...");
const { data: providers } = await supabase
  .from("tickets")
  .select("payment_provider")
  .not("payment_provider", "is", null)
  .limit(1000);

const uniqueProviders = [
  ...new Set(providers?.map((p) => p.payment_provider).filter(Boolean)),
];
console.log("✅ Unique payment_provider values:", uniqueProviders);

// 3. Check if any tickets have payment_tx_hash that looks like a charge ID
console.log(
  "\n3️⃣ Checking payment_tx_hash patterns (charge IDs vs blockchain hashes)...",
);
const { data: samples } = await supabase
  .from("tickets")
  .select("payment_provider, payment_tx_hash")
  .not("payment_tx_hash", "is", null)
  .limit(100);

const chargeIds = samples?.filter(
  (s) => s.payment_tx_hash && !s.payment_tx_hash.startsWith("0x"),
);
const blockchainHashes = samples?.filter(
  (s) =>
    s.payment_tx_hash &&
    s.payment_tx_hash.startsWith("0x") &&
    s.payment_tx_hash.length === 66,
);

console.log(`   Charge IDs: ${chargeIds?.length || 0}`);
if (chargeIds && chargeIds.length > 0) {
  console.log(`   Example: ${chargeIds[0].payment_tx_hash}`);
}
console.log(`   Blockchain hashes: ${blockchainHashes?.length || 0}`);
if (blockchainHashes && blockchainHashes.length > 0) {
  console.log(`   Example: ${blockchainHashes[0].payment_tx_hash}`);
}

// 4. Check existing triggers on tickets table
console.log("\n4️⃣ Checking existing triggers...");
const { data: triggers } = await supabase.rpc("get_table_triggers", {
  table_name: "tickets",
});

if (triggers) {
  console.log("✅ Existing triggers on tickets:");
  triggers.forEach((t) => console.log(`   - ${t}`));
} else {
  console.log(
    "   (Could not fetch - function might not exist, but that's OK)",
  );
}

console.log("\n✅ VERIFICATION COMPLETE");
