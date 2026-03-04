import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MjkxNjQsImV4cCI6MjA4MTMwNTE2NH0.0yANezx06a-NgPSdNjeuUG3nEng5y1BbWX9Bf6Oxlrg",
);

console.log("=== CHECKING IF 50% BONUS FUNCTION WAS DEPLOYED ===\n");

// Check if function exists by looking at pg_catalog
const { data: funcInfo, error: funcError } = await supabase
  .from("pg_proc")
  .select("*")
  .ilike("proname", "credit_balance_with_first_deposit_bonus");

if (funcError) {
  console.log(
    "❌ Cannot check pg_proc (permission denied - this is normal with anon key)",
  );
  console.log("   Trying to call the function instead...\n");

  // Try calling it with a dummy test
  const { data: testData, error: testError } = await supabase.rpc(
    "credit_balance_with_first_deposit_bonus",
    {
      p_canonical_user_id: "test_user_" + Date.now(),
      p_amount: 0.01,
      p_reason: "deployment test",
      p_reference_id: "test_" + Date.now(),
    },
  );

  if (testError) {
    if (testError.message && testError.message.includes("does not exist")) {
      console.log("❌ FUNCTION NOT FOUND!");
      console.log(
        "   You need to run DEPLOY_50_PERCENT_BONUS_NOW.sql in Supabase SQL Editor",
      );
    } else if (
      testError.message &&
      testError.message.includes("canonical_user_id_norm")
    ) {
      console.log(
        "❌ FUNCTION EXISTS BUT HAS THE OLD VERSION (missing canonical_user_id_norm fix)",
      );
      console.log(
        "   You need to RE-RUN the FIXED DEPLOY_50_PERCENT_BONUS_NOW.sql",
      );
    } else {
      console.log("⚠️  Function exists but returned error:");
      console.log(`   ${testError.message}`);
    }
  } else {
    console.log("✅ Function exists and is callable");
    console.log("   Test result:", testData);
  }
} else {
  console.log("Function info:", funcInfo);
}

// Also check if the updates to get_user_transactions were deployed
console.log("\n=== CHECKING get_user_transactions RPC ===\n");
const { data: rpcTest, error: rpcError } = await supabase.rpc(
  "get_user_transactions",
  { user_identifier: "prize:pid:0x0000000000000000000000000000000000000001" },
);

if (rpcError) {
  console.log("❌ get_user_transactions RPC error:", rpcError.message);
} else {
  console.log("✅ get_user_transactions RPC is working");
}
