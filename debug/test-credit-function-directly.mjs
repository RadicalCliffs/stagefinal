import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczNTE2ODgzMCwiZXhwIjoyMDUwNzQ0ODMwfQ.1hq0RLZ9yiNVLVxJFdzJfQTX2UE0N8aXhPbIQgzPFxE",
);

console.log(
  "=== TESTING credit_balance_with_first_deposit_bonus DIRECTLY ===\n",
);

const userId = "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363";
const webhook_ref =
  "TOPUP_prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363_36d6366e-da18-44bf-b150-c89340b66ad3";

console.log(`Calling function with:`);
console.log(`  canonical_user_id: ${userId}`);
console.log(`  amount: 3`);
console.log(`  reference_id: ${webhook_ref}`);
console.log("");

const { data, error } = await supabase.rpc(
  "credit_balance_with_first_deposit_bonus",
  {
    p_canonical_user_id: userId,
    p_amount: 3,
    p_reason: "Test credit",
    p_reference_id: webhook_ref,
  },
);

if (error) {
  console.log("❌ FUNCTION ERROR:");
  console.log(`   Code: ${error.code}`);
  console.log(`   Message: ${error.message}`);
  console.log(`   Details: ${error.details}`);
  console.log(`   Hint: ${error.hint}`);
} else {
  console.log("✅ FUNCTION SUCCESS:");
  console.log(JSON.stringify(data, null, 2));
}
