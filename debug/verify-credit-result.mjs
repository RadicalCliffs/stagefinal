import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MjkxNjQsImV4cCI6MjA4MTMwNTE2NH0.0yANezx06a-NgPSdNjeuUG3nEng5y1BbWX9Bf6Oxlrg",
);

console.log("=== CHECKING WHAT HAPPENED AFTER CREDIT ===\n");

const txId = "36d6366e-da18-44bf-b150-c89340b66ad3";

// Check user_transactions
const { data: tx } = await supabase
  .from("user_transactions")
  .select("*")
  .eq("id", txId)
  .single();

console.log("USER_TRANSACTIONS:");
console.log(`  posted_to_balance: ${tx.posted_to_balance}`);
console.log(`  wallet_credited: ${tx.wallet_credited}`);
console.log(`  completed_at: ${tx.completed_at}`);
console.log(`  amount: $${tx.amount}`);
console.log(`  canonical_user_id: ${tx.canonical_user_id}`);
console.log(`  webhook_ref: ${tx.webhook_ref}`);

// Check balance_ledger
const { data: ledger } = await supabase
  .from("balance_ledger")
  .select("*")
  .eq("canonical_user_id", tx.canonical_user_id)
  .or(
    `reference_id.eq.${tx.webhook_ref},reference_id.eq.${tx.tx_id},reference_id.eq.${tx.id}`,
  )
  .order("created_at", { ascending: false });

console.log(`\nBALANCE_LEDGER entries: ${ledger?.length || 0}`);
if (ledger && ledger.length > 0) {
  for (const entry of ledger) {
    console.log(`\n  Entry:`);
    console.log(`    reference_id: ${entry.reference_id}`);
    console.log(`    transaction_type: ${entry.transaction_type}`);
    console.log(`    amount: $${entry.amount}`);
    console.log(`    balance_before: $${entry.balance_before}`);
    console.log(`    balance_after: $${entry.balance_after}`);
    console.log(`    description: ${entry.description}`);
  }
}

// Check sub_account_balances
const { data: balance } = await supabase
  .from("sub_account_balances")
  .select("*")
  .eq("canonical_user_id", tx.canonical_user_id)
  .eq("currency", "USD")
  .single();

console.log(`\nSUB_ACCOUNT_BALANCES:`);
console.log(`  available_balance: $${balance?.available_balance || 0}`);

// Check if user got the bonus
const { data: user } = await supabase
  .from("canonical_users")
  .select("has_used_new_user_bonus")
  .eq("canonical_user_id", tx.canonical_user_id)
  .single();

console.log(`\nCANONICAL_USERS:`);
console.log(`  has_used_new_user_bonus: ${user?.has_used_new_user_bonus}`);
