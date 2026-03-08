import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
);

const USERS = [
  "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363",
  "prize:pid:0x543e8fb59312a2578f70152c79eae169e4f8fe9e",
  "prize:pid:0xe1a2e7487ddb3d82b150b47b8c6e9e5e03e0caf6",
];

console.log("🔍 Checking canonical_users last_topup_tx_hash values...\n");

for (const userId of USERS) {
  const { data, error } = await supabase
    .from("canonical_users")
    .select("canonical_user_id, last_topup_tx_hash")
    .eq("canonical_user_id", userId)
    .single();

  console.log(`User: ${userId.substring(0, 40)}...`);
  if (error) {
    console.log(`  ❌ Error: ${error.message}`);
  } else if (data) {
    console.log(`  ✅ Hash: ${data.last_topup_tx_hash || "NULL"}`);
  }
  console.log();
}

// Also check ticket tx_id distribution
console.log("=".repeat(60));
console.log("📊 Ticket tx_id distribution per user:\n");

for (const userId of USERS) {
  const { data: tickets } = await supabase
    .from("tickets")
    .select("tx_id")
    .eq("canonical_user_id", userId)
    .limit(1000);

  if (!tickets || tickets.length === 0) {
    console.log(`${userId.substring(0, 40)}...`);
    console.log("  No tickets found\n");
    continue;
  }

  const hashCounts = {};
  for (const t of tickets) {
    const hash = t.tx_id || "NULL";
    hashCounts[hash] = (hashCounts[hash] || 0) + 1;
  }

  console.log(`${userId.substring(0, 40)}...`);
  console.log(`  Total tickets: ${tickets.length}`);
  for (const [hash, count] of Object.entries(hashCounts)) {
    console.log(`  ${hash.substring(0, 20)}...: ${count} tickets`);
  }
  console.log();
}
