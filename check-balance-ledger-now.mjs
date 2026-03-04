import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MjkxNjQsImV4cCI6MjA4MTMwNTE2NH0.0yANezx06a-NgPSdNjeuUG3nEng5y1BbWX9Bf6Oxlrg",
);

console.log("=== CHECKING IF BALANCE_LEDGER ENTRIES EXIST NOW ===\n");

const txId = "36d6366e-da18-44bf-b150-c89340b66ad3";

const { data: tx } = await supabase
  .from("user_transactions")
  .select("*")
  .eq("id", txId)
  .single();

console.log("Transaction:");
console.log(`  canonical_user_id: ${tx.canonical_user_id}`);
console.log(`  webhook_ref: ${tx.webhook_ref}`);
console.log(`  tx_id: ${tx.tx_id}`);
console.log(`  amount: $${tx.amount}`);
console.log(`  posted_to_balance: ${tx.posted_to_balance}`);

// Check balance_ledger with ALL possible reference_id matches
const references = [tx.webhook_ref, tx.tx_id, tx.charge_id, tx.id].filter(
  (r) => r,
);

console.log(`\nChecking balance_ledger for these reference_ids:`);
references.forEach((r) => console.log(`  - ${r}`));

for (const ref of references) {
  const { data: ledger } = await supabase
    .from("balance_ledger")
    .select("*")
    .eq("canonical_user_id", tx.canonical_user_id)
    .eq("reference_id", ref);

  if (ledger && ledger.length > 0) {
    console.log(`\n✅ Found ${ledger.length} entries for reference_id: ${ref}`);
    ledger.forEach((entry) => {
      console.log(`   Type: ${entry.transaction_type}`);
      console.log(`   Amount: $${entry.amount}`);
      console.log(
        `   Balance: $${entry.balance_before} → $${entry.balance_after}`,
      );
    });
  } else {
    console.log(`\n❌ No entries for reference_id: ${ref}`);
  }
}

// Check if there are ANY recent balance_ledger entries for this user
const { data: recentEntries } = await supabase
  .from("balance_ledger")
  .select("*")
  .eq("canonical_user_id", tx.canonical_user_id)
  .order("created_at", { ascending: false })
  .limit(5);

console.log(`\n\nMost recent balance_ledger entries for this user:`);
if (recentEntries && recentEntries.length > 0) {
  recentEntries.forEach((entry) => {
    console.log(`\n  ${entry.created_at}`);
    console.log(`    reference_id: ${entry.reference_id}`);
    console.log(`    type: ${entry.transaction_type}`);
    console.log(`    amount: $${entry.amount}`);
  });
}

// Check the RPC that dashboard uses
console.log(`\n\n=== CHECKING get_user_transactions RPC ===`);
const { data: rpcResult, error: rpcError } = await supabase.rpc(
  "get_user_transactions",
  { user_identifier: tx.canonical_user_id },
);

if (rpcError) {
  console.log(`❌ RPC error: ${rpcError.message}`);
} else {
  const transactions = Array.isArray(rpcResult)
    ? rpcResult
    : rpcResult
      ? JSON.parse(rpcResult)
      : [];
  const thisTransaction = transactions.find((t) => t.id === txId);

  if (thisTransaction) {
    console.log(`\n✅ Found this transaction in RPC result:`);
    console.log(`   balance_before: $${thisTransaction.balance_before}`);
    console.log(`   balance_after: $${thisTransaction.balance_after}`);
    console.log(`   completed_at: ${thisTransaction.completed_at}`);
  } else {
    console.log(`\n❌ Transaction NOT found in RPC result`);
    console.log(`   Total transactions returned: ${transactions.length}`);
  }
}
