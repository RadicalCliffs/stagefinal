import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczNTE2ODgzMCwiZXhwIjoyMDUwNzQ0ODMwfQ.1hq0RLZ9yiNVLVxJFdzJfQTX2UE0N8aXhPbIQgzPFxE",
);

console.log(
  "=== CHECKING PRODUCTION credit_balance_with_first_deposit_bonus FUNCTION ===\n",
);

// Check if function exists and get its definition
const { data, error } = await supabase.rpc(
  "credit_balance_with_first_deposit_bonus",
  {
    p_canonical_user_id: "test_check_exists",
    p_amount: 0.01,
    p_reason: "test_check",
    p_reference_id: "test_" + Date.now(),
  },
);

if (error) {
  console.log("❌ Function call error:", error.message);
  console.log(
    "This might mean the function doesnt exist or has different parameters\n",
  );
} else {
  console.log("✅ Function exists and is callable");
  console.log("Result:", JSON.stringify(data, null, 2));
  console.log("\n");
}

// Try to get the function source code from pg_proc
console.log(
  "Attempting to fetch function source from production database...\n",
);

const { data: funcData, error: funcError } = await supabase
  .from("pg_proc")
  .select("*")
  .ilike("proname", "credit_balance_with_first_deposit_bonus")
  .single();

if (funcError) {
  console.log("Cannot query pg_proc directly (expected):", funcError.message);
}

console.log("\nDone checking production function.");
