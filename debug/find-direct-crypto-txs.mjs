import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
);

async function findDirectCryptoTxs() {
  console.log("🔍 Finding direct crypto transactions (non-topup)...\n");

  // Look for tickets with payment_tx_hash populated
  const { data: tickets, error } = await supabase
    .from("tickets")
    .select(
      "ticket_number, canonical_user_id, payment_tx_hash, payment_provider, created_at",
    )
    .not("payment_tx_hash", "is", null)
    .gte("created_at", "2026-02-01")
    .lte("created_at", "2026-03-08")
    .limit(100);

  if (error) {
    console.error("❌ Error:", error);
    return;
  }

  console.log(`📋 Found ${tickets.length} tickets with payment_tx_hash\n`);

  // Filter for actual blockchain hashes
  const cryptoTxs = tickets.filter(
    (t) =>
      t.payment_tx_hash &&
      t.payment_tx_hash.startsWith("0x") &&
      t.payment_tx_hash.length === 66,
  );

  console.log(`💰 ${cryptoTxs.length} are actual blockchain transactions\n`);

  // Group by user
  const byUser = {};
  cryptoTxs.forEach((t) => {
    if (!byUser[t.canonical_user_id]) {
      byUser[t.canonical_user_id] = {
        count: 0,
        hashes: new Set(),
        provider: t.payment_provider,
      };
    }
    byUser[t.canonical_user_id].count++;
    byUser[t.canonical_user_id].hashes.add(t.payment_tx_hash);
  });

  console.log(
    `👥 ${Object.keys(byUser).length} users made direct crypto purchases\n`,
  );

  for (const [userId, info] of Object.entries(byUser)) {
    console.log(`User: ${userId.substring(0, 30)}...`);
    console.log(`  Tickets: ${info.count}`);
    console.log(`  Provider: ${info.provider || "unknown"}`);
    console.log(`  Unique hashes: ${info.hashes.size}`);
    Array.from(info.hashes)
      .slice(0, 2)
      .forEach((h) => {
        console.log(`    ${h.substring(0, 25)}...`);
      });
    console.log("");
  }

  console.log(
    "✅ Direct crypto transactions are easy to find via payment_tx_hash!",
  );
}

findDirectCryptoTxs().catch(console.error);
