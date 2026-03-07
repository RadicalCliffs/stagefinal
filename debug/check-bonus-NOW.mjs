import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MjkxNjQsImV4cCI6MjA4MTMwNTE2NH0.0yANezx06a-NgPSdNjeuUG3nEng5y1BbWX9Bf6Oxlrg",
);

const userId = "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363";

console.log("=== CHECKING FOR BONUS ENTRY ===\n");

// Check for bonus entries
const { data: bonus, error: bonusError } = await supabase
  .from("balance_ledger")
  .select("*")
  .eq("canonical_user_id", userId)
  .eq("transaction_type", "bonus")
  .order("created_at", { ascending: false });

if (bonusError) {
  console.log("Error:", bonusError.message);
} else {
  console.log(`Found ${bonus.length} bonus entries:\n`);
  bonus.forEach((entry) => {
    console.log(`  Amount: $${entry.amount}`);
    console.log(`  Description: ${entry.description}`);
    console.log(
      `  Balance: $${entry.balance_before} → $${entry.balance_after}`,
    );
    console.log(`  Created: ${entry.created_at}`);
    console.log("");
  });
}

// Check current balance
const { data: balance, error: balError } = await supabase
  .from("sub_account_balances")
  .select("available_balance")
  .eq("canonical_user_id", userId)
  .eq("currency", "USD")
  .single();

if (!balError) {
  console.log(`Current balance: $${balance.available_balance}\n`);
}
