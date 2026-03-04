import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MjkxNjQsImV4cCI6MjA4MTMwNTE2NH0.0yANezx06a-NgPSdNjeuUG3nEng5y1BbWX9Bf6Oxlrg",
);

console.log("=== CHECKING ACTUAL DATABASE STATE RIGHT NOW ===\n");

const txId = "36d6366e-da18-44bf-b150-c89340b66ad3";

// 1. Get the transaction
const { data: tx } = await supabase
  .from("user_transactions")
  .select("*")
  .eq("id", txId)
  .single();

console.log("1. USER_TRANSACTION:");
console.log(`   posted_to_balance: ${tx.posted_to_balance}`);
console.log(`   completed_at: ${tx.completed_at}`);
console.log(`   webhook_ref: ${tx.webhook_ref}`);
console.log(`   tx_id: ${tx.tx_id}`);

// 2. Check balance_ledger entries
const { data: ledger } = await supabase
  .from("balance_ledger")
  .select("*")
  .eq("canonical_user_id", tx.canonical_user_id)
  .or(
    `reference_id.eq.${tx.webhook_ref},reference_id.eq.${tx.tx_id},reference_id.eq.${tx.id}`,
  )
  .order("created_at", { ascending: false });

console.log(`\n2. BALANCE_LEDGER ENTRIES: ${ledger?.length || 0}`);
if (ledger && ledger.length > 0) {
  ledger.forEach((entry, i) => {
    console.log(`\n   Entry ${i + 1}:`);
    console.log(`     reference_id: ${entry.reference_id}`);
    console.log(`     transaction_type: ${entry.transaction_type}`);
    console.log(`     amount: $${entry.amount}`);
    console.log(`     balance_before: $${entry.balance_before}`);
    console.log(`     balance_after: $${entry.balance_after}`);
    console.log(`     created_at: ${entry.created_at}`);
  });
}

// 3. Call the RPC that the frontend uses
console.log("\n3. WHAT get_user_transactions RPC RETURNS:");
const { data: rpcData, error: rpcError } = await supabase.rpc(
  "get_user_transactions",
  { user_identifier: tx.canonical_user_id },
);

if (rpcError) {
  console.log(`   ERROR: ${rpcError.message}`);
} else {
  const transactions =
    typeof rpcData === "string"
      ? JSON.parse(rpcData)
      : Array.isArray(rpcData)
        ? rpcData
        : [];
  const found = transactions.find((t) => t.id === txId);

  if (found) {
    console.log(`   ✅ Transaction found in RPC`);
    console.log(`   amount: $${found.amount}`);
    console.log(
      `   balance_before: ${found.balance_before !== undefined && found.balance_before !== null ? "$" + found.balance_before : "NULL"}`,
    );
    console.log(
      `   balance_after: ${found.balance_after !== undefined && found.balance_after !== null ? "$" + found.balance_after : "NULL"}`,
    );
    console.log(`   completed_at: ${found.completed_at || "NULL"}`);
    console.log(`   tx_id: ${found.tx_id || "NULL"}`);
  } else {
    console.log(`   ❌ Transaction NOT found in RPC result`);
  }
}

console.log("\n=== DIAGNOSIS ===");
if (!ledger || ledger.length === 0) {
  console.log(
    "❌ NO balance_ledger entries exist - credit script never worked",
  );
} else if (ledger[0].balance_before === 0 || ledger[0].balance_before === "0") {
  console.log(
    "⚠️  balance_ledger entries exist but balance_before is WRONG (should not be $0)",
  );
  console.log(
    "   This means the credit function is reading balance BEFORE user had any money",
  );
} else {
  console.log("✅ balance_ledger looks correct");
  console.log("   Problem is likely in the RPC JOIN or frontend display");
}
