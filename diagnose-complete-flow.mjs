import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MjkxNjQsImV4cCI6MjA4MTMwNTE2NH0.0yANezx06a-NgPSdNjeuUG3nEng5y1BbWX9Bf6Oxlrg",
);

console.log("=== CHECKING IF CREDIT ACTUALLY WORKED ===\n");

const txId = "36d6366e-da18-44bf-b150-c89340b66ad3";

// Get the transaction
const { data: tx } = await supabase
  .from("user_transactions")
  .select("*")
  .eq("id", txId)
  .single();

console.log("TRANSACTION STATUS:");
console.log(`  posted_to_balance: ${tx.posted_to_balance}`);
console.log(`  wallet_credited: ${tx.wallet_credited}`);
console.log(`  completed_at: ${tx.completed_at}`);
console.log("");

// Check balance_ledger - try ALL possible reference_ids
const references = [tx.webhook_ref, tx.tx_id, tx.charge_id, tx.id].filter(
  (r) => r,
);

console.log("Checking balance_ledger for these reference_ids:");
references.forEach((r) => console.log(`  - ${r}`));
console.log("");

let foundLedger = false;
for (const ref of references) {
  const { data: ledger } = await supabase
    .from("balance_ledger")
    .select("*")
    .eq("reference_id", ref);

  if (ledger && ledger.length > 0) {
    console.log(
      `✅ Found ${ledger.length} balance_ledger entries for: ${ref.substring(0, 50)}...`,
    );
    ledger.forEach((entry) => {
      console.log(`   Type: ${entry.transaction_type}`);
      console.log(`   Amount: $${entry.amount}`);
      console.log(
        `   Balance: $${entry.balance_before} → $${entry.balance_after}`,
      );
      console.log(`   Created: ${entry.created_at}`);
      console.log("");
    });
    foundLedger = true;
  }
}

if (!foundLedger) {
  console.log("❌ NO balance_ledger entries found for ANY reference_id");
  console.log("   This means the CREDIT script FAILED or was not run.\n");
}

// Now check what get_user_transactions RPC returns
console.log("=== CHECKING get_user_transactions RPC OUTPUT ===\n");

const { data: rpcResult, error: rpcError } = await supabase.rpc(
  "get_user_transactions",
  { user_identifier: tx.canonical_user_id },
);

if (rpcError) {
  console.log(`❌ RPC Error: ${rpcError.message}`);
} else {
  // Parse the result (might be JSON string or array)
  let transactions;
  if (typeof rpcResult === "string") {
    transactions = JSON.parse(rpcResult);
  } else if (Array.isArray(rpcResult)) {
    transactions = rpcResult;
  } else {
    transactions = rpcResult ? [rpcResult] : [];
  }

  const thisTransaction = transactions.find((t) => t.id === txId);

  if (thisTransaction) {
    console.log("✅ Found transaction in RPC result:");
    console.log(`   id: ${thisTransaction.id}`);
    console.log(`   amount: $${thisTransaction.amount}`);
    console.log(
      `   balance_before: ${thisTransaction.balance_before !== undefined && thisTransaction.balance_before !== null ? "$" + thisTransaction.balance_before : "NULL"}`,
    );
    console.log(
      `   balance_after: ${thisTransaction.balance_after !== undefined && thisTransaction.balance_after !== null ? "$" + thisTransaction.balance_after : "NULL"}`,
    );
    console.log(`   completed_at: ${thisTransaction.completed_at || "NULL"}`);
    console.log(`   tx_id: ${thisTransaction.tx_id || "NULL"}`);
    console.log("");

    if (!thisTransaction.balance_before && !thisTransaction.balance_after) {
      console.log("⚠️  RPC is NOT returning balance data - JOIN is broken!");
    }
  } else {
    console.log(`❌ Transaction ${txId} NOT found in RPC result`);
    console.log(`   Total transactions returned: ${transactions.length}`);
  }
}

console.log("\n=== DIAGNOSIS ===");
if (!foundLedger) {
  console.log("❌ PROBLEM: balance_ledger entries were NEVER created");
  console.log("   SOLUTION: Run CREDIT_ALL_STUCK_TOPUPS.sql again");
} else if (rpcError || !thisTransaction) {
  console.log("❌ PROBLEM: RPC is not finding the transaction");
  console.log("   SOLUTION: Check get_user_transactions RPC function");
} else if (!thisTransaction.balance_before && !thisTransaction.balance_after) {
  console.log("❌ PROBLEM: RPC is not JOINing with balance_ledger correctly");
  console.log(
    "   SOLUTION: Check UPDATE_GET_USER_TRANSACTIONS_WITH_BALANCES.sql was deployed",
  );
} else {
  console.log(
    "✅ Everything looks good - try refreshing your browser (hard refresh: Ctrl+Shift+R)",
  );
}
