import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MjkxNjQsImV4cCI6MjA4MTMwNTE2NH0.0yANezx06a-NgPSdNjeuUG3nEng5y1BbWX9Bf6Oxlrg",
);

console.log("=== DIAGNOSING BALANCE_LEDGER JOIN ISSUE ===\n");

// Get a sample of recent topups from user_transactions
const { data: topupsData, error: topupsError } = await supabase
  .from("user_transactions")
  .select(
    "id, canonical_user_id, webhook_ref, tx_id, charge_id, amount, created_at",
  )
  .eq("type", "topup")
  .order("created_at", { ascending: false })
  .limit(5);

if (topupsError) {
  console.error("Error fetching topups:", topupsError);
  process.exit(1);
}

const topups = topupsData || [];
console.log(`Found ${topups.length} recent topups:\n`);

for (const topup of topups) {
  console.log(`\n📦 Transaction ID: ${topup.id}`);
  console.log(`   User: ${topup.canonical_user_id}`);
  console.log(`   Amount: $${topup.amount}`);
  console.log(`   Created: ${topup.created_at}`);
  console.log(`   webhook_ref: ${topup.webhook_ref}`);
  console.log(`   tx_id: ${topup.tx_id}`);
  console.log(`   charge_id: ${topup.charge_id}`);

  // Try to find matching balance_ledger entries
  const { data: ledgerMatches, error: ledgerError } = await supabase
    .from("balance_ledger")
    .select(
      "id, reference_id, transaction_type, amount, balance_before, balance_after, created_at",
    )
    .eq("canonical_user_id", topup.canonical_user_id)
    .or(
      `reference_id.eq.${topup.webhook_ref},reference_id.eq.${topup.tx_id},reference_id.eq.${topup.charge_id},reference_id.eq.${topup.id}`,
    )
    .order("created_at", { ascending: false });

  if (ledgerError) {
    console.log(`   ⚠️  Error querying balance_ledger: ${ledgerError.message}`);
    continue;
  }

  if (ledgerMatches && ledgerMatches.length > 0) {
    console.log(
      `   ✅ Found ${ledgerMatches.length} matching balance_ledger entries:`,
    );
    for (const match of ledgerMatches) {
      console.log(`      - reference_id: ${match.reference_id}`);
      console.log(`        type: ${match.transaction_type}`);
      console.log(
        `        balance: $${match.balance_before} → $${match.balance_after}`,
      );
      console.log(`        amount: $${match.amount}`);
    }
  } else {
    console.log(`   ❌ NO matching balance_ledger entries found`);

    // Check if ANY balance_ledger entries exist for this user around this time
    const createdDate = new Date(topup.created_at);
    const fiveMinsBefore = new Date(
      createdDate.getTime() - 5 * 60 * 1000,
    ).toISOString();
    const fiveMinsAfter = new Date(
      createdDate.getTime() + 5 * 60 * 1000,
    ).toISOString();

    const { data: nearbyEntries } = await supabase
      .from("balance_ledger")
      .select(
        "id, reference_id, transaction_type, amount, balance_before, balance_after, created_at",
      )
      .eq("canonical_user_id", topup.canonical_user_id)
      .gte("created_at", fiveMinsBefore)
      .lte("created_at", fiveMinsAfter)
      .order("created_at", { ascending: false });

    if (nearbyEntries && nearbyEntries.length > 0) {
      console.log(
        `   🔍 Found ${nearbyEntries.length} balance_ledger entries around this time:`,
      );
      for (const entry of nearbyEntries) {
        console.log(`      - reference_id: ${entry.reference_id}`);
        console.log(`        type: ${entry.transaction_type}`);
        console.log(
          `        balance: $${entry.balance_before} → $${entry.balance_after}`,
        );
      }
    } else {
      console.log(
        `   ⚠️  No balance_ledger entries found for this user around this time`,
      );
    }
  }
}
