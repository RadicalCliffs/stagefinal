import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MjkxNjQsImV4cCI6MjA4MTMwNTE2NH0.0yANezx06a-NgPSdNjeuUG3nEng5y1BbWX9Bf6Oxlrg",
);

const userId = "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363";

console.log("=== VERIFYING CREDITS WORKED ===\n");

// Check user_transactions
console.log(
  "1. Checking user_transactions (should all be posted_to_balance=true now):\n",
);
const { data: transactions, error: txError } = await supabase
  .from("user_transactions")
  .select("*")
  .eq("canonical_user_id", userId)
  .eq("type", "topup")
  .order("created_at", { ascending: false });

if (txError) {
  console.log("Error:", txError.message);
} else {
  console.log(`Found ${transactions.length} topup transactions:`);
  transactions.forEach((tx) => {
    console.log(
      `  - ${tx.id}: $${tx.amount} - posted_to_balance=${tx.posted_to_balance} - balance_before=$${tx.balance_before} - balance_after=$${tx.balance_after}`,
    );
  });
}

// Check balance_ledger
console.log(
  "\n2. Checking balance_ledger (should have deposit entries now):\n",
);
const { data: ledger, error: ledgerError } = await supabase
  .from("balance_ledger")
  .select("*")
  .eq("canonical_user_id", userId)
  .eq("transaction_type", "deposit")
  .order("created_at", { ascending: false });

if (ledgerError) {
  console.log("Error:", ledgerError.message);
} else {
  console.log(`Found ${ledger.length} deposit entries in balance_ledger:`);
  ledger.forEach((entry) => {
    console.log(
      `  - $${entry.amount} - ${entry.description} - ${entry.balance_before} → ${entry.balance_after}`,
    );
  });
}

// Check sub_account_balances
console.log(
  "\n3. Checking sub_account_balances (should show increased balance):\n",
);
const { data: balance, error: balError } = await supabase
  .from("sub_account_balances")
  .select("*")
  .eq("canonical_user_id", userId)
  .eq("currency", "USD")
  .single();

if (balError) {
  console.log("Error:", balError.message);
} else {
  console.log(`  Available balance: $${balance.available_balance}`);
  console.log(`  Last updated: ${balance.updated_at}`);
}

console.log("\n✅ VERIFICATION COMPLETE\n");
