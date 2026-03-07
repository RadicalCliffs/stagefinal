import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MjkxNjQsImV4cCI6MjA4MTMwNTE2NH0.0yANezx06a-NgPSdNjeuUG3nEng5y1BbWX9Bf6Oxlrg",
);

console.log("=== DIAGNOSING MISSING TOP-UP DATA ===\n");

// Get recent topups that are missing data
const { data: topups, error } = await supabase
  .from("user_transactions")
  .select("*")
  .eq("type", "topup")
  .order("created_at", { ascending: false })
  .limit(10);

if (error) {
  console.error("Error fetching topups:", error);
  process.exit(1);
}

console.log(`Found ${topups.length} recent top-ups\n`);

for (const tx of topups) {
  console.log(`\n${"=".repeat(80)}`);
  console.log(`Transaction ID: ${tx.id}`);
  console.log(`Amount: $${tx.amount}`);
  console.log(`Provider: ${tx.payment_provider}`);
  console.log(`Status: ${tx.status}`);
  console.log(`Payment Status: ${tx.payment_status}`);
  console.log(`Posted to Balance: ${tx.posted_to_balance}`);
  console.log(`Wallet Credited: ${tx.wallet_credited}`);
  console.log(`TX Hash: ${tx.tx_id || "MISSING"}`);
  console.log(`Charge ID: ${tx.charge_id || "MISSING"}`);
  console.log(`Webhook Ref: ${tx.webhook_ref || "MISSING"}`);
  console.log(`Completed At: ${tx.completed_at || "MISSING"}`);
  console.log(`Canonical User ID: ${tx.canonical_user_id || "MISSING"}`);
  console.log(`Created At: ${tx.created_at}`);

  // Check if balance ledger entry exists
  const referenceIds = [
    tx.tx_id,
    tx.charge_id,
    tx.webhook_ref,
    tx.id,
    `manual_credit_${tx.id}`,
  ].filter(Boolean);

  console.log(
    `\nChecking balance_ledger for reference IDs:`,
    referenceIds.slice(0, 3),
  );

  const { data: ledger, error: ledgerError } = await supabase
    .from("balance_ledger")
    .select("*")
    .in("reference_id", referenceIds);

  if (ledgerError) {
    console.log(`  ❌ Error checking ledger: ${ledgerError.message}`);
  } else if (ledger && ledger.length > 0) {
    console.log(`  ✅ Found ${ledger.length} balance_ledger entry(s)`);
    ledger.forEach((entry) => {
      console.log(
        `     - Type: ${entry.transaction_type}, Amount: $${entry.amount}`,
      );
      console.log(
        `     - Balance: $${entry.balance_before} → $${entry.balance_after}`,
      );
    });
  } else {
    console.log(`  ❌ NO balance_ledger entry found - NOT CREDITED!`);
  }

  // Check current user balance
  if (tx.canonical_user_id) {
    const { data: balance } = await supabase
      .from("sub_account_balances")
      .select("available_balance")
      .eq("canonical_user_id", tx.canonical_user_id)
      .eq("currency", "USD")
      .single();

    if (balance) {
      console.log(`  Current user balance: $${balance.available_balance}`);
    }
  }
}

console.log(`\n${"=".repeat(80)}\n`);
console.log("SUMMARY:");
console.log("- Transactions with no tx_id/charge_id can't be properly tracked");
console.log("- Transactions with no balance_ledger entry were NOT credited");
console.log("- Need to credit any that are marked completed but not in ledger");
