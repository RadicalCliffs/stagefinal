import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
);

const competitionId = "12cccfb1-df68-4b3e-a168-07dfeaeb06cc";
const userWallet = "0x0ff51ec0ecc9ae1e5e6048976ba307c849781363";

console.log("\n🔍 Finding REAL blockchain transaction hashes:\n");

// Check payment_webhook_events
console.log("1️⃣ Checking payment_webhook_events:");
const { data: webhooks, error: webhookError } = await supabase
  .from("payment_webhook_events")
  .select("*")
  .order("created_at", { ascending: false })
  .limit(20);

if (webhookError) {
  console.error("Webhook Error:", webhookError);
} else {
  console.log(`Found ${webhooks?.length || 0} recent webhook events`);
  const relevantWebhooks = webhooks?.filter(
    (w) =>
      w.metadata?.competition_id === competitionId ||
      w.event_data?.metadata?.competition_id === competitionId ||
      JSON.stringify(w).includes(competitionId),
  );
  console.log(`${relevantWebhooks?.length || 0} are for this competition`);

  relevantWebhooks?.forEach((w) => {
    console.log(`\n  Event: ${w.event_type}`);
    console.log(`  Status: ${w.status}`);
    console.log(`  Created: ${w.created_at}`);
    console.log(`  Full data:`, JSON.stringify(w, null, 2));
  });
}

// Check for transactions with actual blockchain interaction
console.log("\n\n2️⃣ Checking all user_transactions for this user:");
const { data: userTxs, error: userTxError } = await supabase
  .from("user_transactions")
  .select("*")
  .or(
    `canonical_user_id.eq.prize:pid:${userWallet},wallet_address.eq.${userWallet}`,
  )
  .order("created_at", { ascending: false });

if (userTxError) {
  console.error("Error:", userTxError);
} else {
  console.log(`Found ${userTxs?.length || 0} transactions for this user`);
  userTxs?.forEach((tx) => {
    console.log(`\n  ${tx.type} - $${tx.amount}`);
    console.log(`  Competition: ${tx.competition_id || "N/A"}`);
    console.log(`  Provider: ${tx.payment_provider}`);
    console.log(`  TX Hash: ${tx.tx_id || tx.transaction_hash || "NONE"}`);
    console.log(`  Created: ${tx.created_at}`);
  });
}

console.log("\n✅ Check complete");
