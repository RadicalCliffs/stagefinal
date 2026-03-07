import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MjkxNjQsImV4cCI6MjA4MTMwNTE2NH0.0yANezx06a-NgPSdNjeuUG3nEng5y1BbWX9Bf6Oxlrg",
);

const userId = "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363";

console.log("=== CHECKING IF 50% BONUS WAS APPLIED ===\n");

// Check the 2 credited topups
const creditedIds = [
  "bd799436-c137-4b64-aa0a-ec95502eb9e0",
  "36d6366e-da18-44bf-b150-c89340b66ad3",
];

const { data: ledger, error } = await supabase
  .from("balance_ledger")
  .select("*")
  .eq("canonical_user_id", userId)
  .eq("description", "Retroactive topup credit")
  .order("created_at", { ascending: true });

if (error) {
  console.log("Error:", error.message);
} else {
  console.log("Balance ledger entries from SIMPLE_CREDIT_TOPUPS.sql:\n");
  ledger.forEach((entry, i) => {
    console.log(`Entry ${i + 1}:`);
    console.log(`  Amount credited: $${entry.amount}`);
    console.log(
      `  Balance: $${entry.balance_before} → $${entry.balance_after}`,
    );
    console.log(`  Difference: $${entry.balance_after - entry.balance_before}`);
    console.log("");
  });

  const total = ledger.reduce((sum, e) => sum + parseFloat(e.amount), 0);
  console.log(`Total credited: $${total}`);
  console.log(
    `Expected with 50% bonus on each $3: $${3 * 1.5 * 2} ($4.50 × 2)`,
  );
  console.log("");

  if (total === 6) {
    console.log("❌ NO BONUS APPLIED - Only base amounts were credited");
  } else if (total === 9) {
    console.log("✅ BONUS APPLIED - Full 50% bonus added");
  }
}

// Check canonical_users to see if bonus flag was set
console.log("\n=== CHECKING USER BONUS STATUS ===\n");
const { data: user, error: userError } = await supabase
  .from("canonical_users")
  .select("id, has_used_new_user_bonus")
  .eq("id", userId)
  .single();

if (userError) {
  console.log("Error:", userError.message);
} else {
  console.log(`User: ${user.id}`);
  console.log(`has_used_new_user_bonus: ${user.has_used_new_user_bonus}`);
  console.log("");

  if (
    user.has_used_new_user_bonus === false ||
    user.has_used_new_user_bonus === null
  ) {
    console.log(
      "⚠️  User has NOT used bonus yet - should get 50% on first topup",
    );
  } else {
    console.log("✅ User already used bonus");
  }
}
