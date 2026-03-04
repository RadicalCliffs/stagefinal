import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MjkxNjQsImV4cCI6MjA4MTMwNTE2NH0.0yANezx06a-NgPSdNjeuUG3nEng5y1BbWX9Bf6Oxlrg",
);

const userId = "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363";

console.log("=== CHECKING SUB_ACCOUNT_BALANCES TABLE ===\n");

const { data: balance, error } = await supabase
  .from("sub_account_balances")
  .select("*")
  .eq("canonical_user_id", userId)
  .eq("currency", "USD")
  .single();

if (error) {
  console.log("Error:", error.message);
} else {
  console.log("USER BALANCE IN sub_account_balances:");
  console.log(`  canonical_user_id: ${balance.canonical_user_id}`);
  console.log(`  available_balance: $${balance.available_balance}`);
  console.log(`  currency: ${balance.currency}`);
  console.log(`  updated_at: ${balance.updated_at}`);
}

console.log("\n=== CHECKING BALANCE_LEDGER FOR THIS USER ===\n");

const { data: ledger } = await supabase
  .from("balance_ledger")
  .select("*")
  .eq("canonical_user_id", userId)
  .order("created_at", { ascending: false })
  .limit(10);

console.log(`Total balance_ledger entries: ${ledger?.length || 0}`);
if (ledger && ledger.length > 0) {
  console.log("\nMost recent entries:");
  ledger.forEach((entry, i) => {
    console.log(`\n  ${i + 1}. ${entry.created_at}`);
    console.log(`     type: ${entry.transaction_type}`);
    console.log(`     amount: $${entry.amount}`);
    console.log(
      `     balance: $${entry.balance_before} → $${entry.balance_after}`,
    );
    console.log(
      `     reference_id: ${entry.reference_id?.substring(0, 50)}...`,
    );
  });
}

console.log("\n=== THE ISSUE ===");
console.log(
  "The user has $" + balance?.available_balance + " in sub_account_balances",
);
console.log(
  "But there are " + (ledger?.length || 0) + " entries in balance_ledger",
);
console.log(
  "\nIf balance_ledger is empty, it means credits happened OUTSIDE the credit function",
);
console.log("(maybe manually or via a different function)");
