import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
);

const USERS = {
  "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363":
    "0xac1dfe66d18919a0434793ee74e15e831babec126afedaa25df2d49d101fd901",
  "prize:pid:0x543e8fb59312a2578f70152c79eae169e4f8fe9e":
    "0x271a504c9639c98e520bdd181a03370609313993e830d4f547ae1a68c61b768b",
  "prize:pid:0xe1a2e7487ddb3d82b150b47b8c6e9e5e03e0caf6":
    "0x95e380db63e9f3e20b2bca6e421c6aaba3c57d87418d95ee14903d129d49c1eb",
};

console.log("🔍 Verifying ALL tickets have THEIR user's hash...\n");

for (const [userId, expectedHash] of Object.entries(USERS)) {
  console.log(`User: ${userId.substring(0, 40)}...`);

  // Count total tickets
  const { count: total } = await supabase
    .from("tickets")
    .select("*", { count: "exact", head: true })
    .eq("canonical_user_id", userId);

  // Count tickets with correct hash
  const { count: correct } = await supabase
    .from("tickets")
    .select("*", { count: "exact", head: true })
    .eq("canonical_user_id", userId)
    .eq("tx_id", expectedHash);

  // Count tickets with wrong hash (not the expected one)
  const { count: wrong } = await supabase
    .from("tickets")
    .select("*", { count: "exact", head: true })
    .eq("canonical_user_id", userId)
    .neq("tx_id", expectedHash);

  console.log(`  Total tickets: ${total || 0}`);
  console.log(`  ✅ Correct hash: ${correct || 0}`);
  console.log(`  ❌ Wrong hash: ${wrong || 0}`);

  if (wrong > 0) {
    // Sample wrong hashes
    const { data: wrongSamples } = await supabase
      .from("tickets")
      .select("tx_id")
      .eq("canonical_user_id", userId)
      .neq("tx_id", expectedHash)
      .limit(5);

    console.log(`  Sample wrong hashes:`);
    for (const s of wrongSamples || []) {
      console.log(`    - ${s.tx_id?.substring(0, 30)}...`);
    }
  }
  console.log();
}
