import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
);

// Check what payment_provider the "wrong" hashes have
const USERS = {
  "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363":
    "0xac1dfe66d18919a0434793ee74e15e831babec126afedaa25df2d49d101fd901",
  "prize:pid:0x543e8fb59312a2578f70152c79eae169e4f8fe9e":
    "0x271a504c9639c98e520bdd181a03370609313993e830d4f547ae1a68c61b768b",
};

console.log("🔍 Checking payment_provider for tickets with 'wrong' hash...\n");

for (const [userId, expectedHash] of Object.entries(USERS)) {
  console.log(`User: ${userId.substring(0, 40)}...`);

  const { data: wrong } = await supabase
    .from("tickets")
    .select("tx_id, payment_provider, payment_tx_hash")
    .eq("canonical_user_id", userId)
    .neq("tx_id", expectedHash)
    .limit(20);

  if (!wrong || wrong.length === 0) {
    console.log("  All correct!\n");
    continue;
  }

  // Group by hash
  const byHash = {};
  for (const t of wrong) {
    const key = t.tx_id || "NULL";
    if (!byHash[key]) {
      byHash[key] = {
        providers: new Set(),
        payment_tx_hashes: new Set(),
        count: 0,
      };
    }
    byHash[key].count++;
    byHash[key].providers.add(t.payment_provider || "NULL");
    if (t.payment_tx_hash) byHash[key].payment_tx_hashes.add(t.payment_tx_hash);
  }

  for (const [hash, info] of Object.entries(byHash)) {
    console.log(`\n  tx_id: ${hash.substring(0, 30)}...`);
    console.log(`    Count: ${info.count} (in sample)`);
    console.log(`    payment_provider: ${[...info.providers].join(", ")}`);
    console.log(
      `    payment_tx_hash samples: ${[...info.payment_tx_hashes].slice(0, 2).join(", ")}`,
    );
  }
  console.log();
}
