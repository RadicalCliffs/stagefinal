import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
);

console.log("\n🔍 Finding blockchain hashes for Feb 22, 2026 topups:\n");

const users = [
  "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363",
  "prize:pid:0x543e8fb59312a2578f70152c79eae169e4f8fe9e",
];

for (const user of users) {
  console.log(`\n📍 User: ${user}`);

  // Get topup from Feb 22
  const { data: topup } = await supabase
    .from("user_transactions")
    .select("*")
    .eq("canonical_user_id", user)
    .eq("type", "topup")
    .gte("created_at", "2026-02-22T00:00:00")
    .lte("created_at", "2026-02-22T23:59:59")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!topup) {
    console.log("   ❌ No topup found on Feb 22");
    continue;
  }

  console.log(`   Topup ID: ${topup.id}`);
  console.log(`   Amount: $${topup.amount}`);
  console.log(`   Current tx_id: ${topup.tx_id}`);
  console.log(`   Created: ${topup.created_at}`);

  // Find webhook with this transaction_id in metadata
  const walletAddress = user.replace("prize:pid:", "");

  const { data: webhooks } = await supabase
    .from("payment_webhook_events")
    .select("*")
    .eq("payer_address", walletAddress)
    .gte("created_at", "2026-02-22T00:00:00")
    .lte("created_at", "2026-02-23T00:00:00")
    .order("created_at", { ascending: false });

  if (!webhooks || webhooks.length === 0) {
    console.log("   ❌ No webhooks found");
    continue;
  }

  console.log(`   Found ${webhooks.length} webhook(s) from that day`);

  // Find webhook matching this transaction
  const matchingWebhook = webhooks.find((w) => {
    const txId = w.payload?.metadata?.transaction_id || w.transaction_id;
    return txId === topup.id;
  });

  if (matchingWebhook) {
    console.log(`   ✅ Found matching webhook!`);

    // Extract blockchain hash
    const blockchainHash =
      matchingWebhook.payload?.payments?.[0]?.transaction_id ||
      matchingWebhook.payload?.event?.data?.payments?.[0]?.transaction_id ||
      matchingWebhook.payload?.data?.payments?.[0]?.transaction_id ||
      matchingWebhook.payload?.event?.data?.web3_data?.success_events?.[0]
        ?.tx_hsh ||
      matchingWebhook.payload?.data?.web3_data?.success_events?.[0]?.tx_hsh;

    if (blockchainHash && blockchainHash.startsWith("0x")) {
      console.log(`   🎯 BLOCKCHAIN TX HASH: ${blockchainHash}`);
      console.log(`   Verify: https://basescan.org/tx/${blockchainHash}`);

      console.log(`\n   ✅ UPDATE COMMAND:`);
      console.log(`   UPDATE tickets`);
      console.log(
        `   SET tx_id = '${blockchainHash}', transaction_hash = '${blockchainHash}'`,
      );
      console.log(
        `   WHERE competition_id = '12cccfb1-df68-4b3e-a168-07dfeaeb06cc'`,
      );
      console.log(`   AND canonical_user_id = '${user}';`);
    } else {
      console.log(`   ⚠️  Could not extract blockchain hash from webhook`);
      console.log(
        `   Webhook structure:`,
        JSON.stringify(matchingWebhook.payload, null, 2).substring(0, 500),
      );
    }
  } else {
    // Try any confirmed webhook from that user on that day
    const confirmedWebhook = webhooks.find(
      (w) => w.event_type === "charge:confirmed",
    );

    if (confirmedWebhook) {
      console.log(`   Using confirmed webhook from same day...`);

      const blockchainHash =
        confirmedWebhook.payload?.payments?.[0]?.transaction_id ||
        confirmedWebhook.payload?.event?.data?.payments?.[0]?.transaction_id ||
        confirmedWebhook.payload?.data?.payments?.[0]?.transaction_id ||
        confirmedWebhook.payload?.data?.web3_data?.success_events?.[0]?.tx_hsh;

      if (blockchainHash && blockchainHash.startsWith("0x")) {
        console.log(`   🎯 BLOCKCHAIN TX HASH: ${blockchainHash}`);
        console.log(`   Verify: https://basescan.org/tx/${blockchainHash}`);
      }
    }
  }
}

console.log("\n\n✅ Search complete");
