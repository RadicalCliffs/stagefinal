import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MjkxNjQsImV4cCI6MjA4MTMwNTE2NH0.0yANezx06a-NgPSdNjeuUG3nEng5y1BbWX9Bf6Oxlrg",
);

const userId = "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363";
const txId = "36d6366e-da18-44bf-b150-c89340b66ad3";

console.log("=== SEARCHING FOR ANY BALANCE_LEDGER ENTRIES ===\n");

// Get ALL balance_ledger entries for this user around the transaction time
const { data: allEntries } = await supabase
  .from("balance_ledger")
  .select("*")
  .eq("canonical_user_id", userId)
  .gte("created_at", "2026-03-04T11:30:00")
  .lte("created_at", "2026-03-04T12:00:00")
  .order("created_at", { ascending: false });

console.log(
  `Found ${allEntries?.length || 0} balance_ledger entries around transaction time:\n`,
);

if (allEntries) {
  for (const entry of allEntries) {
    console.log(`  ${entry.created_at}`);
    console.log(`    reference_id: ${entry.reference_id}`);
    console.log(`    type: ${entry.transaction_type}`);
    console.log(`    amount: $${entry.amount}`);
    console.log(
      `    balance: $${entry.balance_before} → $${entry.balance_after}`,
    );
    console.log("");
  }
}

// Check if the function even exists
console.log("Checking if credit_balance_with_first_deposit_bonus exists...\n");

const { data: funcCheck, error: funcError } = await supabase.rpc(
  "credit_balance_with_first_deposit_bonus",
  {
    p_canonical_user_id: userId,
    p_amount: 999999, // Dummy amount that won't match anything
    p_reason: "function test",
    p_reference_id: "test_ref_" + Date.now(),
  },
);

if (funcError) {
  console.log(`❌ Function error: ${funcError.message}`);
} else {
  console.log(`✅ Function exists and returned:`, funcCheck);
}
