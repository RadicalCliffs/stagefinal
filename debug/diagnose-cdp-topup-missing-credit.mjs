import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MjkxNjQsImV4cCI6MjA4MTMwNTE2NH0.0yANezx06a-NgPSdNjeuUG3nEng5y1BbWX9Bf6Oxlrg",
);

console.log("=== CDP COMMERCE TOPUP INVESTIGATION ===\n");

// Get the specific transaction that has no balance_ledger
const txId = "36d6366e-da18-44bf-b150-c89340b66ad3";

const { data: tx, error: txError } = await supabase
  .from("user_transactions")
  .select("*")
  .eq("id", txId)
  .single();

if (txError) {
  console.error("Error fetching transaction:", txError);
  process.exit(1);
}

console.log("Transaction details:");
console.log(JSON.stringify(tx, null, 2));

console.log("\n=====================================\n");

// Check if credit_balance_with_first_deposit_bonus was called
console.log("Checking what should have triggered the credit...\n");

// Check posted_to_balance and wallet_credited flags
console.log(`posted_to_balance: ${tx.posted_to_balance}`);
console.log(`wallet_credited: ${tx.wallet_credited}`);
console.log(`payment_status: ${tx.payment_status}`);
console.log(`status: ${tx.status}`);
console.log(`payment_provider: ${tx.payment_provider}`);

console.log(
  "\nThis transaction should have triggered credit_balance_with_first_deposit_bonus",
);
console.log(
  "but it appears it was never called (no balance_ledger entry exists).",
);
