import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
);

const competitionId = "12cccfb1-df68-4b3e-a168-07dfeaeb06cc";

console.log("\n🔍 Checking webhook and transaction hashes:\n");

// Check coinbase_webhook_events for this competition
console.log("1️⃣ Checking coinbase_webhook_events:");
const { data: webhooks, error: webhookError } = await supabase
  .from("coinbase_webhook_events")
  .select("*")
  .eq("competition_id", competitionId)
  .order("created_at", { ascending: false });

if (webhookError) {
  console.error("Error:", webhookError);
} else {
  console.log(`Found ${webhooks?.length || 0} webhook events`);
  webhooks?.forEach((w) => {
    console.log(`\n  Event ID: ${w.id}`);
    console.log(`  Type: ${w.event_type}`);
    console.log(`  Status: ${w.status}`);
    console.log(`  Charge Code: ${w.charge_code}`);
    console.log(`  Created: ${w.created_at}`);
    if (w.event_data?.payments) {
      console.log(
        `  Payments:`,
        JSON.stringify(w.event_data.payments, null, 2),
      );
    }
  });
}

// Check user_transactions for blockchain payments
console.log("\n\n2️⃣ Checking user_transactions (on-chain payments):");
const { data: txs, error: txError } = await supabase
  .from("user_transactions")
  .select("*")
  .eq("competition_id", competitionId)
  .not("tx_id", "is", null)
  .order("created_at", { ascending: false });

if (txError) {
  console.error("Error:", txError);
} else {
  console.log(`Found ${txs?.length || 0} transactions with tx_id`);
  txs?.forEach((tx) => {
    console.log(`\n  Transaction ID: ${tx.id}`);
    console.log(`  User: ${tx.canonical_user_id || tx.user_id}`);
    console.log(`  Type: ${tx.type}`);
    console.log(`  Amount: $${tx.amount}`);
    console.log(`  Payment Provider: ${tx.payment_provider}`);
    console.log(`  TX Hash: ${tx.tx_id || tx.transaction_hash}`);
    console.log(`  Status: ${tx.status} / ${tx.payment_status}`);
    console.log(`  Created: ${tx.created_at}`);
  });
}

// Check if there are tickets with hashes that don't match
console.log("\n\n3️⃣ Checking tickets with transaction hashes:");
const { data: tickets, error: ticketError } = await supabase
  .from("tickets")
  .select(
    "ticket_number, tx_id, transaction_hash, canonical_user_id, created_at",
  )
  .eq("competition_id", competitionId)
  .not("tx_id", "is", null)
  .order("ticket_number")
  .limit(10);

if (ticketError) {
  console.error("Error:", ticketError);
} else {
  console.log(
    `Found ${tickets?.length || 0} tickets with tx hashes (showing first 10)`,
  );
  tickets?.forEach((t) => {
    console.log(`  Ticket #${t.ticket_number}: ${t.tx_id}`);
  });
}

console.log("\n✅ Check complete");
