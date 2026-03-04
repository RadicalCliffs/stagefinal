import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczNTE2ODgzMCwiZXhwIjoyMDUwNzQ0ODMwfQ.1hq0RLZ9yiNVLVxJFdzJfQTX2UE0N8aXhPbIQgzPFxE",
);

console.log("=== CREDITING ALL UNCREDITED TOPUPS WITH 50% BONUS ===\n");

// Find all completed topups that haven't been credited
const { data: stuckTopups, error: fetchError } = await supabase
  .from("user_transactions")
  .select("*")
  .eq("type", "topup")
  .in("status", ["completed", "finished", "confirmed"])
  .in("payment_status", ["completed", "finished", "confirmed"])
  .or("posted_to_balance.is.null,posted_to_balance.eq.false")
  .order("created_at", { ascending: false });

if (fetchError) {
  console.error("Error fetching stuck topups:", fetchError);
  process.exit(1);
}

console.log(`Found ${stuckTopups?.length || 0} uncredited topups\n`);

if (!stuckTopups || stuckTopups.length === 0) {
  console.log("✅ No stuck topups to credit!");
  process.exit(0);
}

let successCount = 0;
let errorCount = 0;
let alreadyCreditedCount = 0;

for (const topup of stuckTopups) {
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📦 Transaction: ${topup.id}`);
  console.log(`   User: ${topup.canonical_user_id}`);
  console.log(`   Amount: $${topup.amount}`);
  console.log(`   Provider: ${topup.payment_provider}`);
  console.log(`   Status: ${topup.status} / ${topup.payment_status}`);
  console.log(`   Created: ${topup.created_at}`);
  console.log(`   tx_id: ${topup.tx_id}`);
  console.log(`   webhook_ref: ${topup.webhook_ref}`);

  // Use webhook_ref, tx_id, or transaction ID as reference
  const referenceId =
    topup.webhook_ref || topup.tx_id || topup.charge_id || topup.id;

  console.log(`\n   🔧 Crediting with reference_id: ${referenceId}...`);

  try {
    // Call credit_balance_with_first_deposit_bonus (50% bonus applied if first topup)
    const { data: creditResult, error: creditError } = await supabase.rpc(
      "credit_balance_with_first_deposit_bonus",
      {
        p_canonical_user_id: topup.canonical_user_id,
        p_amount: topup.amount,
        p_reason: `Retroactive credit for ${topup.payment_provider} topup`,
        p_reference_id: referenceId,
      },
    );

    if (creditError) {
      console.error(`   ❌ Credit error: ${creditError.message}`);
      errorCount++;
      continue;
    }

    if (creditResult?.already_credited) {
      console.log(`   ℹ️  Already credited: ${creditResult.idempotency_note}`);
      alreadyCreditedCount++;
      continue;
    }

    console.log(`   ✅ CREDITED SUCCESSFULLY!`);
    console.log(`      Deposited: $${creditResult.deposited_amount}`);
    console.log(
      `      Bonus: $${creditResult.bonus_amount} ${creditResult.bonus_applied ? "🎁 FIRST DEPOSIT BONUS!" : ""}`,
    );
    console.log(`      Total credited: $${creditResult.total_credited}`);
    console.log(`      Previous balance: $${creditResult.previous_balance}`);
    console.log(`      New balance: $${creditResult.new_balance}`);

    successCount++;
  } catch (err) {
    console.error(`   ❌ Exception: ${err.message}`);
    errorCount++;
  }
}

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`\n📊 FINAL RESULTS:`);
console.log(`   ✅ Successfully credited: ${successCount}`);
console.log(`   ℹ️  Already credited: ${alreadyCreditedCount}`);
console.log(`   ❌ Errors: ${errorCount}`);
console.log(
  `\n🎉 All done! Users should now see their balance updates and 50% bonuses!`,
);
